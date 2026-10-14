import { and, asc, desc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  buildDue,
  localDateOf,
  localTimeOf,
  localToUtc,
  newId,
  nextOccurrence,
  normalizeRule,
  occurrenceKey as makeOccurrenceKey,
  positionAfter,
  positionKey,
  addDays,
  diffDays,
  type LocalMoment,
  type Recurrence,
  type TaskCreateInput,
  type TaskDTO,
  type TaskPatchInput,
  type ReminderInput,
  POSITION_STEP,
} from '@wos/shared';
import { schema, type Tx } from '../db/client.js';
import { badRequest, notFound, versionConflict } from '../errors.js';
import { nowIso } from '../util.js';
import { getTaskDTO, hydrateTasks } from './mappers.js';
import type { Emitter } from './tx.js';

export interface Scope {
  tx: Tx;
  ev: Emitter;
  ownerId: string;
  tz: string;
}

type TaskRow = typeof schema.tasks.$inferSelect;
const T = schema.tasks;

export function loadOwnedTask(s: Scope, id: string): TaskRow {
  const row = s.tx.select().from(T).where(and(eq(T.id, id), eq(T.ownerUserId, s.ownerId))).get();
  if (!row) throw notFound('Task');
  return row;
}

function dto(s: Scope, id: string): TaskDTO {
  const d = getTaskDTO(s.tx, s.ownerId, id);
  if (!d) throw notFound('Task');
  return d;
}

function assertProject(s: Scope, projectId: string) {
  const p = s.tx.select().from(schema.projects).where(and(eq(schema.projects.id, projectId), eq(schema.projects.ownerUserId, s.ownerId))).get();
  if (!p) throw badRequest('Project not found', [{ field: 'projectId', message: 'Project not found' }]);
  return p;
}

function assertSection(s: Scope, sectionId: string, projectId: string | null) {
  const sec = s.tx.select().from(schema.sections).where(eq(schema.sections.id, sectionId)).get();
  if (!sec || !projectId || sec.projectId !== projectId) {
    throw badRequest('Section does not belong to that project', [{ field: 'sectionId', message: 'Section does not belong to the project' }]);
  }
  return sec;
}

function assertLabels(s: Scope, labelIds: string[]) {
  if (labelIds.length === 0) return;
  const found = s.tx.select({ id: schema.labels.id }).from(schema.labels).where(and(inArray(schema.labels.id, labelIds), eq(schema.labels.ownerUserId, s.ownerId))).all();
  if (found.length !== new Set(labelIds).size) throw badRequest('Unknown label', [{ field: 'labelIds', message: 'One or more labels do not exist' }]);
}

export function descendantRows(s: Scope, taskId: string): TaskRow[] {
  const out: TaskRow[] = [];
  let frontier = [taskId];
  const seen = new Set<string>([taskId]);
  while (frontier.length) {
    const kids = s.tx.select().from(T).where(and(inArray(T.parentTaskId, frontier), eq(T.ownerUserId, s.ownerId))).all();
    frontier = [];
    for (const k of kids) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      out.push(k);
      frontier.push(k.id);
    }
  }
  return out;
}

function depthOf(s: Scope, taskId: string): number {
  let depth = 0;
  let cur: string | null = taskId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const row: { parentTaskId: string | null } | undefined = s.tx.select({ parentTaskId: T.parentTaskId }).from(T).where(eq(T.id, cur)).get();
    cur = row?.parentTaskId ?? null;
    if (cur) depth++;
  }
  return depth;
}

function siblingsWhere(ownerId: string, projectId: string | null, sectionId: string | null, parentTaskId: string | null): SQL {
  return and(
    eq(T.ownerUserId, ownerId),
    projectId ? eq(T.projectId, projectId) : isNull(T.projectId),
    sectionId ? eq(T.sectionId, sectionId) : isNull(T.sectionId),
    parentTaskId ? eq(T.parentTaskId, parentTaskId) : isNull(T.parentTaskId),
    isNull(T.deletedAt),
    eq(T.status, 'open'),
  ) as SQL;
}

function nextPosition(s: Scope, projectId: string | null, sectionId: string | null, parentTaskId: string | null): string {
  const row = s.tx.select({ m: sql<string | null>`max(${T.position})` }).from(T).where(siblingsWhere(s.ownerId, projectId, sectionId, parentTaskId)).get();
  return positionAfter(row?.m ?? null);
}

// ---------- date normalisation ----------
interface DateCols {
  scheduledDate: string | null;
  scheduledAtUtc: string | null;
  dueDate: string | null;
  dueAtUtc: string | null;
  dueTimezone: string | null;
  deadlineDate: string | null;
  estimateMinutes: number | null;
  recurrenceRule: string | null;
  recurrenceMode: string;
  recurrenceTimezone: string | null;
  recurrenceAnchor: string | null;
  nextOccurrenceKey: string | null;
}

