import { create } from 'zustand';
import {
  buildDue,
  localTimeOf,
  newId,
  nextOccurrence,
  positionAfter,
  positionKey,
  preferenceDefaults,
  todayLocal,
  POSITION_STEP,
  type LabelDTO,
  type ProjectDTO,
  type ReminderDTO,
  type ReminderInput,
  type SavedFilterDTO,
  type SectionDTO,
  type TaskDTO,
  type TemplateDTO,
  type UserDTO,
} from '@wos/shared';
import { api, ApiError, errorMessage, NetworkError, setCsrf } from './api';
import { db, kvGet, kvSet, wipeLocal, type EntityType, type OutboxRow } from './db';

export interface Conflict {
  id: string;
  taskId: string;
  title: string;
  fields: { key: string; mine: unknown; theirs: unknown }[];
  patch: Record<string, unknown>;
}
export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
  action?: { label: string; run: () => void };
}

type Map<T> = Record<string, T>;

export interface State {
  status: 'boot' | 'anon' | 'authed';
  ownerConfigured: boolean;
  user: UserDTO | null;
  tasks: Map<TaskDTO>;
  projects: Map<ProjectDTO>;
  sections: Map<SectionDTO>;
  labels: Map<LabelDTO>;
  filters: Map<SavedFilterDTO>;
  templates: Map<TemplateDTO>;
  prefs: Record<string, unknown>;
  serverTime: string | null;
  lastEventSeq: number;
  lastSyncedAt: string | null;
  online: boolean;
  stream: 'connecting' | 'live' | 'offline';
  syncing: boolean;
  outbox: OutboxRow[];
  conflicts: Conflict[];
  toasts: Toast[];
  sessionExpired: boolean;
  quickAddOpen: boolean;
  quickAddDefaults: { projectId?: string | null; sectionId?: string | null; date?: string | null } | null;
  openTaskId: string | null;
}

export const useStore = create<State>(() => ({
  status: 'boot',
  ownerConfigured: true,
  user: null,
  tasks: {},
  projects: {},
  sections: {},
  labels: {},
  filters: {},
  templates: {},
  prefs: { ...preferenceDefaults },
  serverTime: null,
  lastEventSeq: 0,
  lastSyncedAt: null,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  stream: 'connecting',
  syncing: false,
  outbox: [],
  conflicts: [],
  toasts: [],
  sessionExpired: false,
  quickAddOpen: false,
  quickAddDefaults: null,
  openTaskId: null,
}));

const get = () => useStore.getState();
const set = (p: Partial<State> | ((s: State) => Partial<State>)) => useStore.setState(p);

// ---------------------------------------------------------------- toasts
let toastSeq = 1;
export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action']): void {
  const id = toastSeq++;
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind, action }] }));
  setTimeout(() => dismissToast(id), action ? 7000 : 4500);
}
export function dismissToast(id: number): void {
  set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

// ---------------------------------------------------------------- persistence of the local snapshot
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const s = get();
    if (s.status !== 'authed' || !s.user) return;
    void kvSet('snapshot', {
      userId: s.user.id,
      user: s.user,
      tasks: s.tasks,
      projects: s.projects,
      sections: s.sections,
      labels: s.labels,
      filters: s.filters,
      templates: s.templates,
      prefs: s.prefs,
      serverTime: s.serverTime,
      lastEventSeq: s.lastEventSeq,
      lastSyncedAt: s.lastSyncedAt,
    });
  }, 400);
}
useStore.subscribe((s, prev) => {
  if (s.tasks !== prev.tasks || s.projects !== prev.projects || s.sections !== prev.sections || s.labels !== prev.labels || s.prefs !== prev.prefs || s.filters !== prev.filters || s.templates !== prev.templates) schedulePersist();
});

const byId = <T extends { id: string }>(list: T[]): Map<T> => Object.fromEntries(list.map((x) => [x.id, x]));

/** Restores the last local snapshot (works offline). Returns the cached user if one exists. */
export async function hydrateFromCache(): Promise<UserDTO | null> {
  const snap = await kvGet<Record<string, any>>('snapshot');
  const outbox = await db.outbox.orderBy('seq').toArray().catch(() => [] as OutboxRow[]);
  if (!snap?.user) {
    set({ outbox });
    return null;
  }
  set({
    user: snap.user,
    tasks: snap.tasks ?? {},
    projects: snap.projects ?? {},
    sections: snap.sections ?? {},
    labels: snap.labels ?? {},
    filters: snap.filters ?? {},
    templates: snap.templates ?? {},
    prefs: { ...preferenceDefaults, ...(snap.prefs ?? {}) },
    serverTime: snap.serverTime ?? null,
    lastEventSeq: snap.lastEventSeq ?? 0,
    lastSyncedAt: snap.lastSyncedAt ?? null,
    outbox,
  });
  return snap.user as UserDTO;
}

