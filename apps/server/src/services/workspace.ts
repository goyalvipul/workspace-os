import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  newId,
  addDays,
  preferenceDefaults,
  preferenceSchemas,
  templateBodySchema,
  todayLocal,
  type CommentDTO,
  type LabelDTO,
  type PreferenceKey,
  type ProjectDTO,
  type ReminderDTO,
  type ReminderInput,
  type SavedFilterDTO,
  type SectionDTO,
  type TaskDTO,
  type TemplateBody,
  type TemplateDTO,
  type TemplateTask,
} from '@wos/shared';
import { z } from 'zod';
import { schema, type Db, type Tx } from '../db/client.js';
import { AppError, badRequest, conflict, notFound, versionConflict } from '../errors.js';
import { nowIso } from '../util.js';
import { commentToDTO, filterToDTO, labelToDTO, projectToDTO, sectionToDTO, templateToDTO, getTaskDTO, reminderToDTO } from './mappers.js';
import { createTask, loadOwnedTask, type Scope } from './tasks.js';

const P = schema.projects;
const S = schema.sections;
const L = schema.labels;

// ====================== Projects ======================
function loadProject(s: Scope, id: string) {
  const p = s.tx.select().from(P).where(and(eq(P.id, id), eq(P.ownerUserId, s.ownerId))).get();
  if (!p) throw notFound('Project');
  return p;
}

function ancestorsOf(s: Scope, projectId: string | null): string[] {
  const out: string[] = [];
  let cur = projectId;
  while (cur && !out.includes(cur)) {
    out.push(cur);
    cur = s.tx.select({ p: P.parentProjectId }).from(P).where(eq(P.id, cur)).get()?.p ?? null;
  }
  return out;
}

export function createProject(
  s: Scope,
  input: { id?: string; name: string; description?: string; outcome?: string; color?: string; icon?: string | null; favorite?: boolean; parentProjectId?: string | null; defaultView?: 'list' | 'board' },
): { project: ProjectDTO; created: boolean } {
  if (input.id) {
    const ex = s.tx.select().from(P).where(eq(P.id, input.id)).get();
    if (ex) {
      if (ex.ownerUserId !== s.ownerId) throw badRequest('Id already in use');
      return { project: projectToDTO(ex), created: false };
    }
  }
  const parent = input.parentProjectId ?? null;
  if (parent) {
    loadProject(s, parent);
    if (ancestorsOf(s, parent).length >= 5) throw badRequest('Projects can be nested at most 5 levels deep');
  }
  const dup = s.tx.select({ id: P.id }).from(P).where(and(eq(P.ownerUserId, s.ownerId), sql`lower(${P.name}) = lower(${input.name.trim()})`, isNull(P.archivedAt))).get();
  void dup; // duplicate project names are allowed (like folders); quick-add resolves the first match
  const max = s.tx.select({ m: sql<number>`coalesce(max(${P.sortOrder}), 0)` }).from(P).where(eq(P.ownerUserId, s.ownerId)).get()?.m ?? 0;
  const now = nowIso();
  const id = input.id ?? newId();
  s.tx.insert(P)
    .values({
      id,
      ownerUserId: s.ownerId,
      parentProjectId: parent,
      name: input.name.trim(),
      description: input.description ?? '',
      outcome: input.outcome ?? '',
      color: input.color ?? '#8b8d98',
      icon: input.icon ?? null,
      favorite: input.favorite ?? false,
      sortOrder: max + 1,
      defaultView: input.defaultView ?? 'list',
      createdAt: now,
      updatedAt: now,
      version: 1,
    })
    .run();
  s.ev.activity({ entityType: 'project', entityId: id, projectId: id, action: 'project.created', summary: `added a project: ${input.name.trim()}` });
  s.ev.emit('project.changed', id, { id });
  return { project: projectToDTO(loadProject(s, id)), created: true };
}