type DateInput = Pick<TaskCreateInput, 'scheduledDate' | 'scheduledAtUtc' | 'dueDate' | 'dueAtUtc' | 'dueTimezone' | 'deadlineDate' | 'estimateMinutes' | 'recurrence'>;

function dueMoment(c: Pick<DateCols, 'dueDate' | 'dueAtUtc' | 'dueTimezone'>, tz: string): LocalMoment | null {
  if (!c.dueDate) return null;
  const zone = c.dueTimezone ?? tz;
  return { date: c.dueDate, time: c.dueAtUtc ? localTimeOf(c.dueAtUtc, zone) : null };
}

export function computeDateColumns(current: Partial<DateCols> | null, input: DateInput, userTz: string): DateCols {
  const out: DateCols = {
    scheduledDate: current?.scheduledDate ?? null,
    scheduledAtUtc: current?.scheduledAtUtc ?? null,
    dueDate: current?.dueDate ?? null,
    dueAtUtc: current?.dueAtUtc ?? null,
    dueTimezone: current?.dueTimezone ?? null,
    deadlineDate: current?.deadlineDate ?? null,
    estimateMinutes: current?.estimateMinutes ?? null,
    recurrenceRule: current?.recurrenceRule ?? null,
    recurrenceMode: current?.recurrenceMode ?? 'fixed',
    recurrenceTimezone: current?.recurrenceTimezone ?? null,
    recurrenceAnchor: current?.recurrenceAnchor ?? null,
    nextOccurrenceKey: current?.nextOccurrenceKey ?? null,
  };

  if (input.dueDate !== undefined || input.dueAtUtc !== undefined || input.dueTimezone !== undefined) {
    const zone = input.dueTimezone ?? current?.dueTimezone ?? userTz;
    let date = input.dueDate;
    let at = input.dueAtUtc;
    if (date === null && (at === null || at === undefined)) {
      out.dueDate = null;
      out.dueAtUtc = null;
      out.dueTimezone = null;
    } else {
      if (at) {
        const local = localDateOf(at, zone);
        if (date && date !== local) throw badRequest('dueDate does not match dueAtUtc in the given timezone', [{ field: 'dueDate', message: 'Inconsistent with dueAtUtc' }]);
        date = local;
      }
      if (date === undefined) date = out.dueDate;
      if (!date) throw badRequest('A due time needs a due date', [{ field: 'dueDate', message: 'Required' }]);
      if (at === undefined) {
        // date changed only: keep the existing wall-clock time if there was one
        at = current?.dueAtUtc ? localToUtc(date, localTimeOf(current.dueAtUtc, current.dueTimezone ?? userTz), zone).toISOString() : null;
      }
      out.dueDate = date;
      out.dueAtUtc = at ?? null;
      out.dueTimezone = zone;
    }
  }

  if (input.scheduledDate !== undefined || input.scheduledAtUtc !== undefined) {
    let date = input.scheduledDate;
    let at = input.scheduledAtUtc;
    if (date === null && (at === null || at === undefined)) {
      out.scheduledDate = null;
      out.scheduledAtUtc = null;
    } else {
      if (at) {
        const local = localDateOf(at, userTz);
        if (date && date !== local) throw badRequest('scheduledDate does not match scheduledAtUtc', [{ field: 'scheduledDate', message: 'Inconsistent with scheduledAtUtc' }]);
        date = local;
      }
      if (date === undefined) date = out.scheduledDate;
      if (!date) throw badRequest('A scheduled time needs a scheduled date', [{ field: 'scheduledDate', message: 'Required' }]);
      if (at === undefined) at = current?.scheduledAtUtc ? localToUtc(date, localTimeOf(current.scheduledAtUtc, userTz), userTz).toISOString() : null;
      out.scheduledDate = date;
      out.scheduledAtUtc = at ?? null;
    }
  }

  if (input.deadlineDate !== undefined) out.deadlineDate = input.deadlineDate;
  if (input.estimateMinutes !== undefined) out.estimateMinutes = input.estimateMinutes;

  if (input.recurrence !== undefined) {
    if (input.recurrence === null) {
      out.recurrenceRule = null;
      out.recurrenceAnchor = null;
      out.recurrenceTimezone = null;
      out.recurrenceMode = 'fixed';
    } else {
      out.recurrenceRule = normalizeRule(input.recurrence.rule);
      out.recurrenceMode = input.recurrence.mode;
      out.recurrenceTimezone = input.recurrence.timezone ?? out.dueTimezone ?? userTz;
    }
  }
  if (out.recurrenceRule && !out.dueDate) throw badRequest('Recurring tasks need a due date', [{ field: 'recurrence', message: 'Set a due date first' }]);
  if (!out.dueDate && out.recurrenceRule === null) out.recurrenceAnchor = null;
  const rec: Recurrence | null = out.recurrenceRule ? { rule: out.recurrenceRule, mode: out.recurrenceMode as Recurrence['mode'] } : null;
  const m = dueMoment(out, userTz);
  out.nextOccurrenceKey = rec && m ? makeOccurrenceKey(rec, m) : null;
  out.recurrenceAnchor = rec && m ? (out.recurrenceAnchor ?? (m.time ? `${m.date}T${m.time}` : m.date)) : null;
  return out;
}