// ---------------------------------------------------------------- server snapshot
function pendingIds(type: EntityType): Set<string> {
  return new Set(get().outbox.filter((r) => r.entity.type === type).map((r) => r.entity.id));
}

interface SnapshotResponse {
  serverTime: string;
  full: boolean;
  lastEventSeq: number;
  user: UserDTO;
  tasks: TaskDTO[];
  projects: ProjectDTO[];
  sections: SectionDTO[];
  labels: LabelDTO[];
  filters: SavedFilterDTO[];
  templates: TemplateDTO[];
  preferences: Record<string, unknown>;
}

function applySnapshot(snap: SnapshotResponse): void {
  const s = get();
  const pTasks = pendingIds('task');
  const keep = <T extends { id: string }>(current: Map<T>, incoming: T[], pending: Set<string>): Map<T> => {
    const next = byId(incoming);
    for (const id of pending) if (current[id]) next[id] = current[id] as T;
    return next;
  };
  let tasks: Map<TaskDTO>;
  if (snap.full) {
    tasks = byId(snap.tasks);
    for (const id of pTasks) if (s.tasks[id]) tasks[id] = s.tasks[id] as TaskDTO;
  } else {
    tasks = { ...s.tasks };
    for (const t of snap.tasks) {
      if (pTasks.has(t.id)) {
        const local = tasks[t.id];
        if (local) tasks[t.id] = { ...local, version: Math.max(local.version, t.version) };
        continue;
      }
      if (t.deletedAt) delete tasks[t.id];
      else tasks[t.id] = t;
    }
  }
  set({
    user: snap.user,
    tasks,
    projects: keep(s.projects, snap.projects, pendingIds('project')),
    sections: keep(s.sections, snap.sections, pendingIds('section')),
    labels: keep(s.labels, snap.labels, pendingIds('label')),
    filters: byId(snap.filters),
    templates: byId(snap.templates),
    prefs: { ...preferenceDefaults, ...snap.preferences },
    serverTime: snap.serverTime,
    lastEventSeq: snap.lastEventSeq,
    lastSyncedAt: new Date().toISOString(),
  });
  applyTheme(snap.user.theme);
}

let refreshing: Promise<void> | null = null;
export function refresh(full = false): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    set({ syncing: true });
    try {
      const since = full ? undefined : get().serverTime ? new Date(Date.parse(get().serverTime as string) - 5000).toISOString() : undefined;
      const snap = await api<SnapshotResponse>('GET', `/sync/snapshot${since ? `?since=${encodeURIComponent(since)}` : ''}`);
      applySnapshot(snap);
      set({ online: true });
    } catch (e) {
      if (e instanceof NetworkError) set({ online: false });
    } finally {
      set({ syncing: false });
      refreshing = null;
    }
  })();
  return refreshing;
}

// ---------------------------------------------------------------- session
export function applyTheme(theme: 'dark' | 'light' | 'system'): void {
  try {
    localStorage.setItem('wos.theme', theme);
  } catch {
    /* ignore */
  }
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#1c1c1e' : '#ffffff');
}

export async function boot(): Promise<void> {
  const cached = await hydrateFromCache();
  try {
    const sess = await api<{ authenticated: boolean; ownerConfigured: boolean; csrfToken?: string; user?: UserDTO }>('GET', '/auth/session');
    if (sess.authenticated && sess.user) {
      setCsrf(sess.csrfToken ?? '');
      const prevUser = cached?.id;
      if (prevUser && prevUser !== sess.user.id) {
        await wipeLocal();
        set({ tasks: {}, projects: {}, sections: {}, labels: {}, outbox: [] });
      }
      set({ status: 'authed', user: sess.user, ownerConfigured: true, sessionExpired: false });
      applyTheme(sess.user.theme);
      void refresh(true).then(() => flush());
    } else {
      // signed out on the server: local data of the previous session is not shown
      if (cached && get().outbox.length === 0) await wipeLocal();
      set({ status: 'anon', ownerConfigured: sess.ownerConfigured, user: null });
    }
  } catch (e) {
    if (e instanceof NetworkError && cached) {
      // offline start: run from the local snapshot
      set({ status: 'authed', online: false, user: cached });
      applyTheme(cached.theme);
    } else {
      set({ status: 'anon' });
    }
  }
}