export function patchProject(
  s: Scope,
  id: string,
  input: { version: number; name?: string; description?: string; outcome?: string; color?: string; icon?: string | null; favorite?: boolean; parentProjectId?: string | null; defaultView?: 'list' | 'board'; archived?: boolean },
): ProjectDTO {
  const p = loadProject(s, id);
  if (p.version !== input.version) throw versionConflict(projectToDTO(p), input.version);
  const patch: Partial<typeof P.$inferInsert> = {};
  const fields: string[] = [];
  const set = <K extends keyof typeof P.$inferInsert>(k: K, v: (typeof P.$inferInsert)[K] | undefined, label = String(k)) => {
    if (v !== undefined && v !== (p as Record<string, unknown>)[k as string]) { patch[k] = v; fields.push(label); }
  };
  set('name', input.name?.trim());
  set('description', input.description);
  set('outcome', input.outcome);
  set('color', input.color);
  set('icon', input.icon);
  set('favorite', input.favorite);
  set('defaultView', input.defaultView);
  if (input.parentProjectId !== undefined && input.parentProjectId !== p.parentProjectId) {
    if (input.parentProjectId) {
      loadProject(s, input.parentProjectId);
      if (ancestorsOf(s, input.parentProjectId).includes(id)) throw badRequest('That would create a cycle', [{ field: 'parentProjectId', message: 'Cycle' }]);
    }
    patch.parentProjectId = input.parentProjectId ?? null;
    fields.push('parent');
  }
  let action = 'project.updated';
  if (input.archived !== undefined && input.archived !== (p.archivedAt !== null)) {
    patch.archivedAt = input.archived ? nowIso() : null;
    action = input.archived ? 'project.archived' : 'project.unarchived';
    fields.push('archived');
  } else if (patch.name) action = 'project.renamed';
  if (!fields.length) return projectToDTO(p);
  s.tx.update(P).set({ ...patch, updatedAt: nowIso(), version: p.version + 1 }).where(eq(P.id, id)).run();
  const name = patch.name ?? p.name;
  const verb = { 'project.archived': 'archived', 'project.unarchived': 'unarchived', 'project.renamed': 'renamed', 'project.updated': 'updated' }[action];
  s.ev.activity({ entityType: 'project', entityId: id, projectId: id, action, summary: `${verb} a project: ${name}`, delta: { fields } });
  s.ev.emit('project.changed', id, { id });
  return projectToDTO(loadProject(s, id));
}

export type ProjectTaskPolicy = 'move_to_inbox' | 'archive' | 'delete';

export function deleteProject(s: Scope, id: string, policy: ProjectTaskPolicy): { movedTasks: number } {
  const p = loadProject(s, id);
  const now = nowIso();
  const rows = s.tx.select().from(schema.tasks).where(and(eq(schema.tasks.projectId, id), eq(schema.tasks.ownerUserId, s.ownerId), isNull(schema.tasks.deletedAt))).all();
  for (const t of rows) {
    const base = { sectionId: null, updatedAt: now, version: t.version + 1 };
    if (policy === 'move_to_inbox') s.tx.update(schema.tasks).set({ ...base, projectId: null }).where(eq(schema.tasks.id, t.id)).run();
    else if (policy === 'archive') s.tx.update(schema.tasks).set({ ...base, projectId: null, status: t.status === 'open' ? 'archived' : t.status }).where(eq(schema.tasks.id, t.id)).run();
    else s.tx.update(schema.tasks).set({ ...base, projectId: null, deletedAt: now }).where(eq(schema.tasks.id, t.id)).run();
  }
  // Soft-deleted tasks that still reference the project must also be detached (FK is RESTRICT)
  s.tx.update(schema.tasks).set({ projectId: null, sectionId: null }).where(eq(schema.tasks.projectId, id)).run();
  s.tx.update(P).set({ parentProjectId: p.parentProjectId, updatedAt: now }).where(eq(P.parentProjectId, id)).run();
  s.tx.delete(P).where(eq(P.id, id)).run();
  s.ev.activity({ entityType: 'project', entityId: id, projectId: null, action: 'project.deleted', summary: `deleted a project: ${p.name}`, delta: { taskPolicy: policy, tasks: rows.length } });
  s.ev.emit('project.changed', id, { id, deleted: true });
  if (rows.length) s.ev.emit('task.changed', null, { ids: rows.map((r) => r.id) });
  return { movedTasks: rows.length };
}

