import { buildDue, diffDays, formatLongDate, localTimeOf, parseDate, WEEKDAY_NAMES, weekdayOf, monthName, type CalendarEventDTO, type TaskDTO } from '@wos/shared';
import { actions } from './store';

/** "Oct 14 · Today · Wednesday" style heading (matches the reference app's agenda headers). */
export function dayHeading(date: string, today: string): string {
  const diff = diffDays(today, date);
  const { m, d } = parseDate(date);
  const wd = WEEKDAY_NAMES[weekdayOf(date)];
  if (diff === 0) return `${monthName(m)} ${d} \u00b7 Today \u00b7 ${wd}`;
  if (diff === 1) return `${monthName(m)} ${d} \u00b7 Tomorrow \u00b7 ${wd}`;
  if (diff === -1) return `${monthName(m)} ${d} \u00b7 Yesterday \u00b7 ${wd}`;
  return formatLongDate(date);
}

/** Moves a task's due date to `date`, keeping its time-of-day. */
export function rescheduleTask(t: TaskDTO, date: string, tz: string): void {
  const zone = t.dueTimezone ?? tz;
  const time = t.dueAtUtc ? localTimeOf(t.dueAtUtc, zone) : null;
  const d = buildDue({ date, time, timezone: zone });
  actions.updateTask(t.id, t.dueDate ? { dueDate: d.dueDate, dueAtUtc: d.dueAtUtc, dueTimezone: d.dueTimezone } : { scheduledDate: date });
}

export interface DayBucket {
  tasks: TaskDTO[];
  events: CalendarEventDTO[];
}