export async function afterAuth(res: { user: UserDTO; csrfToken: string }): Promise<void> {
  const cached = await kvGet<{ userId?: string }>('snapshot');
  if (cached?.userId && cached.userId !== res.user.id) {
    await wipeLocal();
    set({ tasks: {}, projects: {}, sections: {}, labels: {}, outbox: [] });
  }
  setCsrf(res.csrfToken);
  set({ status: 'authed', user: res.user, ownerConfigured: true, sessionExpired: false });
  applyTheme(res.user.theme);
  await refresh(true);
  void flush();
}

export async function logout(): Promise<void> {
  try {
    await api('POST', '/auth/logout');
  } catch {
    /* offline: still leave locally */
  }
  await wipeLocal();
  setCsrf('');
  set({ status: 'anon', user: null, tasks: {}, projects: {}, sections: {}, labels: {}, filters: {}, templates: {}, outbox: [], conflicts: [] });
}

// ---------------------------------------------------------------- outbox
function persistOutboxRow(row: OutboxRow): Promise<number> {
  return db.outbox.add(row).catch(() => 0);
}

function enqueue(row: Omit<OutboxRow, 'id' | 'idem' | 'createdAt' | 'attempts'>): void {
  const full: OutboxRow = { ...row, id: newId(), idem: `wos-${newId()}`, createdAt: new Date().toISOString(), attempts: 0 };
  set((s) => ({ outbox: [...s.outbox, full] }));
  void persistOutboxRow(full).then((seq) => {
    if (seq) full.seq = seq;
  });
  void flush();
}

function removeRow(row: OutboxRow): void {
  set((s) => ({ outbox: s.outbox.filter((r) => r.id !== row.id) }));
  void db.outbox.where('id').equals(row.id).delete().catch(() => undefined);
}

function entityVersion(e: OutboxRow['entity']): number | undefined {
  const s = get();
  if (e.type === 'task') return s.tasks[e.id]?.version;
  if (e.type === 'project') return s.projects[e.id]?.version;
  if (e.type === 'section') return s.sections[e.id]?.version;
  return undefined;
}

function setEntityVersion(e: OutboxRow['entity'], version: number): void {
  set((s) => {
    if (e.type === 'task' && s.tasks[e.id]) return { tasks: { ...s.tasks, [e.id]: { ...(s.tasks[e.id] as TaskDTO), version } } };
    if (e.type === 'project' && s.projects[e.id]) return { projects: { ...s.projects, [e.id]: { ...(s.projects[e.id] as ProjectDTO), version } } };
    if (e.type === 'section' && s.sections[e.id]) return { sections: { ...s.sections, [e.id]: { ...(s.sections[e.id] as SectionDTO), version } } };
    return {};
  });
}

