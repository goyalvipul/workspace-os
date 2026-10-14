import { and, desc, eq, gte, inArray, isNull, like, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  addDays,
  agendaDate,
  compareTasks,
  diffDays,
  isOverdue,
  localDateOf,
  rangeDays,
  selectToday,
  selectUpcoming,
  type CalendarEventDTO,
  type TaskDTO,
} from '@wos/shared';
import type { AppContext } from '../context.js';
import { schema, type Db, type Tx } from '../db/client.js';
import { queryEvents } from '../calendar/store.js';
import { activityToDTO, filterToDTO, hydrateTasks, labelToDTO, projectToDTO, sectionToDTO, templateToDTO } from './mappers.js';
import { getPreferences, } from './workspace.js';
import { queryTasks } from './tasks.js';
import { nowIso } from '../util.js';
import type { UserRow } from './auth.js';
import { userToDTO } from './mappers.js';

type Q = Db | Tx;

export function snapshot(ctx: AppContext, user: UserRow, since?: string) {
  const db = ctx.db;
  const T = schema.tasks;
  const serverTime = nowIso();
  const cutoff = new Date(Date.now() - 45 * 86_400_000).toISOString();
  const base = and(eq(T.ownerUserId, user.id));
  const where: SQL = since
    ? (and(base, sql`${T.updatedAt} >= ${since}`) as SQL)
    : (and(base, isNull(T.deletedAt), or(eq(T.status, 'open'), and(eq(T.status, 'completed'), gte(T.completedAt, cutoff)))) as SQL);
  const rows = db.select().from(T).where(where).all();
  const tasks = hydrateTasks(db, rows);
  const lastSeq = db.select({ m: sql<number>`coalesce(max(seq), 0)` }).from(schema.appEvents).where(eq(schema.appEvents.ownerUserId, user.id)).get()?.m ?? 0;
  return {
    serverTime,
    since: since ?? null,
    full: !since,
    lastEventSeq: lastSeq,
    user: userToDTO(user),
    tasks,
    projects: db.select().from(schema.projects).where(eq(schema.projects.ownerUserId, user.id)).orderBy(schema.projects.sortOrder).all().map(projectToDTO),
    sections: db
      .select({ s: schema.sections })
      .from(schema.sections)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.sections.projectId))
      .where(eq(schema.projects.ownerUserId, user.id))
      .orderBy(schema.sections.sortOrder)
      .all()
      .map((r) => sectionToDTO(r.s)),
    labels: db.select().from(schema.labels).where(eq(schema.labels.ownerUserId, user.id)).orderBy(schema.labels.sortOrder).all().map(labelToDTO),
    filters: db.select().from(schema.savedFilters).where(eq(schema.savedFilters.ownerUserId, user.id)).all().map(filterToDTO),
    templates: db
      .select()
      .from(schema.templates)
      .where(or(isNull(schema.templates.ownerUserId), eq(schema.templates.ownerUserId, user.id)))
      .all()
      .map(templateToDTO),
    preferences: getPreferences(db, user.id),
  };
}

export interface ViewItem {
  kind: 'task' | 'event';
  id: string;
  date: string;
  dateRange: { start: string; end: string };
  task?: TaskDTO;
  event?: CalendarEventDTO;
  virtual?: boolean;
  overdue?: boolean;
}

function allLiveTasks(db: Q, ownerId: string, includeCompleted: boolean): TaskDTO[] {
  const T = schema.tasks;
  const cutoff = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const rows = db
    .select()
    .from(T)
    .where(and(eq(T.ownerUserId, ownerId), isNull(T.deletedAt), includeCompleted ? or(eq(T.status, 'open'), and(eq(T.status, 'completed'), gte(T.completedAt, cutoff))) : eq(T.status, 'open')))
    .all();
  return hydrateTasks(db, rows);
}

export function viewInbox(db: Q, ownerId: string) {
  const { items, total } = queryTasks(db, ownerId, { projectId: 'inbox', sort: 'position', limit: 200 });
  return { count: total, tasks: items.filter((t) => !t.parentTaskId) };
}