export function reorderProjects(s: Scope, ids: string[]): void {
  const owned = s.tx.select({ id: P.id }).from(P).where(and(inArray(P.id, ids), eq(P.ownerUserId, s.ownerId))).all();
  if (owned.length !== ids.length) throw badRequest('Unknown project in order list');
  const now = nowIso();
  ids.forEach((id, i) => s.tx.update(P).set({ sortOrder: i + 1, updatedAt: now }).where(eq(P.id, id)).run());
  s.ev.emit('project.changed', null, { reordered: true });
}

// ====================== Sections ======================
/** At most one Done column per project: marking one clears the flag on the others. */
function clearOtherDone(s: Scope, projectId: string, keepId: string, now: string): void {
  const others = s.tx.select().from(S).where(and(eq(S.projectId, projectId), eq(S.isDone, true), ne(S.id, keepId))).all();
  for (const o of others) s.tx.update(S).set({ isDone: false, updatedAt: now, version: o.version + 1 }).where(eq(S.id, o.id)).run();
}

export function createSection(s: Scope, projectId: string, input: { id?: string; name: string; isDone?: boolean }): SectionDTO {
  loadProject(s, projectId);
  if (input.id) {
    const ex = s.tx.select().from(S).where(eq(S.id, input.id)).get();
    if (ex) {
      if (ex.projectId !== projectId) throw badRequest('Id already in use');
      return sectionToDTO(ex);
    }
  }
  const max = s.tx.select({ m: sql<number>`coalesce(max(${S.sortOrder}), 0)` }).from(S).where(eq(S.projectId, projectId)).get()?.m ?? 0;
  const now = nowIso();
  const id = input.id ?? newId();
  if (input.isDone) clearOtherDone(s, projectId, id, now);
  s.tx.insert(S).values({ id, projectId, name: input.name.trim(), sortOrder: max + 1, isDone: !!input.isDone, createdAt: now, updatedAt: now, version: 1 }).run();
  s.ev.activity({ entityType: 'section', entityId: id, projectId, action: 'section.created', summary: `added a section: ${input.name.trim()}` });
  s.ev.emit('project.changed', projectId, { id: projectId });
  return sectionToDTO(s.tx.select().from(S).where(eq(S.id, id)).get() as typeof S.$inferSelect);
}

function loadSection(s: Scope, id: string) {
  const sec = s.tx.select().from(S).where(eq(S.id, id)).get();
  if (!sec) throw notFound('Section');
  loadProject(s, sec.projectId);
  return sec;
}

export function patchSection(s: Scope, id: string, input: { version: number; name?: string; archived?: boolean; isDone?: boolean }): SectionDTO {
  const sec = loadSection(s, id);
  if (sec.version !== input.version) throw versionConflict(sectionToDTO(sec), input.version);
  const patch: Partial<typeof S.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.archived !== undefined) patch.archivedAt = input.archived ? nowIso() : null;
  if (input.isDone !== undefined) {
    patch.isDone = input.isDone;
    if (input.isDone) clearOtherDone(s, sec.projectId, id, nowIso());
  }
  s.tx.update(S).set({ ...patch, updatedAt: nowIso(), version: sec.version + 1 }).where(eq(S.id, id)).run();
  s.ev.emit('project.changed', sec.projectId, { id: sec.projectId });
  return sectionToDTO(loadSection(s, id));
}

export function deleteSection(s: Scope, id: string): void {
  const sec = loadSection(s, id);
  const now = nowIso();
  const rows = s.tx.select().from(schema.tasks).where(eq(schema.tasks.sectionId, id)).all();
  for (const t of rows) s.tx.update(schema.tasks).set({ sectionId: null, updatedAt: now, version: t.version + 1 }).where(eq(schema.tasks.id, t.id)).run();
  s.tx.delete(S).where(eq(S.id, id)).run();
  s.ev.activity({ entityType: 'section', entityId: id, projectId: sec.projectId, action: 'section.deleted', summary: `deleted a section: ${sec.name}` });
  s.ev.emit('project.changed', sec.projectId, { id: sec.projectId });
  if (rows.length) s.ev.emit('task.changed', null, { ids: rows.map((r) => r.id) });
}