function mergeFromServer<T extends { id: string; version?: number }>(key: 'tasks' | 'projects' | 'sections' | 'labels', server: T, type: EntityType): void {
  const stillPending = get().outbox.some((r) => r.entity.type === type && r.entity.id === server.id);
  set((s) => {
    const cur = (s[key] as Map<any>)[server.id];
    const next = stillPending && cur ? { ...cur, ...(server.version !== undefined ? { version: server.version } : {}) } : server;
    return { [key]: { ...(s[key] as Map<any>), [server.id]: next } } as Partial<State>;
  });
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

let flushing = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    await sendPendingPrefs();
    for (;;) {
      const s = get();
      if (s.status !== 'authed' || s.sessionExpired) break;
      const row = s.outbox[0];
      if (!row) break;
      const verdict = await sendRow(row);
      if (verdict === 'stop') {
        scheduleFlushRetry();
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

function scheduleFlushRetry() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, 15_000);
}

async function sendRow(row: OutboxRow): Promise<'ok' | 'stop'> {
  const body = row.body ? { ...row.body } : undefined;
  if (row.needsVersion && body) {
    const v = entityVersion(row.entity);
    if (v !== undefined) body.version = v;
  }
  try {
    const data = await api<any>(row.method, row.url, body, { idempotencyKey: row.idem });
    removeRow(row);
    set({ online: true });
    applyResponse(row, data);
    return 'ok';
  } catch (e) {
    if (e instanceof NetworkError) {
      set({ online: false });
      return 'stop';
    }
    if (e instanceof ApiError) {
      if (e.status === 401) {
        set({ sessionExpired: true });
        return 'stop';
      }
      if (e.status === 409 && e.code === 'VERSION_CONFLICT') return handleConflict(row, e);
      if (e.status >= 500 || e.status === 429) {
        row.attempts++;
        return 'stop';
      }
      removeRow(row);
      if (e.status === 404) {
        if (row.entity.type === 'task') set((s) => ({ tasks: omit(s.tasks, row.entity.id) }));
        void refresh();
        return 'ok';
      }
      toast(`Couldn't save a change: ${e.message}`, 'error');
      void refresh(true);
      return 'ok';
    }
    row.attempts++;
    return 'stop';
  }
}

function omit<T>(m: Map<T>, id: string): Map<T> {
  const { [id]: _removed, ...rest } = m;
  return rest;
}

function applyResponse(row: OutboxRow, data: any): void {
  if (!data) return;
  if (row.kind === 'task.reorder' || row.kind === 'project.reorder') {
    void refresh();
    return;
  }
  if (data.task && row.kind !== 'task.delete') mergeFromServer('tasks', data.task as TaskDTO, 'task');
  if (data.project) mergeFromServer('projects', data.project as ProjectDTO, 'project');
  if (data.section) mergeFromServer('sections', data.section as SectionDTO, 'section');
  if (data.label) mergeFromServer('labels', data.label as LabelDTO, 'label');
}

function handleConflict(row: OutboxRow, e: ApiError): 'ok' | 'stop' {
  const current = e.body?.current as (TaskDTO & Record<string, unknown>) | undefined;
  row.attempts++;
  if (!current || row.attempts > 5) {
    removeRow(row);
    toast('A change could not be saved because the item changed elsewhere. It has been reloaded.', 'error');
    void refresh(true);
    return 'ok';
  }
  if (row.entity.type === 'task' && row.kind === 'task.patch' && row.base && row.body) {
    const patch = row.body;
    const fields: Conflict['fields'] = [];
    for (const key of Object.keys(row.base)) {
      const theirs = current[key];
      if (!deepEqual(theirs, row.base[key]) && !deepEqual(theirs, patch[key])) fields.push({ key, mine: patch[key], theirs });
    }
    if (fields.length) {
      removeRow(row);
      const cleanPatch = { ...patch };
      delete cleanPatch.version;
      set((s) => ({
        tasks: { ...s.tasks, [current.id]: current },
        conflicts: [...s.conflicts, { id: newId(), taskId: current.id, title: current.title, fields, patch: cleanPatch }],
      }));
      return 'ok';
    }
  }
  // no overlapping edits: keep the user's change and retry on top of the newer server version
  setEntityVersion(row.entity, current.version);
  set((s) => ({ outbox: s.outbox.map((r) => (r.id === row.id ? { ...row } : r)) }));
  return 'ok';
}

export function resolveConflict(id: string, choice: 'mine' | 'theirs'): void {
  const c = get().conflicts.find((x) => x.id === id);
  if (!c) return;
  set((s) => ({ conflicts: s.conflicts.filter((x) => x.id !== id) }));
  if (choice === 'mine') actions.updateTask(c.taskId, c.patch as Partial<TaskPatch>);
}

// ---------------------------------------------------------------- preferences
let pendingPrefs: Record<string, unknown> = {};
async function sendPendingPrefs(): Promise<void> {
  if (!Object.keys(pendingPrefs).length) return;
  const body = pendingPrefs;
  try {
    await api('PATCH', '/preferences', body);
    for (const k of Object.keys(body)) if (deepEqual(pendingPrefs[k], body[k])) delete pendingPrefs[k];
  } catch (e) {
    if (e instanceof ApiError && e.status < 500 && e.status !== 401) pendingPrefs = {};
  }
}

// ---------------------------------------------------------------- local optimistic helpers
export interface TaskPatch {
  title: string;
  description: string;
  projectId: string | null;
  sectionId: string | null;
  parentTaskId: string | null;
  priority: number;
  labelIds: string[];
  reminders: ReminderInput[];
  scheduledDate: string | null;
  scheduledAtUtc: string | null;
  dueDate: string | null;
  dueAtUtc: string | null;
  dueTimezone: string | null;
  deadlineDate: string | null;
  estimateMinutes: number | null;
  recurrence: { rule: string; mode: 'fixed' | 'after_completion' } | null;
}
export type TaskCreate = Partial<TaskPatch> & { title: string };

function nextPosition(projectId: string | null, sectionId: string | null, parentTaskId: string | null): string {
  let max: string | null = null;
  for (const t of Object.values(get().tasks)) {
    if (t.projectId === projectId && t.sectionId === sectionId && t.parentTaskId === parentTaskId && (max === null || t.position > max)) max = t.position;
  }
  return positionAfter(max);
}

function toReminders(list: ReminderInput[]): ReminderDTO[] {
  return list.map((r) => ({ id: r.id ?? newId(), kind: r.kind, offsetMinutes: r.offsetMinutes ?? null, atUtc: r.atUtc ?? null, channel: r.channel ?? 'inapp', enabled: r.enabled ?? true }));
}

function applyPatchLocal(t: TaskDTO, patch: Partial<TaskPatch>): TaskDTO {
  const next: Record<string, unknown> = { ...t };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (k === 'reminders') next.reminders = toReminders(v as ReminderInput[]);
    else if (k === 'recurrence') next.recurrence = v ? { rule: (v as any).rule, mode: (v as any).mode, timezone: t.dueTimezone } : null;
    else next[k] = v;
  }
  if (patch.projectId !== undefined && patch.projectId !== t.projectId && patch.sectionId === undefined) next.sectionId = null;
  next.updatedAt = new Date().toISOString();
  return next as unknown as TaskDTO;
}