export function viewToday(ctx: AppContext, user: UserRow, date: string) {
  const tz = user.timezone;
  const tasks = allLiveTasks(ctx.db, user.id, true);
  const v = selectToday(tasks, date, tz, localDateOf);
  const events = queryEvents(ctx, user, date, date, {});
  const items: ViewItem[] = [];
  for (const t of v.overdue) items.push({ kind: 'task', id: t.id, date: t.dueDate ?? t.scheduledDate ?? date, dateRange: { start: t.dueDate ?? date, end: t.dueDate ?? date }, task: t, overdue: true });
  for (const t of v.dueToday) items.push({ kind: 'task', id: t.id, date, dateRange: { start: date, end: date }, task: t });
  for (const e of events) items.push({ kind: 'event', id: e.id, date, dateRange: { start: e.startDate ?? date, end: e.endDateExclusive ? addDays(e.endDateExclusive, -1) : (e.startDate ?? date) }, event: e });
  return { date, overdue: v.overdue, dueToday: v.dueToday, completedToday: v.completedToday, events, items };
}

export function viewUpcoming(ctx: AppContext, user: UserRow, start: string, end: string, includeVirtual = true) {
  const today = localDateOf(new Date(), user.timezone);
  const tasks = allLiveTasks(ctx.db, user.id, false);
  const agenda = selectUpcoming(tasks, start, end, today, includeVirtual);
  const events = queryEvents(ctx, user, start, end, {});
  const items: ViewItem[] = agenda.map((a) => ({ kind: 'task', id: a.task.id, date: a.date, dateRange: { start: a.date, end: a.date }, task: a.task, virtual: a.virtual }));
  for (const e of events) {
    const first = e.startDate ?? start;
    const last = e.endDateExclusive ? addDays(e.endDateExclusive, -1) : first;
    for (const d of rangeDays(first < start ? start : first, last > end ? end : last)) {
      items.push({ kind: 'event', id: e.id, date: d, dateRange: { start: first, end: last }, event: e });
    }
  }
  const overdue = start <= today ? tasks.filter((t) => isOverdue(t, today)) : [];
  return { start, end, overdue, items: items.sort((a, b) => a.date.localeCompare(b.date)) };
}

export function viewCalendar(ctx: AppContext, user: UserRow, start: string, end: string, calendarIds?: string[]) {
  if (diffDays(start, end) > 400) throw new Error('Range too large');
  const today = localDateOf(new Date(), user.timezone);
  const tasks = allLiveTasks(ctx.db, user.id, false);
  const items: ViewItem[] = [];
  const seen = new Set<string>();
  for (const t of tasks) {
    const d = t.dueDate ?? t.scheduledDate;
    const ad = agendaDate(t, today) ?? (isOverdue(t, today) ? d : null);
    const date = ad ?? d;
    if (date && date >= start && date <= end && !seen.has(t.id)) {
      seen.add(t.id);
      items.push({ kind: 'task', id: t.id, date, dateRange: { start: date, end: date }, task: t });
    }
  }
  const events = queryEvents(ctx, user, start, end, { calendarIds });
  for (const e of events) {
    const first = e.startDate ?? start;
    const last = e.endDateExclusive ? addDays(e.endDateExclusive, -1) : first;
    items.push({ kind: 'event', id: e.id, date: first < start ? start : first, dateRange: { start: first, end: last }, event: e });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || (a.task ? compareTasks('time')(a.task, b.task as TaskDTO) : 0));
  return { start, end, items };
}

export function search(db: Q, ownerId: string, q: string, includeCompleted: boolean, limit: number, offset: number) {
  const tasks = queryTasks(db, ownerId, { q, includeCompleted, limit, offset, sort: 'position' });
  const term = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const projects = db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.ownerUserId, ownerId), sql`${schema.projects.name} LIKE ${term} ESCAPE '\\'`))
    .limit(20)
    .all()
    .map(projectToDTO);
  const labels = db
    .select()
    .from(schema.labels)
    .where(and(eq(schema.labels.ownerUserId, ownerId), sql`${schema.labels.name} LIKE ${term} ESCAPE '\\'`))
    .limit(20)
    .all()
    .map(labelToDTO);
  return { tasks: tasks.items, total: tasks.total, projects, labels };
}

