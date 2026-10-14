import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  bulkInput,
  commentInput,
  compareTasks,
  completeInput,
  dateStr,
  descendantsOf,
  evalFilter,
  filterNodeSchema,
  labelCreateInput,
  labelPatchInput,
  localDateOf,
  projectCreateInput,
  projectPatchInput,
  reminderInput,
  reopenInput,
  reorderInput,
  savedFilterInput,
  sectionCreateInput,
  sectionPatchInput,
  taskCreateInput,
  taskPatchInput,
  templateApplyInput,
  templateBodySchema,
  templateInput,
  todayLocal,
  ulid,
  type FilterNode,
} from '@wos/shared';
import type { AppContext } from '../context.js';
import { schema } from '../db/client.js';
import { notFound } from '../errors.js';
import { ensureCoverage, enqueue, listCalendars } from '../calendar/service.js';
import { filterToDTO, getTaskDTO, hydrateTasks, labelToDTO, projectToDTO, sectionToDTO, templateToDTO } from '../services/mappers.js';
import { activityList, reportSummary, search, viewCalendar, viewInbox, viewToday, viewUpcoming } from '../services/queries.js';
import { bulkTasks, completeTask, createTask, deleteTask, patchTask, queryTasks, reopenTask, reorderTask, restoreTask } from '../services/tasks.js';
import {
  addComment, addReminder, applyTemplate, createFilter, createLabel, createProject, createSection, createTemplate,
  deleteComment, deleteFilter, deleteLabel, deleteProject, deleteReminder, deleteSection, deleteTemplate, listComments,
  patchFilter, patchLabel, patchProject, patchReminder, patchSection, patchTemplate, previewTemplate, reorderProjects, reorderSections,
} from '../services/workspace.js';
import type { Api } from './kit.js';

/** Remember that a calendar view is open (active polling cadence) and queue refreshes for stale sources. */
export function touchCalendarView(ctx: AppContext, ownerId: string, range?: { start: string; end: string }) {
  ctx.presence.lastCalendarViewAt = Date.now();
  let stale = false;
  for (const c of listCalendars(ctx, ownerId)) {
    if (!c.isSelected || c.syncHealth === 'reauth_required') continue;
    const age = c.lastSuccessAt ? Date.now() - Date.parse(c.lastSuccessAt) : Infinity;
    if (age > ctx.env.ACTIVE_SYNC_SECONDS * 1000) {
      enqueue(ctx, { kind: 'sync', calendarId: c.id });
      stale = true;
    }
  }
  const backfilling = range ? ensureCoverage(ctx, ownerId, range.start, range.end) : false;
  if (stale || backfilling) ctx.nudgeSync?.();
  return { refreshQueued: stale, backfillQueued: backfilling };
}