const tz = () => get().user?.timezone ?? 'America/Vancouver';

function completeLocal(t: TaskDTO): TaskDTO {
  const now = new Date();
  if (t.recurrence && t.dueDate) {
    const cur = { date: t.dueDate, time: t.dueAtUtc ? localTimeOf(t.dueAtUtc, t.dueTimezone ?? tz()) : null };
    try {
      const next = nextOccurrence({ rule: t.recurrence.rule, mode: t.recurrence.mode }, cur, { date: todayLocal(tz()), time: localTimeOf(now, tz()) });
      if (next) {
        const due = buildDue({ date: next.date, time: next.time, timezone: t.dueTimezone ?? tz() });
        return { ...t, ...due, updatedAt: now.toISOString() };
      }
    } catch {
      /* fall through: server decides */
    }
  }
  return { ...t, status: 'completed', completedAt: now.toISOString(), updatedAt: now.toISOString() };
}

const setTask = (t: TaskDTO) => set((s) => ({ tasks: { ...s.tasks, [t.id]: t } }));

function descendantsOfTask(id: string): TaskDTO[] {
  const all = Object.values(get().tasks);
  const out: TaskDTO[] = [];
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const t of all) if (t.parentTaskId === cur) {
      out.push(t);
      queue.push(t.id);
    }
  }
  return out;
}

