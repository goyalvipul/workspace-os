import { addDays } from './dates.js';
import { isOverdue } from './filters.js';
import { expandOccurrences } from './recurrence.js';
import type { TaskDTO } from './schemas.js';

// Pure view selectors shared by the server (/views/*) and the offline-capable client.

/**
 * The date a task should appear on in agendas, relative to `today`:
 *  nearest of scheduledDate / dueDate that is today or later. Overdue tasks return null here.
 */
export function agendaDate(t: Pick<TaskDTO, 'dueDate' | 'scheduledDate'>, today: string): string | null {
  const c = [t.scheduledDate, t.dueDate].filter((d): d is string => !!d && d >= today);
  if (!c.length) return null;
  return c.sort()[0] as string;
}

export function sortByPosition<T extends { position: string; createdAt: string }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => a.position.localeCompare(b.position) || a.createdAt.localeCompare(b.createdAt));
}

export function taskTime(t: TaskDTO): string | null {
  return t.dueAtUtc ?? t.scheduledAtUtc;
}

export function compareTasks(sort: 'position' | 'due' | 'priority' | 'created' | 'title' | 'time') {
  return (a: TaskDTO, b: TaskDTO): number => {
    switch (sort) {
      case 'priority':
        return a.priority - b.priority || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.position.localeCompare(b.position);
      case 'due':
        return (a.dueAtUtc ?? a.dueDate ?? '9999').localeCompare(b.dueAtUtc ?? b.dueDate ?? '9999') || a.priority - b.priority;
      case 'time':
        return (taskTime(a) ?? '9').localeCompare(taskTime(b) ?? '9') || a.priority - b.priority || a.position.localeCompare(b.position);
      case 'created':
        return b.createdAt.localeCompare(a.createdAt);
      case 'title':
        return a.title.localeCompare(b.title);
      default:
        return a.position.localeCompare(b.position) || a.createdAt.localeCompare(b.createdAt);
    }
  };
}

export function isLive(t: TaskDTO): boolean {
  return !t.deletedAt && t.status !== 'archived';
}

export function selectInbox(tasks: TaskDTO[]): TaskDTO[] {
  return sortByPosition(tasks.filter((t) => isLive(t) && t.status === 'open' && t.projectId === null && t.parentTaskId === null));
}

export interface TodayView {
  date: string;
  overdue: TaskDTO[];
  dueToday: TaskDTO[];
  completedToday: TaskDTO[];
}

export function selectToday(tasks: TaskDTO[], today: string, tz: string, localDateOf: (iso: string, tz: string) => string): TodayView {
  const live = tasks.filter(isLive);
  const open = live.filter((t) => t.status === 'open');
  const overdue = open.filter((t) => isOverdue(t, today));
  const dueToday = open.filter((t) => !isOverdue(t, today) && agendaDate(t, today) === today);
  const completedToday = live.filter((t) => t.status === 'completed' && t.completedAt && localDateOf(t.completedAt, tz) === today);
  return { date: today, overdue, dueToday, completedToday };
}

export interface AgendaItem {
  date: string;
  task: TaskDTO;
  virtual: boolean;
}

/** Day-grouped upcoming tasks in [start,end], optionally projecting future occurrences of recurring tasks. */
export function selectUpcoming(tasks: TaskDTO[], start: string, end: string, today: string, includeVirtual = true): AgendaItem[] {
  const out: AgendaItem[] = [];
  for (const t of tasks) {
    if (!isLive(t) || t.status !== 'open') continue;
    const d = agendaDate(t, today);
    if (d && d >= start && d <= end) out.push({ date: d, task: t, virtual: false });
    if (includeVirtual && t.recurrence && (t.dueDate || t.scheduledDate)) {
      const anchorDate = (t.dueDate ?? t.scheduledDate) as string;
      // Virtual (projected) occurrences are date-level markers only.
      const occ = expandOccurrences({ rule: t.recurrence.rule, mode: t.recurrence.mode }, { date: anchorDate, time: null }, addDays(start, 0), end, 60);
      for (const o of occ) if (o.date > anchorDate) out.push({ date: o.date, task: t, virtual: true });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || compareTasks('time')(a.task, b.task));
}

export function descendantsOf(projectId: string, projects: { id: string; parentProjectId: string | null }[]): string[] {
  const out = [projectId];
  const queue = [projectId];
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const p of projects) if (p.parentProjectId === cur && !out.includes(p.id)) { out.push(p.id); queue.push(p.id); }
  }
  return out;
}

/** Position keys: zero-padded integers with gaps; renormalised on reorder. */
export const POSITION_STEP = 1000;
export function positionKey(n: number): string {
  return String(Math.max(0, Math.round(n))).padStart(10, '0');
}
export function positionAfter(last: string | null | undefined): string {
  return positionKey(last ? Number(last) + POSITION_STEP : POSITION_STEP);
}