function replaceLabels(s: Scope, taskId: string, labelIds: string[]) {
  s.tx.delete(schema.taskLabels).where(eq(schema.taskLabels.taskId, taskId)).run();
  const unique = [...new Set(labelIds)];
  if (unique.length) s.tx.insert(schema.taskLabels).values(unique.map((labelId) => ({ taskId, labelId }))).run();
}

function replaceReminders(s: Scope, taskId: string, reminders: ReminderInput[], zone: string) {
  s.tx.delete(schema.taskReminders).where(eq(schema.taskReminders.taskId, taskId)).run();
  const now = nowIso();
  for (const r of reminders) {
    s.tx.insert(schema.taskReminders)
      .values({
        id: r.id ?? newId(),
        taskId,
        kind: r.kind,
        offsetMinutes: r.kind === 'relative' ? (r.offsetMinutes ?? 0) : null,
        atUtc: r.kind === 'absolute' ? (r.atUtc ?? null) : null,
        timezone: zone,
        channel: r.channel,
        enabled: r.enabled,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

// ---------- create ----------
export function createTask(s: Scope, input: TaskCreateInput): { task: TaskDTO; created: boolean } {
  if (input.id) {
    const existing = s.tx.select().from(T).where(eq(T.id, input.id)).get();
    if (existing) {
      if (existing.ownerUserId !== s.ownerId) throw badRequest('Id already in use', [{ field: 'id', message: 'Id already in use' }]);
      return { task: dto(s, existing.id), created: false };
    }
  }
  let projectId = input.projectId ?? null;
  let sectionId = input.sectionId ?? null;
  const parentTaskId = input.parentTaskId ?? null;
  if (parentTaskId) {
    const parent = loadOwnedTask(s, parentTaskId);
    if (parent.deletedAt) throw badRequest('Parent task was deleted', [{ field: 'parentTaskId', message: 'Parent was deleted' }]);
    if (depthOf(s, parent.id) >= 4) throw badRequest('Subtasks can be nested at most 5 levels deep');
    projectId = parent.projectId;
    sectionId = parent.sectionId;
  }
  if (projectId) assertProject(s, projectId);
  if (sectionId) assertSection(s, sectionId, projectId);
  const labelIds = input.labelIds ?? [];
  assertLabels(s, labelIds);

  const dates = computeDateColumns(null, input, s.tz);
  const id = input.id ?? newId();
  const now = nowIso();
  s.tx.insert(T)
    .values({
      id,
      ownerUserId: s.ownerId,
      projectId,
      sectionId,
      parentTaskId,
      title: input.title.trim(),
      description: input.description ?? '',
      priority: input.priority ?? 4,
      status: 'open',
      position: nextPosition(s, projectId, sectionId, parentTaskId),
      ...dates,
      createdAt: now,
      updatedAt: now,
      version: 1,
    })
    .run();
  replaceLabels(s, id, labelIds);
  if (input.reminders?.length) replaceReminders(s, id, input.reminders, dates.dueTimezone ?? s.tz);
  s.ev.activity({ entityType: 'task', entityId: id, projectId, action: 'task.created', summary: `added a task: ${input.title.trim()}` });
  s.ev.emit('task.changed', id, { ids: [id] });
  return { task: dto(s, id), created: true };
}

// ---------- patch ----------
export function patchTask(s: Scope, id: string, input: TaskPatchInput): TaskDTO {
  const row = loadOwnedTask(s, id);
  if (row.deletedAt) throw notFound('Task');
  if (row.version !== input.version) throw versionConflict(dto(s, id), input.version);

  const changed: string[] = [];
  const patch: Partial<typeof T.$inferInsert> = {};
  if (input.title !== undefined && input.title.trim() !== row.title) { patch.title = input.title.trim(); changed.push('title'); }
  if (input.description !== undefined && input.description !== row.description) { patch.description = input.description; changed.push('description'); }
  if (input.priority !== undefined && input.priority !== row.priority) { patch.priority = input.priority; changed.push('priority'); }

  // project / section / parent moves
  let projectId = row.projectId;
  let sectionId = row.sectionId;
  let parentTaskId = row.parentTaskId;
  let moved = false;
  if (input.parentTaskId !== undefined && input.parentTaskId !== row.parentTaskId) {
    if (input.parentTaskId) {
      if (input.parentTaskId === id) throw badRequest('A task cannot be its own parent');
      const parent = loadOwnedTask(s, input.parentTaskId);
      if (descendantRows(s, id).some((d) => d.id === parent.id)) throw badRequest('That would create a cycle', [{ field: 'parentTaskId', message: 'Cycle' }]);
      projectId = parent.projectId;
      sectionId = parent.sectionId;
    }
    parentTaskId = input.parentTaskId ?? null;
    moved = true;
  }
  if (input.projectId !== undefined && !(parentTaskId && input.parentTaskId === undefined)) {
    const next = input.projectId ?? null;
    if (next !== projectId) {
      if (next) assertProject(s, next);
      projectId = next;
      sectionId = null;
      moved = true;
    }
  }
  if (input.sectionId !== undefined) {
    const next = input.sectionId ?? null;
    if (next !== sectionId) {
      if (next) assertSection(s, next, projectId);
      sectionId = next;
      moved = true;
    }
  }
  if (sectionId && !s.tx.select().from(schema.sections).where(and(eq(schema.sections.id, sectionId), eq(schema.sections.projectId, projectId ?? ''))).get()) sectionId = null;
  if (moved) {
    patch.projectId = projectId;
    patch.sectionId = sectionId;
    patch.parentTaskId = parentTaskId;
    patch.position = nextPosition(s, projectId, sectionId, parentTaskId);
    changed.push('location');
  }

  const dateInput: DateInput = {
    scheduledDate: input.scheduledDate,
    scheduledAtUtc: input.scheduledAtUtc,
    dueDate: input.dueDate,
    dueAtUtc: input.dueAtUtc,
    dueTimezone: input.dueTimezone,
    deadlineDate: input.deadlineDate,
    estimateMinutes: input.estimateMinutes,
    recurrence: input.recurrence,
  };
  const touchesDates = Object.values(dateInput).some((v) => v !== undefined);
  if (touchesDates) {
    const cols = computeDateColumns(row, dateInput, s.tz);
    for (const k of Object.keys(cols) as (keyof DateCols)[]) {
      if (cols[k] !== (row as unknown as DateCols)[k]) {
        (patch as Record<string, unknown>)[k] = cols[k];
        if (k === 'dueDate' || k === 'dueAtUtc') { if (!changed.includes('due')) changed.push('due'); }
        else if (k === 'scheduledDate' || k === 'scheduledAtUtc') { if (!changed.includes('scheduled')) changed.push('scheduled'); }
        else if (k === 'deadlineDate') changed.push('deadline');
        else if (k.startsWith('recurrence') && !changed.includes('recurrence')) changed.push('recurrence');
      }
    }
  }

  const beforeLabels = s.tx.select({ l: schema.taskLabels.labelId }).from(schema.taskLabels).where(eq(schema.taskLabels.taskId, id)).all().map((r) => r.l).sort();
  if (input.labelIds) {
    assertLabels(s, input.labelIds);
    const next = [...new Set(input.labelIds)].sort();
    if (next.join() !== beforeLabels.join()) { replaceLabels(s, id, next); changed.push('labels'); }
  }
  if (input.reminders) {
    replaceReminders(s, id, input.reminders, (patch.dueTimezone as string | undefined) ?? row.dueTimezone ?? s.tz);
    changed.push('reminders');
  }

  if (changed.length === 0) return dto(s, id);

  const now = nowIso();
  s.tx.update(T).set({ ...patch, updatedAt: now, version: row.version + 1 }).where(eq(T.id, id)).run();

  if (moved && !parentTaskId) {
    // subtasks follow their parent
    for (const d of descendantRows(s, id)) {
      s.tx.update(T).set({ projectId, sectionId, updatedAt: now, version: d.version + 1 }).where(eq(T.id, d.id)).run();
    }
  } else if (moved) {
    for (const d of descendantRows(s, id)) s.tx.update(T).set({ projectId, sectionId, updatedAt: now, version: d.version + 1 }).where(eq(T.id, d.id)).run();
  }

  const title = patch.title ?? row.title;
  s.ev.activity({
    entityType: 'task',
    entityId: id,
    projectId,
    action: moved ? 'task.moved' : 'task.updated',
    summary: moved ? `moved a task: ${title}` : `updated a task: ${title}`,
    delta: { fields: changed },
  });
  s.ev.emit('task.changed', id, { ids: [id] });
  return dto(s, id);
}

// ---------- complete / reopen ----------
function currentRecurrence(row: TaskRow): Recurrence | null {
  return row.recurrenceRule ? { rule: row.recurrenceRule, mode: row.recurrenceMode === 'after_completion' ? 'after_completion' : 'fixed' } : null;
}

export function completeTask(s: Scope, id: string, input: { version: number; occurrenceKey?: string; completeSubtasks?: boolean }, now = new Date()): TaskDTO {
  const row = loadOwnedTask(s, id);
  if (row.deletedAt) throw notFound('Task');
  const rec = currentRecurrence(row);
  const moment = dueMoment(row, s.tz);
  const key = rec ? input.occurrenceKey ?? makeOccurrenceKey(rec, moment) : 'once';

  // Idempotent: an active completion for this occurrence already exists
  const existing = s.tx
    .select()
    .from(schema.taskCompletions)
    .where(and(eq(schema.taskCompletions.taskId, id), eq(schema.taskCompletions.occurrenceKey, key), isNull(schema.taskCompletions.undoneAt)))
    .get();
  if (existing) return dto(s, id);
  if (row.status !== 'open') {
    if (row.status === 'completed') return dto(s, id);
    throw badRequest('Archived tasks cannot be completed');
  }
  if (row.version !== input.version) throw versionConflict(dto(s, id), input.version);

  const nowStr = now.toISOString();
  const completedOn: LocalMoment = { date: localDateOf(now, s.tz), time: localTimeOf(now, s.tz) };

  s.tx.insert(schema.taskCompletions)
    .values({
      id: newId(),
      taskId: id,
      ownerUserId: s.ownerId,
      occurrenceKey: key,
      completedAt: nowStr,
      originalDueDate: row.dueDate,
      originalDueAtUtc: row.dueAtUtc,
      completedBy: s.ownerId,
    })
    .run();

  if (input.completeSubtasks) {
    for (const d of descendantRows(s, id)) {
      if (d.status === 'open' && !d.deletedAt) completeTask(s, d.id, { version: d.version, completeSubtasks: true }, now);
    }
  }

  let next: LocalMoment | null = null;
  if (rec && moment) next = nextOccurrence(rec, moment, completedOn);

  if (rec && moment && next) {
    const zone = row.dueTimezone ?? s.tz;
    const due = buildDue({ date: next.date, time: next.time, timezone: zone });
    const delta = diffDays(moment.date, next.date);
    const patch: Partial<typeof T.$inferInsert> = {
      dueDate: due.dueDate,
      dueAtUtc: due.dueAtUtc,
      dueTimezone: due.dueTimezone,
      nextOccurrenceKey: makeOccurrenceKey(rec, next),
      updatedAt: nowStr,
      version: row.version + 1,
    };
    if (row.scheduledDate) {
      const sd = addDays(row.scheduledDate, delta);
      patch.scheduledDate = sd;
      patch.scheduledAtUtc = row.scheduledAtUtc ? localToUtc(sd, localTimeOf(row.scheduledAtUtc, s.tz), s.tz).toISOString() : null;
    }
    if (row.deadlineDate) patch.deadlineDate = addDays(row.deadlineDate, delta);
    s.tx.update(T).set(patch).where(eq(T.id, id)).run();
    // "Reset sub-tasks on recurring completion": reopen finished sub-tasks for the next occurrence.
    if (readBoolPref(s, 'tasks.resetSubtasks')) {
      for (const d of descendantRows(s, id)) {
        if (d.status === 'completed' && !d.deletedAt) s.tx.update(T).set({ status: 'open', completedAt: null, updatedAt: nowStr, version: d.version + 1 }).where(eq(T.id, d.id)).run();
      }
    }
  } else {
    s.tx.update(T).set({ status: 'completed', completedAt: nowStr, updatedAt: nowStr, version: row.version + 1 }).where(eq(T.id, id)).run();
  }

  s.ev.activity({
    entityType: 'task',
    entityId: id,
    projectId: row.projectId,
    action: 'task.completed',
    summary: `completed a task: ${row.title}`,
    delta: rec ? { occurrenceKey: key } : undefined,
  });
  s.ev.emit('task.changed', id, { ids: [id] });
  return dto(s, id);
}

export function reopenTask(s: Scope, id: string, input: { version?: number; occurrenceKey?: string }): TaskDTO {
  const row = loadOwnedTask(s, id);
  if (row.deletedAt) throw notFound('Task');
  const rec = currentRecurrence(row);

  const active = s.tx
    .select()
    .from(schema.taskCompletions)
    .where(
      and(
        eq(schema.taskCompletions.taskId, id),
        isNull(schema.taskCompletions.undoneAt),
        input.occurrenceKey ? eq(schema.taskCompletions.occurrenceKey, input.occurrenceKey) : sql`1=1`,
      ),
    )
    .orderBy(desc(schema.taskCompletions.completedAt))
    .all();
  const target = active[0];
  if (!target && row.status === 'open') return dto(s, id); // idempotent
  if (input.version !== undefined && row.version !== input.version && !(target === undefined)) {
    // allow undo even if the version moved because of our own completion; only reject real concurrent edits
    const latestCompletion = s.tx.select().from(schema.taskCompletions).where(eq(schema.taskCompletions.taskId, id)).orderBy(desc(schema.taskCompletions.completedAt)).get();
    if (!latestCompletion || latestCompletion.id !== target.id || row.version !== input.version + 1) throw versionConflict(dto(s, id), input.version);
  }

  const now = nowIso();
  if (target) s.tx.update(schema.taskCompletions).set({ undoneAt: now }).where(eq(schema.taskCompletions.id, target.id)).run();

  const patch: Partial<typeof T.$inferInsert> = { status: 'open', completedAt: null, updatedAt: now, version: row.version + 1 };
  if (target && rec && target.originalDueDate) {
    // Restore the due date only when undoing the most recent occurrence
    const newer = active.slice(1).length > 0;
    if (!newer) {
      patch.dueDate = target.originalDueDate;
      patch.dueAtUtc = target.originalDueAtUtc;
      patch.nextOccurrenceKey = target.occurrenceKey === 'once' ? null : target.occurrenceKey;
    }
  }
  s.tx.update(T).set(patch).where(eq(T.id, id)).run();
  s.ev.activity({ entityType: 'task', entityId: id, projectId: row.projectId, action: 'task.reopened', summary: `reopened a task: ${row.title}` });
  s.ev.emit('task.changed', id, { ids: [id] });
  return dto(s, id);
}

function readBoolPref(s: Scope, key: string): boolean {
  const r = s.tx.select().from(schema.userPreferences).where(and(eq(schema.userPreferences.userId, s.ownerId), eq(schema.userPreferences.key, key))).get();
  if (!r) return false;
  try {
    return JSON.parse(r.jsonValue) === true;
  } catch {
    return false;
  }
}

// ---------- archive / unarchive ----------
/** Archive hides a task (and its sub-tasks) from every view without deleting it; it can be restored from Archived. */
export function archiveTask(s: Scope, id: string): TaskDTO {
  const row = loadOwnedTask(s, id);
  if (row.deletedAt) throw notFound('Task');
  if (row.status === 'archived') return dto(s, id);
  const now = nowIso();
  const all = [row, ...descendantRows(s, id)];
  for (const t of all) {
    if (!t.deletedAt && t.status !== 'archived') s.tx.update(T).set({ status: 'archived', updatedAt: now, version: t.version + 1 }).where(eq(T.id, t.id)).run();
  }
  s.ev.activity({ entityType: 'task', entityId: id, projectId: row.projectId, action: 'task.archived', summary: `archived a task: ${row.title}`, delta: { count: all.length, previousStatus: row.status } });
  s.ev.emit('task.changed', id, { ids: all.map((t) => t.id) });
  return dto(s, id);
}

export function unarchiveTask(s: Scope, id: string, restoreStatus: 'open' | 'completed' = 'open'): TaskDTO {
  const row = loadOwnedTask(s, id);
  if (row.deletedAt) throw notFound('Task');
  if (row.status !== 'archived') return dto(s, id);
  const now = nowIso();
  const all = [row, ...descendantRows(s, id)];
  for (const t of all) {
    if (!t.deletedAt && t.status === 'archived') {
      const status = t.completedAt ? 'completed' : t.id === id ? restoreStatus : 'open';
      s.tx.update(T).set({ status, updatedAt: now, version: t.version + 1 }).where(eq(T.id, t.id)).run();
    }
  }
  s.ev.activity({ entityType: 'task', entityId: id, projectId: row.projectId, action: 'task.unarchived', summary: `restored an archived task: ${row.title}` });
  s.ev.emit('task.changed', id, { ids: all.map((t) => t.id) });
  return dto(s, id);
}

// ---------- delete / restore ----------
export function deleteTask(s: Scope, id: string): TaskDTO {
  const row = loadOwnedTask(s, id);
  if (row.deletedAt) return dto(s, id);
  const now = nowIso();
  const all = [row, ...descendantRows(s, id)];
  for (const t of all) {
    if (!t.deletedAt) s.tx.update(T).set({ deletedAt: now, updatedAt: now, version: t.version + 1 }).where(eq(T.id, t.id)).run();
  }
  s.ev.activity({ entityType: 'task', entityId: id, projectId: row.projectId, action: 'task.deleted', summary: `deleted a task: ${row.title}`, delta: { count: all.length } });
  s.ev.emit('task.changed', id, { ids: all.map((t) => t.id) });
  return dto(s, id);
}

export function restoreTask(s: Scope, id: string): TaskDTO {
  const row = loadOwnedTask(s, id);
  if (!row.deletedAt) return dto(s, id);
  const now = nowIso();
  const stamp = row.deletedAt;
  const all = [row, ...descendantRows(s, id)].filter((t) => t.deletedAt === stamp);
  // If the project/section/parent is gone, fall back to Inbox
  let projectId = row.projectId;
  if (projectId && !s.tx.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get()) projectId = null;
  for (const t of all) {
    const patch: Partial<typeof T.$inferInsert> = { deletedAt: null, updatedAt: now, version: t.version + 1 };
    if (t.id === id && row.parentTaskId) {
      const parent = s.tx.select().from(T).where(eq(T.id, row.parentTaskId)).get();
      if (!parent || parent.deletedAt) patch.parentTaskId = null;
    }
    if (t.id === id) patch.projectId = projectId;
    s.tx.update(T).set(patch).where(eq(T.id, t.id)).run();
  }
  s.ev.activity({ entityType: 'task', entityId: id, projectId, action: 'task.restored', summary: `restored a task: ${row.title}` });
  s.ev.emit('task.changed', id, { ids: all.map((t) => t.id) });
  return dto(s, id);
}

// ---------- reorder ----------
export function reorderTask(
  s: Scope,
  input: { taskId: string; projectId: string | null; sectionId: string | null; parentTaskId?: string | null; beforeTaskId?: string | null; afterTaskId?: string | null },
): TaskDTO {
  const row = loadOwnedTask(s, input.taskId);
  if (row.deletedAt) throw notFound('Task');
  const projectId = input.projectId;
  const sectionId = input.sectionId;
  const parentTaskId = input.parentTaskId ?? null;
  if (projectId) assertProject(s, projectId);
  if (sectionId) assertSection(s, sectionId, projectId);
  if (parentTaskId) {
    const parent = loadOwnedTask(s, parentTaskId);
    if (parent.id === row.id || descendantRows(s, row.id).some((d) => d.id === parent.id)) throw badRequest('That would create a cycle');
  }

  const siblings = s.tx.select().from(T).where(and(siblingsWhere(s.ownerId, projectId, sectionId, parentTaskId), ne(T.id, row.id))).orderBy(asc(T.position), asc(T.createdAt)).all();
  let index = siblings.length;
  if (input.beforeTaskId) {
    const i = siblings.findIndex((x) => x.id === input.beforeTaskId);
    if (i < 0) throw badRequest('beforeTaskId is not in the target list');
    index = i;
  } else if (input.afterTaskId) {
    const i = siblings.findIndex((x) => x.id === input.afterTaskId);
    if (i < 0) throw badRequest('afterTaskId is not in the target list');
    index = i + 1;
  }
  const ordered = [...siblings.slice(0, index).map((x) => x.id), row.id, ...siblings.slice(index).map((x) => x.id)];
  const now = nowIso();
  ordered.forEach((tid, i) => {
    const pos = positionKey((i + 1) * POSITION_STEP);
    if (tid === row.id) {
      s.tx.update(T).set({ projectId, sectionId, parentTaskId, position: pos, updatedAt: now, version: row.version + 1 }).where(eq(T.id, tid)).run();
    } else {
      const sib = siblings.find((x) => x.id === tid) as TaskRow;
      if (sib.position !== pos) s.tx.update(T).set({ position: pos, updatedAt: now, version: sib.version + 1 }).where(eq(T.id, tid)).run();
    }
  });
  if (row.projectId !== projectId || row.sectionId !== sectionId) {
    for (const d of descendantRows(s, row.id)) s.tx.update(T).set({ projectId, sectionId, updatedAt: now, version: d.version + 1 }).where(eq(T.id, d.id)).run();
    s.ev.activity({ entityType: 'task', entityId: row.id, projectId, action: 'task.moved', summary: `moved a task: ${row.title}` });
  }
  s.ev.emit('task.changed', row.id, { ids: ordered });
  return dto(s, row.id);
}

// ---------- bulk (single transaction, all-or-nothing) ----------
export function bulkTasks(
  s: Scope,
  input: { ids: string[]; action: string; projectId?: string | null; sectionId?: string | null; priority?: number; labelIds?: string[]; date?: string | null },
): TaskDTO[] {
  const ids = [...new Set(input.ids)];
  const out: TaskDTO[] = [];
  const failures: { field: string; message: string }[] = [];
  for (const id of ids) {
    try {
      const row = loadOwnedTask(s, id);
      const v = row.version;
      switch (input.action) {
        case 'complete': out.push(completeTask(s, id, { version: v })); break;
        case 'reopen': out.push(reopenTask(s, id, {})); break;
        case 'delete': out.push(deleteTask(s, id)); break;
        case 'restore': out.push(restoreTask(s, id)); break;
        case 'move': out.push(patchTask(s, id, { version: v, projectId: input.projectId ?? null, sectionId: input.sectionId ?? null })); break;
        case 'priority':
          if (!input.priority) throw badRequest('priority required');
          out.push(patchTask(s, id, { version: v, priority: input.priority }));
          break;
        case 'addLabels':
        case 'removeLabels': {
          const cur = (getTaskDTO(s.tx, s.ownerId, id) as TaskDTO).labelIds;
          const set = new Set(cur);
          for (const l of input.labelIds ?? []) { if (input.action === 'addLabels') set.add(l); else set.delete(l); }
          out.push(patchTask(s, id, { version: v, labelIds: [...set] }));
          break;
        }
        case 'schedule': out.push(patchTask(s, id, { version: v, scheduledDate: input.date ?? null })); break;
        case 'due': out.push(patchTask(s, id, { version: v, dueDate: input.date ?? null })); break;
        default: throw badRequest('Unknown bulk action');
      }
    } catch (e) {
      failures.push({ field: id, message: e instanceof Error ? e.message : 'Failed' });
    }
  }
  if (failures.length) {
    // Throwing rolls back the whole transaction: nothing is partially applied.
    throw badRequest(`Bulk ${input.action} failed for ${failures.length} item(s); no changes were applied`, failures);
  }
  return out;
}

// ---------- queries ----------
export interface TaskQuery {
  projectId?: string | 'inbox';
  sectionId?: string;
  parentTaskId?: string;
  status?: 'open' | 'completed' | 'archived';
  includeCompleted?: boolean;
  priority?: number;
  labelIds?: string[];
  dueFrom?: string;
  dueTo?: string;
  scheduledFrom?: string;
  scheduledTo?: string;
  q?: string;
  sort?: 'position' | 'due' | 'priority' | 'created' | 'title';
  offset?: number;
  limit?: number;
}

export function ftsQuery(q: string): string | null {
  const tokens = q.toLowerCase().match(/[\p{L}\p{N}_]+/gu);
  if (!tokens?.length) return null;
  return tokens.slice(0, 8).map((t) => `"${t.replace(/"/g, '')}"*`).join(' ');
}

export function queryTasks(tx: Tx | import('../db/client.js').Db, ownerId: string, f: TaskQuery): { items: TaskDTO[]; total: number } {
  const conds: SQL[] = [eq(T.ownerUserId, ownerId), isNull(T.deletedAt)];
  if (f.status) conds.push(eq(T.status, f.status));
  else if (!f.includeCompleted) conds.push(eq(T.status, 'open'));
  else conds.push(ne(T.status, 'archived'));
  if (f.projectId === 'inbox') conds.push(isNull(T.projectId));
  else if (f.projectId) conds.push(eq(T.projectId, f.projectId));
  if (f.sectionId) conds.push(eq(T.sectionId, f.sectionId));
  if (f.parentTaskId) conds.push(eq(T.parentTaskId, f.parentTaskId));
  if (f.priority) conds.push(eq(T.priority, f.priority));
  if (f.dueFrom) conds.push(sql`${T.dueDate} >= ${f.dueFrom}`);
  if (f.dueTo) conds.push(sql`${T.dueDate} <= ${f.dueTo}`);
  if (f.scheduledFrom) conds.push(sql`${T.scheduledDate} >= ${f.scheduledFrom}`);
  if (f.scheduledTo) conds.push(sql`${T.scheduledDate} <= ${f.scheduledTo}`);
  if (f.labelIds?.length) {
    conds.push(sql`${T.id} IN (SELECT task_id FROM task_labels WHERE label_id IN (${sql.join(f.labelIds.map((l) => sql`${l}`), sql`, `)}))`);
  }
  if (f.q) {
    const fq = ftsQuery(f.q);
    if (fq) conds.push(sql`tasks.rowid IN (SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH ${fq})`);
    else conds.push(sql`0=1`);
  }
  const where = and(...conds) as SQL;
  const order =
    f.sort === 'due' ? [asc(sql`coalesce(${T.dueAtUtc}, ${T.dueDate}, '9999')`), asc(T.priority)]
    : f.sort === 'priority' ? [asc(T.priority), asc(T.position)]
    : f.sort === 'created' ? [desc(T.createdAt)]
    : f.sort === 'title' ? [asc(T.title)]
    : [asc(T.position), asc(T.createdAt)];
  const total = tx.select({ c: sql<number>`count(*)` }).from(T).where(where).get()?.c ?? 0;
  const rows = tx.select().from(T).where(where).orderBy(...order).limit(Math.min(f.limit ?? 100, 200)).offset(f.offset ?? 0).all();
  return { items: hydrateTasks(tx, rows), total };
}

export { or };