// ---------------------------------------------------------------- actions
export const actions = {
  createTask(input: TaskCreate): TaskDTO {
    const s = get();
    const parent = input.parentTaskId ? s.tasks[input.parentTaskId] : null;
    const projectId = parent ? parent.projectId : (input.projectId ?? null);
    const sectionId = parent ? parent.sectionId : (input.sectionId ?? null);
    const parentTaskId = input.parentTaskId ?? null;
    const now = new Date().toISOString();
    const id = newId();
    const task: TaskDTO = {
      id,
      projectId,
      sectionId,
      parentTaskId,
      title: input.title.trim(),
      description: input.description ?? '',
      priority: input.priority ?? ((s.prefs['tasks.defaultPriority'] as number) || 4),
      status: 'open',
      position: nextPosition(projectId, sectionId, parentTaskId),
      scheduledDate: input.scheduledDate ?? null,
      scheduledAtUtc: input.scheduledAtUtc ?? null,
      dueDate: input.dueDate ?? null,
      dueAtUtc: input.dueAtUtc ?? null,
      dueTimezone: input.dueTimezone ?? (input.dueDate ? tz() : null),
      deadlineDate: input.deadlineDate ?? null,
      estimateMinutes: input.estimateMinutes ?? null,
      recurrence: input.recurrence ? { rule: input.recurrence.rule, mode: input.recurrence.mode, timezone: tz() } : null,
      nextOccurrenceKey: null,
      labelIds: input.labelIds ?? [],
      reminders: toReminders(input.reminders ?? []),
      completedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    setTask(task);
    if (s.prefs['tasks.rememberLastProject'] && projectId) void actions.setPref('tasks.lastProjectId', projectId);
    const body: Record<string, unknown> = {
      id,
      title: task.title,
      description: task.description || undefined,
      projectId,
      sectionId,
      parentTaskId,
      priority: task.priority,
      labelIds: task.labelIds,
      reminders: input.reminders,
      scheduledDate: task.scheduledDate,
      scheduledAtUtc: task.scheduledAtUtc,
      dueDate: task.dueDate,
      dueAtUtc: task.dueAtUtc,
      dueTimezone: task.dueTimezone,
      deadlineDate: task.deadlineDate,
      estimateMinutes: task.estimateMinutes,
      recurrence: input.recurrence ? { rule: input.recurrence.rule, mode: input.recurrence.mode } : undefined,
    };
    for (const k of Object.keys(body)) if (body[k] === undefined || body[k] === null) delete body[k];
    enqueue({ kind: 'task.create', method: 'POST', url: '/tasks', body, entity: { type: 'task', id } });
    return task;
  },

  updateTask(id: string, patch: Partial<TaskPatch>): void {
    const cur = get().tasks[id];
    if (!cur) return;
    const base: Record<string, unknown> = {};
    for (const k of Object.keys(patch)) base[k] = (cur as unknown as Record<string, unknown>)[k];
    setTask(applyPatchLocal(cur, patch));
    // coalesce into a still-queued patch for the same task when possible (keeps the first base)
    const q = get().outbox.find((r, i) => i > 0 && r.kind === 'task.patch' && r.entity.id === id);
    if (q && q.body) {
      const merged = { ...q, body: { ...q.body, ...patch }, base: { ...base, ...(q.base ?? {}) } };
      set((s) => ({ outbox: s.outbox.map((r) => (r.id === q.id ? merged : r)) }));
      void db.outbox.where('id').equals(q.id).modify({ body: merged.body, base: merged.base }).catch(() => undefined);
      void flush();
      return;
    }
    enqueue({ kind: 'task.patch', method: 'PATCH', url: `/tasks/${id}`, body: { ...patch }, needsVersion: true, base, entity: { type: 'task', id } });
  },

  completeTask(id: string, opts: { completeSubtasks?: boolean } = {}): void {
    const t = get().tasks[id];
    if (!t || t.status !== 'open') return;
    setTask(completeLocal(t));
    if (opts.completeSubtasks) for (const d of descendantsOfTask(id)) if (d.status === 'open') setTask(completeLocal(d));
    enqueue({ kind: 'task.complete', method: 'POST', url: `/tasks/${id}/complete`, body: { completeSubtasks: opts.completeSubtasks || undefined }, needsVersion: true, entity: { type: 'task', id } });
    toast(`Completed "${t.title.slice(0, 40)}"`, 'success', { label: 'Undo', run: () => actions.reopenTask(id) });
  },

  reopenTask(id: string): void {
    const t = get().tasks[id];
    if (!t) return;
    if (t.status === 'completed') setTask({ ...t, status: 'open', completedAt: null });
    enqueue({ kind: 'task.reopen', method: 'POST', url: `/tasks/${id}/reopen`, body: {}, entity: { type: 'task', id } });
  },

  deleteTask(id: string): void {
    const t = get().tasks[id];
    if (!t) return;
    const subs = descendantsOfTask(id);
    set((s) => {
      const tasks = { ...s.tasks };
      delete tasks[id];
      for (const d of subs) delete tasks[d.id];
      return { tasks };
    });
    enqueue({ kind: 'task.delete', method: 'DELETE', url: `/tasks/${id}`, entity: { type: 'task', id } });
    toast(`Deleted "${t.title.slice(0, 40)}"`, 'info', {
      label: 'Undo',
      run: () => {
        setTask(t);
        for (const d of subs) setTask(d);
        enqueue({ kind: 'task.restore', method: 'POST', url: `/tasks/${id}/restore`, entity: { type: 'task', id } });
      },
    });
  },

  /** Moves a task within/between lists. `orderedIds` is the destination list order after the move. */
  reorderTask(taskId: string, target: { projectId: string | null; sectionId: string | null; parentTaskId?: string | null }, orderedIds: string[]): void {
    const idx = orderedIds.indexOf(taskId);
    set((s) => {
      const tasks = { ...s.tasks };
      orderedIds.forEach((tid, i) => {
        const t = tasks[tid];
        if (!t) return;
        tasks[tid] = tid === taskId ? { ...t, ...target, parentTaskId: target.parentTaskId ?? null, position: positionKey((i + 1) * POSITION_STEP) } : { ...t, position: positionKey((i + 1) * POSITION_STEP) };
      });
      return { tasks };
    });
    const before = orderedIds[idx + 1];
    const after = orderedIds[idx - 1];
    enqueue({
      kind: 'task.reorder',
      method: 'POST',
      url: '/tasks/reorder',
      body: { taskId, projectId: target.projectId, sectionId: target.sectionId, parentTaskId: target.parentTaskId ?? null, ...(before ? { beforeTaskId: before } : after ? { afterTaskId: after } : {}) },
      entity: { type: 'task', id: taskId },
    });
  },

  // ---- projects
  createProject(input: { name: string; color?: string; favorite?: boolean; parentProjectId?: string | null; defaultView?: 'list' | 'board' }): ProjectDTO {
    const now = new Date().toISOString();
    const id = newId();
    const sortOrder = Math.max(0, ...Object.values(get().projects).map((p) => p.sortOrder)) + 1;
    const p: ProjectDTO = { id, parentProjectId: input.parentProjectId ?? null, name: input.name.trim(), description: '', outcome: '', color: input.color ?? '#8b8d98', icon: null, favorite: input.favorite ?? false, archivedAt: null, sortOrder, defaultView: input.defaultView ?? 'list', createdAt: now, updatedAt: now, version: 1 };
    set((s) => ({ projects: { ...s.projects, [id]: p } }));
    enqueue({ kind: 'project.create', method: 'POST', url: '/projects', body: { id, name: p.name, color: p.color, favorite: p.favorite, parentProjectId: p.parentProjectId, defaultView: p.defaultView }, entity: { type: 'project', id } });
    return p;
  },
  updateProject(id: string, patch: Partial<{ name: string; description: string; outcome: string; color: string; favorite: boolean; archived: boolean; defaultView: 'list' | 'board'; parentProjectId: string | null }>): void {
    const cur = get().projects[id];
    if (!cur) return;
    const { archived, ...rest } = patch;
    set((s) => ({ projects: { ...s.projects, [id]: { ...cur, ...rest, ...(archived !== undefined ? { archivedAt: archived ? new Date().toISOString() : null } : {}) } as ProjectDTO } }));
    enqueue({ kind: 'project.patch', method: 'PATCH', url: `/projects/${id}`, body: { ...patch }, needsVersion: true, entity: { type: 'project', id } });
  },
  /** Deleting needs an explicit task policy, so it is an online operation. */
  async deleteProject(id: string, policy: 'move_to_inbox' | 'archive' | 'delete'): Promise<void> {
    await api('DELETE', `/projects/${id}?taskPolicy=${policy}&confirm=true`);
    await refresh(true);
  },

  // ---- sections
  createSection(projectId: string, name: string, opts: { isDone?: boolean } = {}): SectionDTO {
    const now = new Date().toISOString();
    const id = newId();
    const sortOrder = Math.max(0, ...Object.values(get().sections).filter((x) => x.projectId === projectId).map((x) => x.sortOrder)) + 1;
    const sec: SectionDTO = { id, projectId, name: name.trim(), sortOrder, archivedAt: null, isDone: !!opts.isDone, createdAt: now, updatedAt: now, version: 1 };
    set((s) => ({
      sections: {
        ...Object.fromEntries(Object.entries(s.sections).map(([k, x]) => [k, opts.isDone && x.projectId === projectId && x.isDone ? { ...x, isDone: false } : x])),
        [id]: sec,
      },
    }));
    enqueue({ kind: 'section.create', method: 'POST', url: `/projects/${projectId}/sections`, body: { id, name: sec.name, ...(opts.isDone ? { isDone: true } : {}) }, entity: { type: 'section', id } });
    return sec;
  },
  updateSection(id: string, patch: { name?: string; archived?: boolean; isDone?: boolean }): void {
    const cur = get().sections[id];
    if (!cur) return;
    set((s) => ({
      sections: {
        // only one Done column per project
        ...Object.fromEntries(Object.entries(s.sections).map(([k, x]) => [k, patch.isDone && x.projectId === cur.projectId && x.id !== id && x.isDone ? { ...x, isDone: false } : x])),
        [id]: { ...cur, ...(patch.name ? { name: patch.name } : {}), ...(patch.isDone !== undefined ? { isDone: patch.isDone } : {}), ...(patch.archived !== undefined ? { archivedAt: patch.archived ? new Date().toISOString() : null } : {}) },
      },
    }));
    enqueue({ kind: 'section.patch', method: 'PATCH', url: `/sections/${id}`, body: { ...patch }, needsVersion: true, entity: { type: 'section', id } });
  },
  /** Moves a project to the top of the sidebar list (first among its siblings). */
  moveProjectToTop(id: string): void {
    const all = Object.values(get().projects).sort((a, b) => a.sortOrder - b.sortOrder);
    const ids = [id, ...all.filter((p) => p.id !== id).map((p) => p.id)];
    set((s) => ({ projects: Object.fromEntries(Object.entries(s.projects).map(([k, p]) => [k, { ...p, sortOrder: ids.indexOf(k) + 1 }])) }));
    enqueue({ kind: 'project.reorder', method: 'POST', url: '/projects/reorder', body: { ids }, entity: { type: 'project', id } });
  },
  /** Reorders the board columns of a project. `ids` is the new left-to-right order of its sections. */
  reorderSections(projectId: string, ids: string[]): void {
    set((s) => ({ sections: Object.fromEntries(Object.entries(s.sections).map(([k, x]) => [k, x.projectId === projectId && ids.includes(x.id) ? { ...x, sortOrder: ids.indexOf(x.id) + 1 } : x])) }));
    enqueue({ kind: 'section.reorder', method: 'POST', url: '/sections/reorder', body: { projectId, ids }, entity: { type: 'project', id: projectId } });
  },
  deleteSection(id: string): void {
    set((s) => ({
      sections: omit(s.sections, id),
      tasks: Object.fromEntries(Object.entries(s.tasks).map(([k, t]) => [k, t.sectionId === id ? { ...t, sectionId: null } : t])),
    }));
    enqueue({ kind: 'section.delete', method: 'DELETE', url: `/sections/${id}`, entity: { type: 'section', id } });
  },

  // ---- labels
  createLabel(name: string, color?: string): LabelDTO {
    const existing = Object.values(get().labels).find((l) => l.name.toLowerCase() === name.trim().toLowerCase());
    if (existing) return existing;
    const now = new Date().toISOString();
    const id = newId();
    const l: LabelDTO = { id, name: name.trim(), color: color ?? '#8b8d98', sortOrder: Object.keys(get().labels).length + 1, favorite: false, createdAt: now, updatedAt: now };
    set((s) => ({ labels: { ...s.labels, [id]: l } }));
    enqueue({ kind: 'label.create', method: 'POST', url: '/labels', body: { id, name: l.name, color: l.color }, entity: { type: 'label', id } });
    return l;
  },
  updateLabel(id: string, patch: { name?: string; color?: string; favorite?: boolean }): void {
    const cur = get().labels[id];
    if (!cur) return;
    set((s) => ({ labels: { ...s.labels, [id]: { ...cur, ...patch } } }));
    enqueue({ kind: 'label.patch', method: 'PATCH', url: `/labels/${id}`, body: { ...patch }, entity: { type: 'label', id } });
  },
  deleteLabel(id: string): void {
    set((s) => ({
      labels: omit(s.labels, id),
      tasks: Object.fromEntries(Object.entries(s.tasks).map(([k, t]) => [k, t.labelIds.includes(id) ? { ...t, labelIds: t.labelIds.filter((x) => x !== id) } : t])),
    }));
    enqueue({ kind: 'label.delete', method: 'DELETE', url: `/labels/${id}`, entity: { type: 'label', id } });
  },

  // ---- preferences
  async setPref(key: string, value: unknown): Promise<void> {
    set((s) => ({ prefs: { ...s.prefs, [key]: value } }));
    pendingPrefs[key] = value;
    void flush();
  },

  openQuickAdd(defaults: State['quickAddDefaults'] = null): void {
    set({ quickAddOpen: true, quickAddDefaults: defaults });
  },
  closeQuickAdd(): void {
    set({ quickAddOpen: false, quickAddDefaults: null });
  },
  openTask(id: string | null): void {
    set({ openTaskId: id });
  },
  setOnline(online: boolean): void {
    set({ online });
    if (online) {
      void refresh().then(() => flush());
    }
  },
  setStream(stream: State['stream']): void {
    set({ stream });
  },
  async patchProfile(p: Partial<Pick<UserDTO, 'displayName' | 'timezone' | 'weekStartsOn' | 'theme' | 'timeFormat'>> & { email?: string | null }): Promise<void> {
    try {
      const r = await api<{ user: UserDTO }>('PATCH', '/user/profile', p);
      set({ user: r.user });
      applyTheme(r.user.theme);
    } catch (e) {
      toast(errorMessage(e), 'error');
      throw e;
    }
  },
};