export function reorderSections(s: Scope, projectId: string, ids: string[]): void {
  loadProject(s, projectId);
  const owned = s.tx.select({ id: S.id }).from(S).where(and(inArray(S.id, ids), eq(S.projectId, projectId))).all();
  if (owned.length !== ids.length) throw badRequest('Section does not belong to the project');
  const now = nowIso();
  ids.forEach((id, i) => s.tx.update(S).set({ sortOrder: i + 1, updatedAt: now }).where(eq(S.id, id)).run());
  s.ev.emit('project.changed', projectId, { id: projectId });
}

// ====================== Labels ======================
export function createLabel(s: Scope, input: { id?: string; name: string; color?: string; favorite?: boolean }): { label: LabelDTO; created: boolean } {
  const lower = input.name.trim().toLowerCase();
  const dup = s.tx.select().from(L).where(and(eq(L.ownerUserId, s.ownerId), eq(L.nameLower, lower))).get();
  if (dup) {
    if (input.id && dup.id === input.id) return { label: labelToDTO(dup), created: false };
    throw conflict('LABEL_EXISTS', `A label named "${dup.name}" already exists`, { existingId: dup.id });
  }
  const max = s.tx.select({ m: sql<number>`coalesce(max(${L.sortOrder}), 0)` }).from(L).where(eq(L.ownerUserId, s.ownerId)).get()?.m ?? 0;
  const now = nowIso();
  const id = input.id ?? newId();
  s.tx.insert(L).values({ id, ownerUserId: s.ownerId, name: input.name.trim(), nameLower: lower, color: input.color ?? '#8b8d98', favorite: input.favorite ?? false, sortOrder: max + 1, createdAt: now, updatedAt: now }).run();
  s.ev.emit('label.changed', id, { id });
  return { label: labelToDTO(s.tx.select().from(L).where(eq(L.id, id)).get() as typeof L.$inferSelect), created: true };
}

function touchTasksWithLabel(s: Scope, labelId: string) {
  const now = nowIso();
  const ids = s.tx.select({ id: schema.taskLabels.taskId }).from(schema.taskLabels).where(eq(schema.taskLabels.labelId, labelId)).all().map((r) => r.id);
  for (const id of ids) {
    const t = s.tx.select({ v: schema.tasks.version }).from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    if (t) s.tx.update(schema.tasks).set({ updatedAt: now, version: t.v + 1 }).where(eq(schema.tasks.id, id)).run();
  }
  if (ids.length) s.ev.emit('task.changed', null, { ids });
}

function loadLabel(s: Scope, id: string) {
  const l = s.tx.select().from(L).where(and(eq(L.id, id), eq(L.ownerUserId, s.ownerId))).get();
  if (!l) throw notFound('Label');
  return l;
}

export function patchLabel(s: Scope, id: string, input: { name?: string; color?: string; favorite?: boolean; mergeIntoId?: string }): LabelDTO | null {
  const l = loadLabel(s, id);
  if (input.mergeIntoId) {
    const target = loadLabel(s, input.mergeIntoId);
    if (target.id === l.id) throw badRequest('Cannot merge a label into itself');
    const taskIds = s.tx.select({ id: schema.taskLabels.taskId }).from(schema.taskLabels).where(eq(schema.taskLabels.labelId, l.id)).all().map((r) => r.id);
    const now = nowIso();
    for (const t of taskIds) {
      s.tx.insert(schema.taskLabels).values({ taskId: t, labelId: target.id }).onConflictDoNothing().run();
      const row = s.tx.select({ v: schema.tasks.version }).from(schema.tasks).where(eq(schema.tasks.id, t)).get();
      if (row) s.tx.update(schema.tasks).set({ updatedAt: now, version: row.v + 1 }).where(eq(schema.tasks.id, t)).run();
    }
    s.tx.delete(L).where(eq(L.id, l.id)).run();
    s.ev.emit('label.changed', id, { id, merged: target.id });
    if (taskIds.length) s.ev.emit('task.changed', null, { ids: taskIds });
    return null;
  }
  const patch: Partial<typeof L.$inferInsert> = {};
  if (input.name !== undefined) {
    const lower = input.name.trim().toLowerCase();
    const dup = s.tx.select().from(L).where(and(eq(L.ownerUserId, s.ownerId), eq(L.nameLower, lower))).get();
    if (dup && dup.id !== id) throw conflict('LABEL_EXISTS', `A label named "${dup.name}" already exists`, { existingId: dup.id });
    patch.name = input.name.trim();
    patch.nameLower = lower;
  }
  if (input.color !== undefined) patch.color = input.color;
  if (input.favorite !== undefined) patch.favorite = input.favorite;
  s.tx.update(L).set({ ...patch, updatedAt: nowIso() }).where(eq(L.id, id)).run();
  s.ev.emit('label.changed', id, { id });
  return labelToDTO(loadLabel(s, id));
}