export function activityList(
  db: Q,
  ownerId: string,
  f: { projectId?: string; action?: string; from?: string; to?: string; before?: string; limit: number },
) {
  const A = schema.activityEvents;
  const conds: SQL[] = [eq(A.ownerUserId, ownerId)];
  if (f.projectId) conds.push(eq(A.projectId, f.projectId));
  if (f.action) conds.push(like(A.action, `${f.action.replace(/[%_]/g, '')}%`));
  if (f.from) conds.push(gte(A.createdAt, f.from));
  if (f.to) conds.push(lte(A.createdAt, f.to));
  if (f.before) conds.push(lt(A.createdAt, f.before));
  const rows = db.select().from(A).where(and(...conds)).orderBy(desc(A.createdAt)).limit(f.limit + 1).all();
  const page = rows.slice(0, f.limit);
  const pids = [...new Set(page.map((r) => r.projectId).filter((x): x is string => !!x))];
  const projects = pids.length ? db.select().from(schema.projects).where(inArray(schema.projects.id, pids)).all() : [];
  const pm = new Map(projects.map((p) => [p.id, { name: p.name, color: p.color }]));
  return {
    items: page.map((r) => activityToDTO(r, r.projectId ? (pm.get(r.projectId) ?? null) : null)),
    nextBefore: rows.length > f.limit ? (page[page.length - 1]?.createdAt ?? null) : null,
  };
}

export function reportSummary(db: Q, user: UserRow, from: string, to: string) {
  const tz = user.timezone;
  const C = schema.taskCompletions;
  const startIso = new Date(`${addDays(from, -1)}T00:00:00Z`).toISOString();
  const endIso = new Date(`${addDays(to, 2)}T00:00:00Z`).toISOString();
  const rows = db
    .select({ c: C, projectId: schema.tasks.projectId })
    .from(C)
    .innerJoin(schema.tasks, eq(schema.tasks.id, C.taskId))
    .where(and(eq(C.ownerUserId, user.id), isNull(C.undoneAt), gte(C.completedAt, startIso), lt(C.completedAt, endIso)))
    .all();
  const perDay = new Map<string, number>();
  const perProject = new Map<string | null, number>();
  for (const r of rows) {
    const d = localDateOf(r.c.completedAt, tz);
    if (d < from || d > to) continue;
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
    perProject.set(r.projectId, (perProject.get(r.projectId) ?? 0) + 1);
  }
  const days = rangeDays(from, to).map((date) => ({ date, completed: perDay.get(date) ?? 0 }));
  const projects = db.select().from(schema.projects).where(eq(schema.projects.ownerUserId, user.id)).all();
  const today = localDateOf(new Date(), tz);
  const open = db.select().from(schema.tasks).where(and(eq(schema.tasks.ownerUserId, user.id), isNull(schema.tasks.deletedAt), eq(schema.tasks.status, 'open'))).all();
  const overdue = open.filter((t) => isOverdue({ status: 'open', dueDate: t.dueDate, scheduledDate: t.scheduledDate }, today)).length;

  // streak: consecutive local days (ending today or yesterday) with at least one completion
  const recent = db.select({ at: C.completedAt }).from(C).where(and(eq(C.ownerUserId, user.id), isNull(C.undoneAt), gte(C.completedAt, new Date(Date.now() - 400 * 86_400_000).toISOString()))).all();
  const doneDays = new Set(recent.map((r) => localDateOf(r.at, tz)));
  let streak = 0;
  let cursor = doneDays.has(today) ? today : addDays(today, -1);
  while (doneDays.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return {
    from,
    to,
    totalCompleted: days.reduce((a, d) => a + d.completed, 0),
    days,
    byProject: [...perProject.entries()].map(([id, count]) => ({ projectId: id, name: id ? (projects.find((p) => p.id === id)?.name ?? 'Deleted project') : 'Inbox', color: id ? (projects.find((p) => p.id === id)?.color ?? '#8b8d98') : '#8b8d98', completed: count })).sort((a, b) => b.completed - a.completed),
    overdue,
    openTasks: open.length,
    activeProjects: projects.filter((p) => !p.archivedAt).length,
    streakDays: streak,
  };
}
