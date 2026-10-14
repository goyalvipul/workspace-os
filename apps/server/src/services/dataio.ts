import { createHmac } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  addDays,
  buildDue,
  commentSchema,
  isValidDateStr,
  labelSchema,
  localDateOf,
  localTimeOf,
  parseQuickAdd,
  projectSchema,
  savedFilterSchema,
  sectionSchema,
  taskSchema,
  templateBodySchema,
  type TaskDTO,
} from '@wos/shared';
import type { AppContext } from '../context.js';
import { schema } from '../db/client.js';
import { AppError, badRequest } from '../errors.js';
import { nowIso, safeEqual, sha256 } from '../util.js';
import type { UserRow } from './auth.js';
import { filterToDTO, hydrateTasks, labelToDTO, projectToDTO, sectionToDTO, templateToDTO } from './mappers.js';
import { completeTask, createTask, type Scope } from './tasks.js';
import { createProject, createSection, ensureLabelNames } from './workspace.js';

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

// ====================== CSV ======================
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQ = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string;
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

/** Neutralise spreadsheet formula injection: cells starting with = + - @ TAB CR get a leading apostrophe. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const EXPORT_COLUMNS = ['id', 'parent_id', 'title', 'description', 'project', 'section', 'priority', 'status', 'due_date', 'due_time', 'scheduled_date', 'deadline_date', 'labels', 'recurrence', 'created_at', 'completed_at'] as const;

export function exportTasksCsv(ctx: AppContext, user: UserRow): string {
  const T = schema.tasks;
  const rows = ctx.db.select().from(T).where(and(eq(T.ownerUserId, user.id), isNull(T.deletedAt))).orderBy(T.createdAt).all();
  const tasks = hydrateTasks(ctx.db, rows);
  const projects = new Map(ctx.db.select().from(schema.projects).where(eq(schema.projects.ownerUserId, user.id)).all().map((p) => [p.id, p.name]));
  const sections = new Map(ctx.db.select().from(schema.sections).all().map((s) => [s.id, s.name]));
  const labels = new Map(ctx.db.select().from(schema.labels).where(eq(schema.labels.ownerUserId, user.id)).all().map((l) => [l.id, l.name]));
  const lines = [EXPORT_COLUMNS.join(',')];
  for (const t of tasks) {
    const tz = t.dueTimezone ?? user.timezone;
    lines.push(
      [
        t.id,
        t.parentTaskId ?? '',
        t.title,
        t.description,
        t.projectId ? (projects.get(t.projectId) ?? '') : '',
        t.sectionId ? (sections.get(t.sectionId) ?? '') : '',
        t.priority,
        t.status,
        t.dueDate ?? '',
        t.dueAtUtc ? localTimeOf(t.dueAtUtc, tz) : '',
        t.scheduledDate ?? '',
        t.deadlineDate ?? '',
        t.labelIds.map((l) => labels.get(l) ?? '').filter(Boolean).join(';'),
        t.recurrence ? `${t.recurrence.rule}|${t.recurrence.mode}` : '',
        t.createdAt,
        t.completedAt ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

// ====================== JSON workspace export / import ======================
export const WORKSPACE_SCHEMA_VERSION = 1;

export function exportWorkspace(ctx: AppContext, user: UserRow) {
  const T = schema.tasks;
  const taskRows = ctx.db.select().from(T).where(and(eq(T.ownerUserId, user.id), isNull(T.deletedAt))).orderBy(T.createdAt).all();
  const projectRows = ctx.db.select().from(schema.projects).where(eq(schema.projects.ownerUserId, user.id)).all();
  const projectIds = new Set(projectRows.map((p) => p.id));
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    exportedAt: nowIso(),
    app: 'workspace-os',
    timezone: user.timezone,
    projects: projectRows.map(projectToDTO),
    sections: ctx.db.select().from(schema.sections).all().filter((s) => projectIds.has(s.projectId)).map(sectionToDTO),
    labels: ctx.db.select().from(schema.labels).where(eq(schema.labels.ownerUserId, user.id)).all().map(labelToDTO),
    tasks: hydrateTasks(ctx.db, taskRows),
    comments: ctx.db.select().from(schema.taskComments).where(and(eq(schema.taskComments.ownerUserId, user.id), isNull(schema.taskComments.deletedAt))).all().map((c) => ({ id: c.id, taskId: c.taskId, body: c.body, createdAt: c.createdAt, updatedAt: c.updatedAt })),
    filters: ctx.db.select().from(schema.savedFilters).where(eq(schema.savedFilters.ownerUserId, user.id)).all().map(filterToDTO),
    templates: ctx.db.select().from(schema.templates).where(eq(schema.templates.ownerUserId, user.id)).all().map(templateToDTO),
    activity: ctx.db.select().from(schema.activityEvents).where(eq(schema.activityEvents.ownerUserId, user.id)).orderBy(schema.activityEvents.createdAt).limit(10_000).all().map((a) => ({ id: a.id, entityType: a.entityType, entityId: a.entityId, projectId: a.projectId, action: a.action, summary: a.publicSummary, createdAt: a.createdAt })),
  };
}

const workspaceFile = z.object({
  schemaVersion: z.number().int(),
  projects: z.array(projectSchema).max(5000),
  sections: z.array(sectionSchema).max(20000),
  labels: z.array(labelSchema).max(5000),
  tasks: z.array(taskSchema).max(200000),
  comments: z.array(commentSchema).max(100000).default([]),
  filters: z.array(savedFilterSchema).max(2000).default([]),
  templates: z.array(z.object({ id: z.string(), name: z.string(), description: z.string(), kind: z.enum(['project', 'task']), body: templateBodySchema })).max(500).default([]),
});

export interface ImportReport {
  created: Record<string, number>;
  skippedExisting: number;
  idConflicts: { type: string; id: string }[];
  warnings: string[];
}

export function importWorkspaceJson(s: Scope, raw: unknown): ImportReport {
  const parsed = workspaceFile.safeParse(raw);
  if (!parsed.success) throw badRequest('Not a valid Workspace OS export', parsed.error.issues.slice(0, 10).map((i) => ({ field: i.path.join('.'), message: i.message })));
  const f = parsed.data;
  if (f.schemaVersion > WORKSPACE_SCHEMA_VERSION) throw badRequest(`Export schema version ${f.schemaVersion} is newer than this app supports (${WORKSPACE_SCHEMA_VERSION})`);
  const report: ImportReport = { created: { projects: 0, sections: 0, labels: 0, tasks: 0, comments: 0, filters: 0, templates: 0 }, skippedExisting: 0, idConflicts: [], warnings: [] };
  const TABLES = { projects: 'projects', sections: 'sections', labels: 'labels', tasks: 'tasks', savedFilters: 'saved_filters', templates: 'templates', taskComments: 'task_comments' } as const;
  const owns = (table: keyof typeof TABLES, id: string): 'own' | 'foreign' | 'none' => {
    if (table === 'sections') return s.tx.get<{ o: string } | undefined>(sql`SELECT id AS o FROM sections WHERE id = ${id}`) ? 'own' : 'none';
    const row = s.tx.get<{ o: string | null } | undefined>(sql`SELECT owner_user_id AS o FROM ${sql.raw(TABLES[table])} WHERE id = ${id}`);
    if (!row) return 'none';
    return row.o === s.ownerId ? 'own' : 'foreign';
  };
  const now = nowIso();
  // projects (parents first)
  const pending = [...f.projects];
  const done = new Set<string>(f.projects.map((p) => p.id).filter((id) => owns('projects', id) === 'own'));
  let guard = pending.length + 5;
  while (pending.length && guard-- > 0) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i] as (typeof pending)[number];
      if (p.parentProjectId && !done.has(p.parentProjectId)) continue;
      const own = owns('projects', p.id);
      if (own === 'own') report.skippedExisting++;
      else if (own === 'foreign') report.idConflicts.push({ type: 'project', id: p.id });
      else {
        s.tx.insert(schema.projects).values({ id: p.id, ownerUserId: s.ownerId, parentProjectId: p.parentProjectId, name: p.name, description: p.description, outcome: p.outcome, color: p.color, icon: p.icon, favorite: p.favorite, archivedAt: p.archivedAt, sortOrder: p.sortOrder, defaultView: p.defaultView, createdAt: p.createdAt, updatedAt: now, version: 1 }).run();
        report.created.projects = (report.created.projects ?? 0) + 1;
      }
      done.add(p.id);
      pending.splice(i, 1);
    }
  }
  for (const sec of f.sections) {
    const own = owns('sections', sec.id);
    if (own === 'own') { report.skippedExisting++; continue; }
    if (!done.has(sec.projectId)) { report.warnings.push(`Section "${sec.name}" skipped: its project is missing`); continue; }
    s.tx.insert(schema.sections).values({ id: sec.id, projectId: sec.projectId, name: sec.name, sortOrder: sec.sortOrder, archivedAt: sec.archivedAt, createdAt: sec.createdAt, updatedAt: now, version: 1 }).run();
    report.created.sections = (report.created.sections ?? 0) + 1;
  }
  const labelIdMap = new Map<string, string>();
  for (const l of f.labels) {
    const byName = s.tx.select().from(schema.labels).where(and(eq(schema.labels.ownerUserId, s.ownerId), eq(schema.labels.nameLower, l.name.toLowerCase()))).get();
    if (byName) { labelIdMap.set(l.id, byName.id); report.skippedExisting++; continue; }
    const own = owns('labels', l.id);
    const id = own === 'none' ? l.id : undefined;
    if (own === 'foreign') report.idConflicts.push({ type: 'label', id: l.id });
    const created = ensureLabelNames(s, [l.name]);
    void id;
    labelIdMap.set(l.id, created[0] as string);
    report.created.labels = (report.created.labels ?? 0) + 1;
  }
  // tasks: parents first
  const taskIds = new Set(f.tasks.map((t) => t.id));
  const sorted: TaskDTO[] = [];
  const placed = new Set<string>();
  const visit = (t: TaskDTO, depth = 0) => {
    if (placed.has(t.id) || depth > 10) return;
    if (t.parentTaskId && taskIds.has(t.parentTaskId)) visit(f.tasks.find((x) => x.id === t.parentTaskId) as TaskDTO, depth + 1);
    placed.add(t.id);
    sorted.push(t);
  };
  f.tasks.forEach((t) => visit(t));
  for (const t of sorted) {
    const own = owns('tasks', t.id);
    if (own === 'own') { report.skippedExisting++; continue; }
    if (own === 'foreign') { report.idConflicts.push({ type: 'task', id: t.id }); continue; }
    const projectOk = !t.projectId || done.has(t.projectId);
    const created = createTask(s, {
      id: t.id,
      title: t.title,
      description: t.description,
      projectId: projectOk ? t.projectId : null,
      sectionId: projectOk ? t.sectionId : null,
      parentTaskId: t.parentTaskId && placed.has(t.parentTaskId) ? t.parentTaskId : null,
      priority: t.priority,
      labelIds: t.labelIds.map((l) => labelIdMap.get(l)).filter((x): x is string => !!x),
      scheduledDate: t.scheduledDate,
      scheduledAtUtc: t.scheduledAtUtc,
      dueDate: t.dueDate,
      dueAtUtc: t.dueAtUtc,
      dueTimezone: t.dueTimezone ?? undefined,
      deadlineDate: t.deadlineDate,
      estimateMinutes: t.estimateMinutes,
      recurrence: t.recurrence,
    }).task;
    if (t.status === 'completed' && !t.recurrence) completeTask(s, created.id, { version: created.version });
    report.created.tasks = (report.created.tasks ?? 0) + 1;
  }
  for (const c of f.comments) {
    if (!placed.has(c.taskId) && !s.tx.select().from(schema.tasks).where(eq(schema.tasks.id, c.taskId)).get()) continue;
    if (s.tx.select().from(schema.taskComments).where(eq(schema.taskComments.id, c.id)).get()) continue;
    s.tx.insert(schema.taskComments).values({ id: c.id, taskId: c.taskId, ownerUserId: s.ownerId, body: c.body, createdAt: c.createdAt, updatedAt: c.updatedAt }).run();
    report.created.comments = (report.created.comments ?? 0) + 1;
  }
  for (const flt of f.filters) {
    if (owns('savedFilters', flt.id) !== 'none') continue;
    s.tx.insert(schema.savedFilters).values({ id: flt.id, ownerUserId: s.ownerId, name: flt.name, description: flt.description, filterAstJson: JSON.stringify(flt.ast), sort: flt.sort, favorite: flt.favorite, createdAt: flt.createdAt, updatedAt: now }).run();
    report.created.filters = (report.created.filters ?? 0) + 1;
  }
  for (const tpl of f.templates) {
    if (owns('templates', tpl.id) !== 'none') continue;
    s.tx.insert(schema.templates).values({ id: tpl.id, ownerUserId: s.ownerId, name: tpl.name, description: tpl.description, kind: tpl.kind, bodyJson: JSON.stringify(tpl.body), isBuiltin: false, createdAt: now, updatedAt: now }).run();
    report.created.templates = (report.created.templates ?? 0) + 1;
  }
  s.ev.activity({ entityType: 'import', entityId: 'workspace', action: 'import.workspace', summary: `imported a workspace export (${report.created.tasks ?? 0} tasks)` });
  s.ev.emit('task.changed', null, { all: true });
  s.ev.emit('project.changed', null, { all: true });
  return report;
}

// ====================== CSV import (Todoist / Workspace OS) ======================
export type ImportKind = 'todoist_csv' | 'wos_csv';

interface PlanTask {
  key: string;
  parentKey: string | null;
  title: string;
  description: string;
  priority: number;
  project: string | null;
  section: string | null;
  dueDate: string | null;
  dueTime: string | null;
  scheduledDate: string | null;
  deadlineDate: string | null;
  labels: string[];
  recurrenceRule: string | null;
  recurrenceMode: 'fixed' | 'after_completion';
  completed: boolean;
}

export interface ImportPlan {
  kind: ImportKind;
  projects: string[];
  sections: { project: string | null; name: string }[];
  tasks: PlanTask[];
  unsupported: Record<string, number>;
  warnings: string[];
  duplicates: number;
}

export function buildImportPlan(ctx: AppContext, user: UserRow, kind: ImportKind, content: string, opts: { projectName?: string }): ImportPlan {
  if (Buffer.byteLength(content) > MAX_IMPORT_BYTES) throw new AppError(413, 'IMPORT_TOO_LARGE', 'Import files are limited to 2 MB');
  const rows = parseCsv(content);
  if (rows.length < 2) throw badRequest('The file has no data rows');
  const header = (rows[0] as string[]).map((h) => h.trim().toUpperCase());
  const col = (name: string) => header.indexOf(name);
  const plan: ImportPlan = { kind, projects: [], sections: [], tasks: [], unsupported: {}, warnings: [], duplicates: 0 };
  const today = localDateOf(new Date(), user.timezone);
  const unsupported = (k: string) => { plan.unsupported[k] = (plan.unsupported[k] ?? 0) + 1; };
  const ctxParse = { today, projects: [], labels: [] };
  const parseDateText = (text: string): { date: string | null; time: string | null; rule: string | null } => {
    const t = text.trim();
    if (!t) return { date: null, time: null, rule: null };
    if (isValidDateStr(t.slice(0, 10))) return { date: t.slice(0, 10), time: /T(\d{2}:\d{2})/.exec(t)?.[1] ?? null, rule: null };
    const r = parseQuickAdd(t, ctxParse);
    if (!r.dueDate && !r.recurrenceRule) return { date: null, time: null, rule: null };
    return { date: r.dueDate ?? (r.recurrenceRule ? today : null), time: r.dueTime, rule: r.recurrenceRule };
  };

  if (kind === 'todoist_csv') {
    for (const need of ['TYPE', 'CONTENT']) if (col(need) < 0) throw badRequest(`Missing required column ${need}. Expected a Todoist CSV export/template.`);
    const projectName = opts.projectName?.trim() || 'Imported from Todoist';
    plan.projects.push(projectName);
    let section: string | null = null;
    const stack: string[] = [];
    rows.slice(1).forEach((r, i) => {
      const type = (r[col('TYPE')] ?? '').trim().toLowerCase();
      const content2 = (r[col('CONTENT')] ?? '').trim();
      if (type === 'section') {
        section = content2 || null;
        if (section) plan.sections.push({ project: projectName, name: section });
        stack.length = 0;
        return;
      }
      if (type === 'note') return unsupported('comments/notes');
      if (type !== 'task') return unsupported(`row type "${type || 'empty'}"`);
      if (!content2) return unsupported('tasks without a title');
      const indent = Math.max(1, Number(r[col('INDENT')] ?? 1) || 1);
      stack.length = indent - 1;
      const parentKey = stack[indent - 2] ?? null;
      const key = `t${i}`;
      stack[indent - 1] = key;
      const pr = Number(r[col('PRIORITY')] ?? 4);
      const when = parseDateText(r[col('DATE')] ?? '');
      if ((r[col('DATE')] ?? '').trim() && !when.date && !when.rule) unsupported('unrecognised date text');
      plan.tasks.push({ key, parentKey, title: content2.slice(0, 500), description: (r[col('DESCRIPTION')] ?? '').slice(0, 20000), priority: pr >= 1 && pr <= 4 ? 5 - pr : 4, project: projectName, section: parentKey ? null : section, dueDate: when.date, dueTime: when.time, scheduledDate: null, deadlineDate: null, labels: [], recurrenceRule: when.rule, recurrenceMode: 'fixed', completed: false });
    });
    plan.warnings.push('Todoist CSV cannot express labels, comments, reminders or completed history; those are not imported. PRIORITY is mapped assuming the API convention (4 = highest).');
  } else {
    for (const need of ['TITLE']) if (col(need) < 0) throw badRequest(`Missing required column ${need}`);
    const idxOf = (n: string) => col(n.toUpperCase());
    const idToKey = new Map<string, string>();
    rows.slice(1).forEach((r, i) => {
      const get = (n: string) => (r[idxOf(n)] ?? '').trim();
      const title = get('title');
      if (!title) return unsupported('tasks without a title');
      const key = `t${i}`;
      if (get('id')) idToKey.set(get('id'), key);
      const rec = get('recurrence').split('|');
      const project = get('project') || null;
      if (project && !plan.projects.includes(project)) plan.projects.push(project);
      const section = get('section') || null;
      if (section && !plan.sections.some((x) => x.project === project && x.name === section)) plan.sections.push({ project, name: section });
      const due = get('due_date');
      plan.tasks.push({ key, parentKey: get('parent_id') || null, title: title.slice(0, 500), description: get('description').slice(0, 20000), priority: Math.min(4, Math.max(1, Number(get('priority')) || 4)), project, section, dueDate: isValidDateStr(due) ? due : null, dueTime: /^\d{2}:\d{2}$/.test(get('due_time')) ? get('due_time') : null, scheduledDate: isValidDateStr(get('scheduled_date')) ? get('scheduled_date') : null, deadlineDate: isValidDateStr(get('deadline_date')) ? get('deadline_date') : null, labels: get('labels').split(';').map((x) => x.trim()).filter(Boolean), recurrenceRule: rec[0] || null, recurrenceMode: rec[1] === 'after_completion' ? 'after_completion' : 'fixed', completed: get('status') === 'completed' });
    });
    for (const t of plan.tasks) t.parentKey = t.parentKey ? (idToKey.get(t.parentKey) ?? null) : null;
  }
  if (plan.tasks.length > 5000) throw new AppError(413, 'IMPORT_TOO_LARGE', 'Import at most 5,000 tasks at a time');

  // duplicate detection: same title + project name + due date already exists
  const existing = ctx.db.select({ title: schema.tasks.title, due: schema.tasks.dueDate, p: schema.projects.name }).from(schema.tasks).leftJoin(schema.projects, eq(schema.projects.id, schema.tasks.projectId)).where(and(eq(schema.tasks.ownerUserId, user.id), isNull(schema.tasks.deletedAt))).all();
  const sig = new Set(existing.map((e) => `${e.title.toLowerCase()}|${(e.p ?? '').toLowerCase()}|${e.due ?? ''}`));
  plan.tasks = plan.tasks.filter((t) => {
    const k = `${t.title.toLowerCase()}|${(t.project ?? '').toLowerCase()}|${t.dueDate ?? ''}`;
    if (sig.has(k)) { plan.duplicates++; return false; }
    return true;
  });
  return plan;
}

export function applyImportPlan(s: Scope, plan: ImportPlan): { created: number; projects: number } {
  const projectIds = new Map<string, string>();
  for (const name of plan.projects) {
    const ex = s.tx.select().from(schema.projects).where(and(eq(schema.projects.ownerUserId, s.ownerId))).all().find((p) => p.name.toLowerCase() === name.toLowerCase() && !p.archivedAt);
    projectIds.set(name, ex ? ex.id : createProject(s, { name }).project.id);
  }
  const sectionIds = new Map<string, string>();
  for (const sec of plan.sections) {
    const pid = sec.project ? projectIds.get(sec.project) : null;
    if (!pid) continue;
    const ex = s.tx.select().from(schema.sections).where(eq(schema.sections.projectId, pid)).all().find((x) => x.name.toLowerCase() === sec.name.toLowerCase());
    sectionIds.set(`${sec.project}|${sec.name}`, ex ? ex.id : createSection(s, pid, { name: sec.name }).id);
  }
  const keyToId = new Map<string, string>();
  const tz = s.tz;
  let created = 0;
  for (const t of plan.tasks) {
    const labelIds = t.labels.length ? ensureLabelNames(s, t.labels) : [];
    const due = t.dueDate ? buildDue({ date: t.dueDate, time: t.dueTime, timezone: tz }) : null;
    const parentId = t.parentKey ? keyToId.get(t.parentKey) : undefined;
    const out = createTask(s, {
      title: t.title,
      description: t.description,
      priority: t.priority,
      projectId: parentId ? undefined : t.project ? projectIds.get(t.project) : null,
      sectionId: parentId ? undefined : t.section ? sectionIds.get(`${t.project}|${t.section}`) : null,
      parentTaskId: parentId,
      labelIds,
      dueDate: due?.dueDate,
      dueAtUtc: due?.dueAtUtc ?? undefined,
      dueTimezone: due?.dueTimezone,
      scheduledDate: t.scheduledDate ?? undefined,
      deadlineDate: t.deadlineDate ?? undefined,
      recurrence: t.recurrenceRule && due ? { rule: t.recurrenceRule, mode: t.recurrenceMode } : undefined,
    }).task;
    keyToId.set(t.key, out.id);
    if (t.completed && !t.recurrenceRule) completeTask(s, out.id, { version: out.version });
    created++;
  }
  s.ev.activity({ entityType: 'import', entityId: plan.kind, action: 'import.csv', summary: `imported ${created} tasks from ${plan.kind === 'todoist_csv' ? 'a Todoist CSV' : 'a CSV file'}` });
  s.ev.emit('task.changed', null, { all: true });
  s.ev.emit('project.changed', null, { all: true });
  return { created, projects: projectIds.size };
}

// ====================== import tokens (preview -> apply binding) ======================
export function signImportToken(ctx: AppContext, userId: string, kind: string, content: string, opts: string): string {
  const exp = Date.now() + 15 * 60_000;
  const mac = createHmac('sha256', ctx.env.SESSION_SECRET as string).update(`import|${userId}|${kind}|${sha256(content)}|${opts}|${exp}`).digest('base64url');
  return `${exp}.${mac}`;
}

export function verifyImportToken(ctx: AppContext, userId: string, kind: string, content: string, opts: string, token: string): boolean {
  const [expStr, mac] = token.split('.');
  const exp = Number(expStr);
  if (!exp || !mac || exp < Date.now()) return false;
  const expected = createHmac('sha256', ctx.env.SESSION_SECRET as string).update(`import|${userId}|${kind}|${sha256(content)}|${opts}|${exp}`).digest('base64url');
  return safeEqual(mac, expected);
}

export function planSummary(plan: ImportPlan) {
  return {
    kind: plan.kind,
    tasks: plan.tasks.length,
    subtasks: plan.tasks.filter((t) => t.parentKey).length,
    projects: plan.projects,
    sections: plan.sections.length,
    duplicatesSkipped: plan.duplicates,
    unsupported: plan.unsupported,
    warnings: plan.warnings,
    sample: plan.tasks.slice(0, 8).map((t) => ({ title: t.title, project: t.project, section: t.section, dueDate: t.dueDate, priority: t.priority })),
  };
}

export { addDays };