export function deleteLabel(s: Scope, id: string): void {
  loadLabel(s, id);
  touchTasksWithLabel(s, id);
  s.tx.delete(L).where(eq(L.id, id)).run();
  s.ev.emit('label.changed', id, { id, deleted: true });
}

/** Resolve names to ids, creating missing labels (used by Quick Add). */
export function ensureLabelNames(s: Scope, names: string[]): string[] {
  const ids: string[] = [];
  for (const n of names) {
    const ex = s.tx.select().from(L).where(and(eq(L.ownerUserId, s.ownerId), eq(L.nameLower, n.toLowerCase()))).get();
    ids.push(ex ? ex.id : createLabel(s, { name: n }).label.id);
  }
  return ids;
}

// ====================== Comments ======================
export function addComment(s: Scope, taskId: string, input: { id?: string; body: string }): CommentDTO {
  const t = loadOwnedTask(s, taskId);
  const now = nowIso();
  const id = input.id ?? newId();
  const ex = s.tx.select().from(schema.taskComments).where(eq(schema.taskComments.id, id)).get();
  if (ex) {
    if (ex.taskId !== taskId || ex.ownerUserId !== s.ownerId) throw badRequest('Id already in use');
    return commentToDTO(ex);
  }
  s.tx.insert(schema.taskComments).values({ id, taskId, ownerUserId: s.ownerId, body: input.body.trim(), createdAt: now, updatedAt: now }).run();
  // Comment bodies are intentionally not copied into the activity journal.
  s.ev.activity({ entityType: 'comment', entityId: id, projectId: t.projectId, action: 'comment.created', summary: `commented on a task: ${t.title}` });
  s.ev.emit('task.changed', taskId, { ids: [taskId], comments: true });
  return commentToDTO(s.tx.select().from(schema.taskComments).where(eq(schema.taskComments.id, id)).get() as typeof schema.taskComments.$inferSelect);
}

export function listComments(q: Db | Tx, ownerId: string, taskId: string): CommentDTO[] {
  const t = q.select({ id: schema.tasks.id }).from(schema.tasks).where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.ownerUserId, ownerId))).get();
  if (!t) throw notFound('Task');
  return q.select().from(schema.taskComments).where(and(eq(schema.taskComments.taskId, taskId), isNull(schema.taskComments.deletedAt))).orderBy(asc(schema.taskComments.createdAt)).all().map(commentToDTO);
}

export function deleteComment(s: Scope, taskId: string, commentId: string): void {
  loadOwnedTask(s, taskId);
  const c = s.tx.select().from(schema.taskComments).where(and(eq(schema.taskComments.id, commentId), eq(schema.taskComments.taskId, taskId))).get();
  if (!c) throw notFound('Comment');
  s.tx.update(schema.taskComments).set({ deletedAt: nowIso() }).where(eq(schema.taskComments.id, commentId)).run();
  s.ev.emit('task.changed', taskId, { ids: [taskId], comments: true });
}

// ====================== Reminders ======================
function bumpTask(s: Scope, taskId: string) {
  const t = loadOwnedTask(s, taskId);
  s.tx.update(schema.tasks).set({ updatedAt: nowIso(), version: t.version + 1 }).where(eq(schema.tasks.id, taskId)).run();
  s.ev.emit('task.changed', taskId, { ids: [taskId] });
  return t;
}

