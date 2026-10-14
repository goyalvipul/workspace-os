import { and, eq, inArray } from 'drizzle-orm';
import type {
  ActivityDTO,
  CommentDTO,
  LabelDTO,
  ProjectDTO,
  ReminderDTO,
  SavedFilterDTO,
  SectionDTO,
  TaskDTO,
  TemplateDTO,
  UserDTO,
} from '@wos/shared';
import { filterNodeSchema, templateBodySchema } from '@wos/shared';
import { schema, type Db, type Tx } from '../db/client.js';
import { chunk } from '../util.js';

export type Q = Db | Tx;
type TaskRow = typeof schema.tasks.$inferSelect;

export function userToDTO(u: typeof schema.users.$inferSelect): UserDTO {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    displayName: u.displayName,
    timezone: u.timezone,
    weekStartsOn: u.weekStartsOn === 0 ? 0 : 1,
    theme: (['dark', 'light', 'system'].includes(u.theme) ? u.theme : 'dark') as UserDTO['theme'],
    timeFormat: u.timeFormat === '24h' ? '24h' : '12h',
  };
}

export function projectToDTO(p: typeof schema.projects.$inferSelect): ProjectDTO {
  return {
    id: p.id,
    parentProjectId: p.parentProjectId,
    name: p.name,
    description: p.description,
    outcome: p.outcome,
    color: p.color,
    icon: p.icon,
    favorite: p.favorite,
    archivedAt: p.archivedAt,
    sortOrder: p.sortOrder,
    defaultView: p.defaultView === 'board' ? 'board' : 'list',
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    version: p.version,
  };
}

export function sectionToDTO(s: typeof schema.sections.$inferSelect): SectionDTO {
  return { id: s.id, projectId: s.projectId, name: s.name, sortOrder: s.sortOrder, archivedAt: s.archivedAt, createdAt: s.createdAt, updatedAt: s.updatedAt, version: s.version };
}

export function labelToDTO(l: typeof schema.labels.$inferSelect): LabelDTO {
  return { id: l.id, name: l.name, color: l.color, sortOrder: l.sortOrder, favorite: l.favorite, createdAt: l.createdAt, updatedAt: l.updatedAt };
}

export function commentToDTO(c: typeof schema.taskComments.$inferSelect): CommentDTO {
  return { id: c.id, taskId: c.taskId, body: c.body, createdAt: c.createdAt, updatedAt: c.updatedAt };
}

export function filterToDTO(f: typeof schema.savedFilters.$inferSelect): SavedFilterDTO {
  const ast = filterNodeSchema.parse(JSON.parse(f.filterAstJson));
  const sort = (['position', 'due', 'priority', 'created', 'title'].includes(f.sort) ? f.sort : 'position') as SavedFilterDTO['sort'];
  return { id: f.id, name: f.name, description: f.description, ast, sort, favorite: f.favorite, createdAt: f.createdAt, updatedAt: f.updatedAt };
}

export function templateToDTO(t: typeof schema.templates.$inferSelect): TemplateDTO {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    kind: t.kind === 'task' ? 'task' : 'project',
    isBuiltin: t.isBuiltin,
    body: templateBodySchema.parse(JSON.parse(t.bodyJson)),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export function reminderToDTO(r: typeof schema.taskReminders.$inferSelect): ReminderDTO {
  return {
    id: r.id,
    kind: r.kind === 'absolute' ? 'absolute' : 'relative',
    offsetMinutes: r.offsetMinutes,
    atUtc: r.atUtc,
    channel: r.channel === 'webpush' ? 'webpush' : 'inapp',
    enabled: r.enabled,
  };
}

export function hydrateTasks(q: Q, rows: TaskRow[]): TaskDTO[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const labelMap = new Map<string, string[]>();
  const reminderMap = new Map<string, ReminderDTO[]>();
  for (const part of chunk(ids, 400)) {
    for (const tl of q.select().from(schema.taskLabels).where(inArray(schema.taskLabels.taskId, part)).all()) {
      const arr = labelMap.get(tl.taskId) ?? [];
      arr.push(tl.labelId);
      labelMap.set(tl.taskId, arr);
    }
    for (const r of q.select().from(schema.taskReminders).where(inArray(schema.taskReminders.taskId, part)).all()) {
      const arr = reminderMap.get(r.taskId) ?? [];
      arr.push(reminderToDTO(r));
      reminderMap.set(r.taskId, arr);
    }
  }
  return rows.map((t) => taskRowToDTO(t, labelMap.get(t.id) ?? [], reminderMap.get(t.id) ?? []));
}

export function taskRowToDTO(t: TaskRow, labelIds: string[], reminders: ReminderDTO[]): TaskDTO {
  return {
    id: t.id,
    projectId: t.projectId,
    sectionId: t.sectionId,
    parentTaskId: t.parentTaskId,
    title: t.title,
    description: t.description,
    priority: t.priority,
    status: (t.status as TaskDTO['status']) ?? 'open',
    position: t.position,
    scheduledDate: t.scheduledDate,
    scheduledAtUtc: t.scheduledAtUtc,
    dueDate: t.dueDate,
    dueAtUtc: t.dueAtUtc,
    dueTimezone: t.dueTimezone,
    deadlineDate: t.deadlineDate,
    estimateMinutes: t.estimateMinutes,
    recurrence: t.recurrenceRule
      ? { rule: t.recurrenceRule, mode: t.recurrenceMode === 'after_completion' ? 'after_completion' : 'fixed', timezone: t.recurrenceTimezone }
      : null,
    nextOccurrenceKey: t.nextOccurrenceKey,
    labelIds: labelIds.sort(),
    reminders,
    completedAt: t.completedAt,
    deletedAt: t.deletedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    version: t.version,
  };
}

export function getTaskDTO(q: Q, ownerId: string, id: string): TaskDTO | null {
  const row = q.select().from(schema.tasks).where(and(eq(schema.tasks.id, id), eq(schema.tasks.ownerUserId, ownerId))).get();
  if (!row) return null;
  return hydrateTasks(q, [row])[0] ?? null;
}

export function activityToDTO(
  a: typeof schema.activityEvents.$inferSelect,
  project: { name: string; color: string } | null,
): ActivityDTO {
  return {
    id: a.id,
    entityType: a.entityType,
    entityId: a.entityId,
    action: a.action,
    summary: a.publicSummary,
    projectId: a.projectId,
    projectName: project?.name ?? null,
    projectColor: project?.color ?? null,
    delta: a.deltaJson ? (JSON.parse(a.deltaJson) as Record<string, unknown>) : null,
    createdAt: a.createdAt,
  };
}
