import { and, eq, isNull } from 'drizzle-orm';
import { buildDue, parseQuickAdd, stripTokens, todayLocal, type TaskCreateInput, type TaskDTO } from '@wos/shared';
import type { AppContext } from '../context.js';
import { schema } from '../db/client.js';
import type { UserRow } from './auth.js';
import { viewToday } from './queries.js';
import { createTask, type Scope } from './tasks.js';
import { createLabel, getPreferences } from './workspace.js';

/**
 * Quick-capture used by Siri / Apple Shortcuts / Apple Watch. The text goes through the same natural-language parser as
 * Quick Add in the app ("buy milk tomorrow 5pm #Home @errand p2"), honouring the user's date preferences.
 */
export function captureTask(s: Scope, text: string): { task: TaskDTO; message: string } {
  const prefs = getPreferences(s.tx, s.ownerId);
  const now = new Date();
  const today = todayLocal(s.tz, now);
  const projects = s.tx.select({ id: schema.projects.id, name: schema.projects.name }).from(schema.projects).where(and(eq(schema.projects.ownerUserId, s.ownerId), isNull(schema.projects.archivedAt))).all();
  const labels = s.tx.select({ id: schema.labels.id, name: schema.labels.name }).from(schema.labels).where(eq(schema.labels.ownerUserId, s.ownerId)).all();

  const parsed = parseQuickAdd(text, { today, projects, labels, nextWeekStart: Number(prefs['dates.nextWeekStart'] ?? 1), weekendDay: Number(prefs['dates.weekendDay'] ?? 6) });
  const detect = prefs['dates.detect'] !== false;
  const used = parsed.tokens.filter((t) => detect || !['date', 'time', 'recurrence'].includes(t.kind));
  const title = stripTokens(text, used) || text.trim();

  const input: TaskCreateInput = { title: title.slice(0, 500) };
  if (parsed.projectId) input.projectId = parsed.projectId;
  const priority = used.some((t) => t.kind === 'priority') ? parsed.priority : null;
  if (priority) input.priority = priority as 1 | 2 | 3 | 4;

  const labelIds: string[] = [];
  for (const t of used.filter((x) => x.kind === 'label')) {
    const name = String(t.value.name ?? '');
    if (!name) continue;
    const existing = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
    labelIds.push(existing ? existing.id : createLabel(s, { name }).label.id);
  }
  if (labelIds.length) input.labelIds = labelIds;

  const dateUsed = detect ? parsed.dueDate : null;
  const timeUsed = detect ? parsed.dueTime : null;
  const rule = detect ? parsed.recurrenceRule : null;
  // Same rule as the app: a task dropped straight into a project lands on Today unless a date was given.
  const date = dateUsed ?? (timeUsed || rule || parsed.projectId ? today : null);
  if (date) {
    const due = buildDue({ date, time: timeUsed ?? null, timezone: s.tz });
    input.dueDate = due.dueDate;
    input.dueAtUtc = due.dueAtUtc;
    input.dueTimezone = due.dueTimezone;
  }
  if (rule) input.recurrence = { rule, mode: 'fixed', timezone: s.tz };
  if (timeUsed && prefs['reminders.auto'] !== 'none') {
    input.reminders = [{ kind: 'relative', offsetMinutes: Number(prefs['reminders.auto']), channel: prefs['reminders.via'] === 'inapp' ? 'inapp' : 'webpush', enabled: true }];
  }

  const { task } = createTask(s, input);
  const where = parsed.projectId ? (projects.find((p) => p.id === parsed.projectId)?.name ?? 'project') : 'Inbox';
  const when = task.dueDate ? (task.dueDate === today ? 'today' : task.dueDate) + (timeUsed ? ` at ${timeUsed}` : '') : '';
  return { task, message: `Added "${task.title}" to ${where}${when ? ` for ${when}` : ''}` };
}

export interface TodayLine {
  title: string;
  time: string | null;
  overdue: boolean;
  priority: number;
}

/** A compact, speakable list of what is due today (and overdue). */
export function todaySummary(ctx: AppContext, user: UserRow, limit = 25): { date: string; count: number; overdueCount: number; items: TodayLine[]; text: string } {
  const date = todayLocal(user.timezone);
  const v = viewToday(ctx, user, date);
  const mk = (t: TaskDTO, overdue: boolean): TodayLine => ({
    title: t.title,
    time: t.dueAtUtc ? new Date(t.dueAtUtc).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: t.dueTimezone ?? user.timezone, hour12: false }) : null,
    overdue,
    priority: t.priority,
  });
  const all = [...v.overdue.map((t) => mk(t, true)), ...v.dueToday.map((t) => mk(t, false))];
  const items = all.slice(0, limit);
  const text = all.length
    ? `You have ${all.length} task${all.length === 1 ? '' : 's'} today${v.overdue.length ? ` (${v.overdue.length} overdue)` : ''}.\n` + items.map((i, n) => `${n + 1}. ${i.title}${i.time ? ` at ${i.time}` : ''}${i.overdue ? ' (overdue)' : ''}`).join('\n')
    : 'Nothing due today. Enjoy your day.';
  return { date, count: all.length, overdueCount: v.overdue.length, items, text };
}