export function addReminder(s: Scope, taskId: string, input: ReminderInput): ReminderDTO {
  const t = loadOwnedTask(s, taskId);
  const now = nowIso();
  const id = input.id ?? newId();
  s.tx.insert(schema.taskReminders)
    .values({ id, taskId, kind: input.kind, offsetMinutes: input.kind === 'relative' ? (input.offsetMinutes ?? 0) : null, atUtc: input.kind === 'absolute' ? (input.atUtc ?? null) : null, timezone: t.dueTimezone ?? s.tz, channel: input.channel, enabled: input.enabled, createdAt: now, updatedAt: now })
    .run();
  bumpTask(s, taskId);
  return reminderToDTO(s.tx.select().from(schema.taskReminders).where(eq(schema.taskReminders.id, id)).get() as typeof schema.taskReminders.$inferSelect);
}

export function patchReminder(s: Scope, taskId: string, reminderId: string, input: Partial<ReminderInput>): ReminderDTO {
  loadOwnedTask(s, taskId);
  const r = s.tx.select().from(schema.taskReminders).where(and(eq(schema.taskReminders.id, reminderId), eq(schema.taskReminders.taskId, taskId))).get();
  if (!r) throw notFound('Reminder');
  const patch: Partial<typeof schema.taskReminders.$inferInsert> = { updatedAt: nowIso() };
  if (input.kind) patch.kind = input.kind;
  if (input.offsetMinutes !== undefined) patch.offsetMinutes = input.offsetMinutes;
  if (input.atUtc !== undefined) patch.atUtc = input.atUtc;
  if (input.channel) patch.channel = input.channel;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  // time changed -> allow it to fire again
  if (input.atUtc !== undefined || input.offsetMinutes !== undefined) patch.lastSentOccurrenceKey = null;
  s.tx.update(schema.taskReminders).set(patch).where(eq(schema.taskReminders.id, reminderId)).run();
  bumpTask(s, taskId);
  return reminderToDTO(s.tx.select().from(schema.taskReminders).where(eq(schema.taskReminders.id, reminderId)).get() as typeof schema.taskReminders.$inferSelect);
}

export function deleteReminder(s: Scope, taskId: string, reminderId: string): void {
  loadOwnedTask(s, taskId);
  s.tx.delete(schema.taskReminders).where(and(eq(schema.taskReminders.id, reminderId), eq(schema.taskReminders.taskId, taskId))).run();
  bumpTask(s, taskId);
}

// ====================== Saved filters ======================
export function createFilter(s: Scope, input: { id?: string; name: string; description?: string; ast: unknown; sort?: string; favorite?: boolean }): SavedFilterDTO {
  const now = nowIso();
  const id = input.id ?? newId();
  const ex = s.tx.select().from(schema.savedFilters).where(eq(schema.savedFilters.id, id)).get();
  if (ex) {
    if (ex.ownerUserId !== s.ownerId) throw badRequest('Id already in use');
    return filterToDTO(ex);
  }
  s.tx.insert(schema.savedFilters).values({ id, ownerUserId: s.ownerId, name: input.name.trim(), description: input.description ?? '', filterAstJson: JSON.stringify(input.ast), sort: input.sort ?? 'position', favorite: input.favorite ?? false, createdAt: now, updatedAt: now }).run();
  s.ev.emit('filter.changed', id, { id });
  return filterToDTO(s.tx.select().from(schema.savedFilters).where(eq(schema.savedFilters.id, id)).get() as typeof schema.savedFilters.$inferSelect);
}