const csvIds = z.string().optional().transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined));
const num = (d: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(d);

export function registerWorkspace(api: Api, ctx: AppContext) {
  // ====================== Tasks ======================
  api({
    method: 'GET', url: '/tasks', summary: 'List tasks (filters, FTS, pagination)', tag: 'tasks',
    query: z.object({
      projectId: z.string().optional(), sectionId: ulid.optional(), parentTaskId: ulid.optional(),
      status: z.enum(['open', 'completed', 'archived']).optional(),
      priority: z.coerce.number().int().min(1).max(4).optional(),
      labelIds: csvIds, dueFrom: dateStr.optional(), dueTo: dateStr.optional(), scheduledFrom: dateStr.optional(), scheduledTo: dateStr.optional(),
      q: z.string().max(200).optional(), sort: z.enum(['position', 'due', 'priority', 'created', 'title']).optional(),
      includeCompleted: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
      limit: num(100, 1, 200), offset: num(0, 0, 1_000_000),
    }),
    handler: (c) => {
      const r = queryTasks(ctx.db, c.user.id, { ...c.query, projectId: c.query.projectId });
      return { items: r.items, total: r.total, limit: c.query.limit, offset: c.query.offset, nextOffset: c.query.offset + r.items.length < r.total ? c.query.offset + r.items.length : null };
    },
  });

  api({
    method: 'POST', url: '/tasks', summary: 'Create a task (title only is enough)', tag: 'tasks', body: taskCreateInput,
    handler: (c) => {
      const r = c.tx((s) => createTask(s, c.body));
      c.reply.code(r.created ? 201 : 200);
      return { task: r.task };
    },
  });

  api({
    method: 'GET', url: '/tasks/:id', summary: 'Get a task', tag: 'tasks',
    handler: (c) => {
      const t = getTaskDTO(ctx.db, c.user.id, c.params.id as string);
      if (!t) throw notFound('Task');
      return { task: t };
    },
  });
  api({ method: 'PATCH', url: '/tasks/:id', summary: 'Update a task (needs current version)', tag: 'tasks', body: taskPatchInput, handler: (c) => ({ task: c.tx((s) => patchTask(s, c.params.id as string, c.body)) }) });
  api({ method: 'DELETE', url: '/tasks/:id', summary: 'Soft-delete a task and its subtasks', tag: 'tasks', handler: (c) => ({ task: c.tx((s) => deleteTask(s, c.params.id as string)) }) });
  api({ method: 'POST', url: '/tasks/:id/restore', summary: 'Restore a soft-deleted task', tag: 'tasks', handler: (c) => ({ task: c.tx((s) => restoreTask(s, c.params.id as string)) }) });
  api({
    method: 'POST', url: '/tasks/:id/complete', summary: 'Complete a task (or the current occurrence of a recurring task)', tag: 'tasks', body: completeInput,
    handler: (c) => ({ task: c.tx((s) => completeTask(s, c.params.id as string, c.body)) }),
  });
  api({
    method: 'POST', url: '/tasks/:id/reopen', summary: 'Undo a completion (idempotent)', tag: 'tasks', body: reopenInput,
    handler: (c) => ({ task: c.tx((s) => reopenTask(s, c.params.id as string, c.body)) }),
  });
  api({
    method: 'GET', url: '/tasks/:id/completions', summary: 'Completion history', tag: 'tasks',
    handler: (c) => {
      const t = getTaskDTO(ctx.db, c.user.id, c.params.id as string);
      if (!t) throw notFound('Task');
      const rows = ctx.db.select().from(schema.taskCompletions).where(eq(schema.taskCompletions.taskId, t.id)).orderBy(desc(schema.taskCompletions.completedAt)).all();
      return { items: rows.map((r) => ({ id: r.id, occurrenceKey: r.occurrenceKey, completedAt: r.completedAt, originalDueDate: r.originalDueDate, originalDueAtUtc: r.originalDueAtUtc, undoneAt: r.undoneAt })) };
    },
  });
  api({
    method: 'POST', url: '/tasks/:id/subtasks', summary: 'Create a subtask', tag: 'tasks', body: taskCreateInput,
    handler: (c) => {
      const r = c.tx((s) => createTask(s, { ...c.body, parentTaskId: c.params.id as string }));
      c.reply.code(r.created ? 201 : 200);
      return { task: r.task };
    },
  });
  api({ method: 'POST', url: '/tasks/bulk', summary: 'Bulk action (all-or-nothing)', tag: 'tasks', body: bulkInput, handler: (c) => ({ tasks: c.tx((s) => bulkTasks(s, c.body)) }) });
  api({ method: 'POST', url: '/tasks/reorder', summary: 'Move/reorder a task within or between lists', tag: 'tasks', body: reorderInput, handler: (c) => ({ task: c.tx((s) => reorderTask(s, c.body)) }) });

  // comments
  api({ method: 'GET', url: '/tasks/:id/comments', summary: 'List comments', tag: 'tasks', handler: (c) => ({ items: listComments(ctx.db, c.user.id, c.params.id as string) }) });
  api({
    method: 'POST', url: '/tasks/:id/comments', summary: 'Add a comment', tag: 'tasks', body: commentInput,
    handler: (c) => { c.reply.code(201); return { comment: c.tx((s) => addComment(s, c.params.id as string, c.body)) }; },
  });
  api({ method: 'DELETE', url: '/tasks/:id/comments/:cid', summary: 'Delete a comment', tag: 'tasks', handler: (c) => { c.tx((s) => deleteComment(s, c.params.id as string, c.params.cid as string)); return { ok: true }; } });

  // reminders
  api({
    method: 'GET', url: '/tasks/:id/reminders', summary: 'List reminders', tag: 'tasks',
    handler: (c) => {
      const t = getTaskDTO(ctx.db, c.user.id, c.params.id as string);
      if (!t) throw notFound('Task');
      return { items: t.reminders };
    },
  });
  api({ method: 'POST', url: '/tasks/:id/reminders', summary: 'Add a reminder', tag: 'tasks', body: reminderInput, handler: (c) => { c.reply.code(201); return { reminder: c.tx((s) => addReminder(s, c.params.id as string, c.body)) }; } });
  api({
    method: 'PATCH', url: '/tasks/:id/reminders/:rid', summary: 'Update a reminder', tag: 'tasks', body: z.object({ kind: z.enum(['relative', 'absolute']).optional(), offsetMinutes: z.number().int().min(0).nullish(), atUtc: z.string().nullish(), channel: z.enum(['inapp', 'webpush']).optional(), enabled: z.boolean().optional() }),
    handler: (c) => ({ reminder: c.tx((s) => patchReminder(s, c.params.id as string, c.params.rid as string, c.body)) }),
  });
  api({ method: 'DELETE', url: '/tasks/:id/reminders/:rid', summary: 'Delete a reminder', tag: 'tasks', handler: (c) => { c.tx((s) => deleteReminder(s, c.params.id as string, c.params.rid as string)); return { ok: true }; } });

  // ====================== Projects / sections ======================
  api({
    method: 'GET', url: '/projects', summary: 'List projects', tag: 'projects',
    query: z.object({ includeArchived: z.enum(['true', 'false']).optional().transform((v) => v === 'true') }),
    handler: (c) => {
      const rows = ctx.db.select().from(schema.projects).where(and(eq(schema.projects.ownerUserId, c.user.id), c.query.includeArchived ? undefined : isNull(schema.projects.archivedAt))).orderBy(schema.projects.sortOrder).all();
      return { items: rows.map(projectToDTO) };
    },
  });
  api({ method: 'POST', url: '/projects', summary: 'Create a project', tag: 'projects', body: projectCreateInput, handler: (c) => { const r = c.tx((s) => createProject(s, c.body)); c.reply.code(r.created ? 201 : 200); return { project: r.project }; } });
  api({ method: 'PATCH', url: '/projects/:id', summary: 'Update / archive a project', tag: 'projects', body: projectPatchInput, handler: (c) => ({ project: c.tx((s) => patchProject(s, c.params.id as string, c.body)) }) });
  api({
    method: 'DELETE', url: '/projects/:id', summary: 'Delete a project (explicit task policy + confirm required)', tag: 'projects',
    query: z.object({ taskPolicy: z.enum(['move_to_inbox', 'archive', 'delete']), confirm: z.literal('true') }),
    handler: (c) => c.tx((s) => deleteProject(s, c.params.id as string, c.query.taskPolicy)),
  });
  api({ method: 'POST', url: '/projects/reorder', summary: 'Reorder projects', tag: 'projects', body: z.object({ ids: z.array(ulid).min(1).max(1000) }), handler: (c) => { c.tx((s) => reorderProjects(s, c.body.ids)); return { ok: true }; } });

  api({
    method: 'GET', url: '/projects/:id/sections', summary: 'List sections', tag: 'projects',
    handler: (c) => {
      const p = ctx.db.select().from(schema.projects).where(and(eq(schema.projects.id, c.params.id as string), eq(schema.projects.ownerUserId, c.user.id))).get();
      if (!p) throw notFound('Project');
      return { items: ctx.db.select().from(schema.sections).where(eq(schema.sections.projectId, p.id)).orderBy(schema.sections.sortOrder).all().map(sectionToDTO) };
    },
  });
  api({ method: 'POST', url: '/projects/:id/sections', summary: 'Create a section', tag: 'projects', body: sectionCreateInput, handler: (c) => { c.reply.code(201); return { section: c.tx((s) => createSection(s, c.params.id as string, c.body)) }; } });
  api({ method: 'PATCH', url: '/sections/:id', summary: 'Rename / archive a section', tag: 'projects', body: sectionPatchInput, handler: (c) => ({ section: c.tx((s) => patchSection(s, c.params.id as string, c.body)) }) });
  api({ method: 'DELETE', url: '/sections/:id', summary: 'Delete a section (tasks stay in the project)', tag: 'projects', handler: (c) => { c.tx((s) => deleteSection(s, c.params.id as string)); return { ok: true }; } });
  api({ method: 'POST', url: '/sections/reorder', summary: 'Reorder sections in a project', tag: 'projects', body: z.object({ projectId: ulid, ids: z.array(ulid).min(1).max(200) }), handler: (c) => { c.tx((s) => reorderSections(s, c.body.projectId, c.body.ids)); return { ok: true }; } });

  // ====================== Labels ======================
  api({ method: 'GET', url: '/labels', summary: 'List labels', tag: 'labels', handler: (c) => ({ items: ctx.db.select().from(schema.labels).where(eq(schema.labels.ownerUserId, c.user.id)).orderBy(schema.labels.sortOrder).all().map(labelToDTO) }) });
  api({ method: 'POST', url: '/labels', summary: 'Create a label (case-insensitive unique)', tag: 'labels', body: labelCreateInput, handler: (c) => { const r = c.tx((s) => createLabel(s, c.body)); c.reply.code(r.created ? 201 : 200); return { label: r.label }; } });
  api({ method: 'PATCH', url: '/labels/:id', summary: 'Edit or merge a label', tag: 'labels', body: labelPatchInput, handler: (c) => ({ label: c.tx((s) => patchLabel(s, c.params.id as string, c.body)) }) });
  api({ method: 'DELETE', url: '/labels/:id', summary: 'Delete a label', tag: 'labels', handler: (c) => { c.tx((s) => deleteLabel(s, c.params.id as string)); return { ok: true }; } });

  // ====================== Saved filters ======================
  const evalSaved = (userId: string, tz: string, ast: FilterNode, sort: string, includeAll: boolean) => {
    const T = schema.tasks;
    const rows = ctx.db.select().from(T).where(and(eq(T.ownerUserId, userId), isNull(T.deletedAt))).all();
    const tasks = hydrateTasks(ctx.db, rows).filter((t) => t.status !== 'archived' && (includeAll || t.status === 'open'));
    const projects = ctx.db.select().from(schema.projects).where(eq(schema.projects.ownerUserId, userId)).all();
    const labels = ctx.db.select().from(schema.labels).where(eq(schema.labels.ownerUserId, userId)).all();
    const fctx = {
      today: todayLocal(tz),
      projectDescendants: (id: string) => descendantsOf(id, projects),
      labelNameToId: (name: string) => labels.find((l) => l.nameLower === name.toLowerCase())?.id,
    };
    const mentionsStatus = JSON.stringify(ast).includes('"status"');
    return tasks.filter((t) => (mentionsStatus || t.status === 'open') && evalFilter(ast, t, fctx)).sort(compareTasks(sort as 'position'));
  };
  api({ method: 'GET', url: '/saved-filters', summary: 'List saved filters', tag: 'filters', handler: (c) => ({ items: ctx.db.select().from(schema.savedFilters).where(eq(schema.savedFilters.ownerUserId, c.user.id)).all().map(filterToDTO) }) });
  api({ method: 'POST', url: '/saved-filters', summary: 'Create a saved filter (JSON AST, never SQL)', tag: 'filters', body: savedFilterInput, handler: (c) => { c.reply.code(201); return { filter: c.tx((s) => createFilter(s, c.body)) }; } });
  api({ method: 'PATCH', url: '/saved-filters/:id', summary: 'Update a saved filter', tag: 'filters', body: savedFilterInput.partial(), handler: (c) => ({ filter: c.tx((s) => patchFilter(s, c.params.id as string, c.body)) }) });
  api({ method: 'DELETE', url: '/saved-filters/:id', summary: 'Delete a saved filter', tag: 'filters', handler: (c) => { c.tx((s) => deleteFilter(s, c.params.id as string)); return { ok: true }; } });
  api({
    method: 'GET', url: '/saved-filters/:id/tasks', summary: 'Tasks matching a saved filter', tag: 'filters',
    handler: (c) => {
      const f = ctx.db.select().from(schema.savedFilters).where(and(eq(schema.savedFilters.id, c.params.id as string), eq(schema.savedFilters.ownerUserId, c.user.id))).get();
      if (!f) throw notFound('Filter');
      const dto = filterToDTO(f);
      const items = evalSaved(c.user.id, c.user.timezone, dto.ast, dto.sort, false);
      return { filter: dto, items, total: items.length };
    },
  });
  api({
    method: 'POST', url: '/filters/evaluate', summary: 'Preview a filter AST without saving', tag: 'filters',
    body: z.object({ ast: filterNodeSchema, sort: z.enum(['position', 'due', 'priority', 'created', 'title']).default('position') }),
    handler: (c) => {
      const items = evalSaved(c.user.id, c.user.timezone, c.body.ast, c.body.sort, false);
      return { items: items.slice(0, 200), total: items.length };
    },
  });

  // ====================== Templates ======================
  api({
    method: 'GET', url: '/templates', summary: 'List templates', tag: 'templates',
    handler: (c) => ({ items: ctx.db.select().from(schema.templates).all().filter((t) => t.ownerUserId === null || t.ownerUserId === c.user.id).map(templateToDTO) }),
  });
  api({ method: 'POST', url: '/templates', summary: 'Create a template', tag: 'templates', body: templateInput, handler: (c) => { c.reply.code(201); return { template: c.tx((s) => createTemplate(s, c.body)) }; } });
  api({
    method: 'PATCH', url: '/templates/:id', summary: 'Edit a template', tag: 'templates',
    body: z.object({ name: z.string().trim().min(1).max(100).optional(), description: z.string().max(500).optional(), body: templateBodySchema.optional() }),
    handler: (c) => ({ template: c.tx((s) => patchTemplate(s, c.params.id as string, c.body)) }),
  });
  api({ method: 'DELETE', url: '/templates/:id', summary: 'Delete a template', tag: 'templates', handler: (c) => { c.tx((s) => deleteTemplate(s, c.params.id as string)); return { ok: true }; } });
  api({
    method: 'POST', url: '/templates/:id/apply', summary: 'Preview (dryRun) or apply a template; idempotent with Idempotency-Key', tag: 'templates', body: templateApplyInput,
    handler: (c) => {
      const row = ctx.db.select().from(schema.templates).where(eq(schema.templates.id, c.params.id as string)).get();
      if (!row || (row.ownerUserId !== null && row.ownerUserId !== c.user.id)) throw notFound('Template');
      const t = templateToDTO(row);
      if (c.body.dryRun) return { preview: previewTemplate(t.body, t.kind, c.body.projectName) };
      const r = c.tx((s) => applyTemplate(s, t.id, c.body));
      c.reply.code(201);
      return { projectId: r.projectId, taskCount: r.taskIds.length };
    },
  });

  // ====================== Views / search / activity / reports ======================
  api({ method: 'GET', url: '/views/inbox', summary: 'Inbox (tasks without a project)', tag: 'views', handler: (c) => viewInbox(ctx.db, c.user.id) });
  api({
    method: 'GET', url: '/views/today', summary: 'Today agenda: overdue, due today, events', tag: 'views', query: z.object({ date: dateStr.optional() }),
    handler: (c) => {
      const date = c.query.date ?? todayLocal(c.user.timezone);
      touchCalendarView(ctx, c.user.id, { start: date, end: date });
      return viewToday(ctx, c.user, date);
    },
  });
  api({
    method: 'GET', url: '/views/upcoming', summary: 'Upcoming agenda for a date range', tag: 'views',
    query: z.object({ start: dateStr, end: dateStr, includeRecurring: z.enum(['true', 'false']).optional().transform((v) => v !== 'false') }),
    handler: (c) => {
      touchCalendarView(ctx, c.user.id, c.query);
      return viewUpcoming(ctx, c.user, c.query.start, c.query.end, c.query.includeRecurring);
    },
  });
  api({
    method: 'GET', url: '/views/calendar', summary: 'Unified calendar items (tasks + read-only events)', tag: 'views',
    query: z.object({ start: dateStr, end: dateStr, calendarIds: csvIds }),
    handler: (c) => {
      touchCalendarView(ctx, c.user.id, c.query);
      return viewCalendar(ctx, c.user, c.query.start, c.query.end, c.query.calendarIds);
    },
  });
  api({
    method: 'GET', url: '/search', summary: 'Full-text search across tasks, projects, labels', tag: 'views',
    query: z.object({ q: z.string().trim().min(1).max(200), includeCompleted: z.enum(['true', 'false']).optional().transform((v) => v === 'true'), limit: num(30, 1, 100), offset: num(0, 0, 100000) }),
    rateLimit: { max: 120, timeWindow: '1 minute' },
    handler: (c) => search(ctx.db, c.user.id, c.query.q, c.query.includeCompleted, c.query.limit, c.query.offset),
  });
  api({
    method: 'GET', url: '/activity', summary: 'Activity feed (append-only journal)', tag: 'reports',
    query: z.object({ projectId: z.string().optional(), action: z.string().max(40).optional(), from: z.string().optional(), to: z.string().optional(), before: z.string().optional(), limit: num(50, 1, 200) }),
    handler: (c) => activityList(ctx.db, c.user.id, c.query),
  });
  api({
    method: 'GET', url: '/reports/summary', summary: 'Completion stats for a date range', tag: 'reports', query: z.object({ from: dateStr, to: dateStr }),
    handler: (c) => reportSummary(ctx.db, c.user, c.query.from, c.query.to),
  });
}

export { localDateOf };