export function patchFilter(s: Scope, id: string, input: { name?: string; description?: string; ast?: unknown; sort?: string; favorite?: boolean }): SavedFilterDTO {
  const f = s.tx.select().from(schema.savedFilters).where(and(eq(schema.savedFilters.id, id), eq(schema.savedFilters.ownerUserId, s.ownerId))).get();
  if (!f) throw notFound('Filter');
  const patch: Partial<typeof schema.savedFilters.$inferInsert> = { updatedAt: nowIso() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) patch.description = input.description;
  if (input.ast !== undefined) patch.filterAstJson = JSON.stringify(input.ast);
  if (input.sort !== undefined) patch.sort = input.sort;
  if (input.favorite !== undefined) patch.favorite = input.favorite;
  s.tx.update(schema.savedFilters).set(patch).where(eq(schema.savedFilters.id, id)).run();
  s.ev.emit('filter.changed', id, { id });
  return filterToDTO(s.tx.select().from(schema.savedFilters).where(eq(schema.savedFilters.id, id)).get() as typeof schema.savedFilters.$inferSelect);
}

export function deleteFilter(s: Scope, id: string): void {
  const r = s.tx.delete(schema.savedFilters).where(and(eq(schema.savedFilters.id, id), eq(schema.savedFilters.ownerUserId, s.ownerId))).run();
  if (r.changes === 0) throw notFound('Filter');
  s.ev.emit('filter.changed', id, { id, deleted: true });
}

// ====================== Templates ======================
export function createTemplate(s: Scope, input: { id?: string; name: string; description?: string; kind: 'project' | 'task'; body: TemplateBody }): TemplateDTO {
  const now = nowIso();
  const id = input.id ?? newId();
  s.tx.insert(schema.templates).values({ id, ownerUserId: s.ownerId, name: input.name.trim(), description: input.description ?? '', kind: input.kind, bodyJson: JSON.stringify(input.body), isBuiltin: false, createdAt: now, updatedAt: now }).run();
  return templateToDTO(s.tx.select().from(schema.templates).where(eq(schema.templates.id, id)).get() as typeof schema.templates.$inferSelect);
}

export function patchTemplate(s: Scope, id: string, input: { name?: string; description?: string; body?: TemplateBody }): TemplateDTO {
  const t = s.tx.select().from(schema.templates).where(eq(schema.templates.id, id)).get();
  if (!t || t.ownerUserId !== s.ownerId) throw notFound('Template');
  if (t.isBuiltin) throw new AppError(403, 'FORBIDDEN', 'Built-in templates cannot be edited. Duplicate it first.');
  const patch: Partial<typeof schema.templates.$inferInsert> = { updatedAt: nowIso() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) patch.description = input.description;
  if (input.body !== undefined) patch.bodyJson = JSON.stringify(input.body);
  s.tx.update(schema.templates).set(patch).where(eq(schema.templates.id, id)).run();
  return templateToDTO(s.tx.select().from(schema.templates).where(eq(schema.templates.id, id)).get() as typeof schema.templates.$inferSelect);
}

export function deleteTemplate(s: Scope, id: string): void {
  const t = s.tx.select().from(schema.templates).where(eq(schema.templates.id, id)).get();
  if (!t || t.ownerUserId !== s.ownerId) throw notFound('Template');
  if (t.isBuiltin) throw new AppError(403, 'FORBIDDEN', 'Built-in templates cannot be deleted');
  s.tx.delete(schema.templates).where(eq(schema.templates.id, id)).run();
}

export interface TemplatePreview {
  project: { name: string; color: string; defaultView: string } | null;
  sections: { name: string; taskCount: number }[];
  taskCount: number;
  subtaskCount: number;
}

function countTasks(tasks: TemplateTask[]): { tasks: number; subtasks: number } {
  let tasksN = 0;
  let sub = 0;
  const walk = (list: TemplateTask[], depth: number) => {
    for (const t of list) {
      if (depth === 0) tasksN++;
      else sub++;
      if (t.subtasks) walk(t.subtasks, depth + 1);
    }
  };
  walk(tasks, 0);
  return { tasks: tasksN, subtasks: sub };
}

export function previewTemplate(body: TemplateBody, kind: 'project' | 'task', overrideName?: string): TemplatePreview {
  const all = [...body.sections.flatMap((s) => s.tasks), ...body.tasks];
  const c = countTasks(all);
  return {
    project: kind === 'project' ? { name: overrideName ?? body.project?.name ?? 'New project', color: body.project?.color ?? '#8b8d98', defaultView: body.project?.defaultView ?? 'list' } : null,
    sections: body.sections.map((s) => ({ name: s.name, taskCount: countTasks(s.tasks).tasks })),
    taskCount: c.tasks,
    subtaskCount: c.subtasks,
  };
}

export function applyTemplate(s: Scope, templateId: string, opts: { projectName?: string; projectId?: string | null; startDate?: string }): { projectId: string | null; taskIds: string[] } {
  const row = s.tx.select().from(schema.templates).where(eq(schema.templates.id, templateId)).get();
  if (!row || (row.ownerUserId !== null && row.ownerUserId !== s.ownerId)) throw notFound('Template');
  const body = templateBodySchema.parse(JSON.parse(row.bodyJson));
  const start = opts.startDate ?? todayLocal(s.tz);
  let projectId: string | null = opts.projectId ?? null;
  if (row.kind === 'project') {
    const proj = createProject(s, {
      name: opts.projectName ?? body.project?.name ?? row.name,
      description: body.project?.description,
      outcome: body.project?.outcome,
      color: body.project?.color,
      defaultView: body.project?.defaultView,
    });
    projectId = proj.project.id;
  } else if (projectId) {
    loadProject(s, projectId);
  }
  const taskIds: string[] = [];
  const addTasks = (list: TemplateTask[], sectionId: string | null, parent: string | null) => {
    for (const t of list) {
      const created = createTask(s, {
        title: t.title,
        description: t.description,
        priority: t.priority,
        projectId: parent ? undefined : projectId,
        sectionId: parent ? undefined : sectionId,
        parentTaskId: parent,
        dueDate: t.dueOffsetDays !== undefined ? addDays(start, t.dueOffsetDays) : undefined,
        dueTimezone: t.dueOffsetDays !== undefined ? s.tz : undefined,
      }).task;
      taskIds.push(created.id);
      if (t.subtasks?.length) addTasks(t.subtasks, sectionId, created.id);
    }
  };
  if (projectId) {
    for (const sec of body.sections) {
      const created = createSection(s, projectId, { name: sec.name });
      addTasks(sec.tasks, created.id, null);
    }
  }
  addTasks(body.tasks, null, null);
  s.ev.activity({ entityType: 'template', entityId: templateId, projectId, action: 'template.applied', summary: `applied template: ${row.name}`, delta: { tasks: taskIds.length } });
  return { projectId, taskIds };
}

// ====================== Preferences ======================
export function getPreferences(q: Db | Tx, userId: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...preferenceDefaults };
  for (const r of q.select().from(schema.userPreferences).where(eq(schema.userPreferences.userId, userId)).all()) {
    const key = r.key as PreferenceKey;
    const sch = preferenceSchemas[key] as z.ZodType | undefined;
    if (!sch) continue;
    const parsed = sch.safeParse(JSON.parse(r.jsonValue));
    if (parsed.success) out[key] = parsed.data;
  }
  return out;
}

export function patchPreferences(s: Scope, values: Record<string, unknown>): Record<string, unknown> {
  const details: { field: string; message: string }[] = [];
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    const sch = preferenceSchemas[k as PreferenceKey] as z.ZodType | undefined;
    if (!sch) { details.push({ field: k, message: 'Unknown preference' }); continue; }
    const r = sch.safeParse(v);
    if (!r.success) details.push({ field: k, message: r.error.issues[0]?.message ?? 'Invalid value' });
    else clean[k] = r.data;
  }
  if (details.length) throw badRequest('Invalid preferences', details);
  const now = nowIso();
  for (const [k, v] of Object.entries(clean)) {
    s.tx.insert(schema.userPreferences).values({ userId: s.ownerId, key: k, jsonValue: JSON.stringify(v), updatedAt: now }).onConflictDoUpdate({ target: [schema.userPreferences.userId, schema.userPreferences.key], set: { jsonValue: JSON.stringify(v), updatedAt: now } }).run();
  }
  s.ev.emit('preferences.changed', null, { keys: Object.keys(clean) });
  return getPreferences(s.tx, s.ownerId);
}

export { getTaskDTO };
export type { TaskDTO };
