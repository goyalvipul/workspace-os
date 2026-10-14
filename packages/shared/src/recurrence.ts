import { RRule, rrulestr } from 'rrule';
import { addDays, addMonthsClamped, daysInMonth, fmtDate, parseDate, weekdayOf } from './dates.js';

// Recurrence model:
//  - `rule` is an RFC 5545 RRULE body (no DTSTART), e.g. "FREQ=WEEKLY;BYDAY=MO,WE".
//  - Wall-clock arithmetic is done on "floating" UTC dates (local wall time stored as UTC),
//    then converted to a real instant elsewhere with the task's timezone. This keeps DST correct.
//  - mode 'fixed'            -> next occurrence is computed from the previous occurrence (calendar schedule).
//  - mode 'after_completion' -> next occurrence is computed from the completion date.

export type RecurrenceMode = 'fixed' | 'after_completion';

export interface Recurrence {
  rule: string;
  mode: RecurrenceMode;
  timezone?: string | null;
}

export interface LocalMoment {
  date: string; // YYYY-MM-DD
  time: string | null; // HH:mm or null (date-only)
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function toFloating(m: LocalMoment): Date {
  const { y, m: mo, d } = parseDate(m.date);
  const [hh, mm] = (m.time ?? '00:00').split(':').map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1, d, hh, mm, 0));
}

function fromFloating(dt: Date, hasTime: boolean): LocalMoment {
  const date = fmtDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  const time = hasTime
    ? `${String(dt.getUTCHours()).padStart(2, '0')}:${String(dt.getUTCMinutes()).padStart(2, '0')}`
    : null;
  return { date, time };
}

export function normalizeRule(rule: string): string {
  return rule.trim().replace(/^RRULE:/i, '').replace(/\s+/g, '').toUpperCase();
}

export function validateRule(rule: string): { ok: true } | { ok: false; error: string } {
  try {
    const opts = RRule.parseString(normalizeRule(rule));
    if (opts.freq === undefined || opts.freq === null) return { ok: false, error: 'Rule needs FREQ' };
    if (opts.freq === RRule.SECONDLY || opts.freq === RRule.MINUTELY || opts.freq === RRule.HOURLY) {
      return { ok: false, error: 'Sub-daily recurrence is not supported' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Invalid rule' };
  }
}

/** "Monthly on the 29-31st" must clamp to the month end rather than skip short months. */
function monthlyClampDay(rule: string): number | null {
  const parts = Object.fromEntries(normalizeRule(rule).split(';').map((p) => p.split('=') as [string, string]));
  if (parts.FREQ !== 'MONTHLY') return null;
  if (!parts.BYMONTHDAY || parts.BYMONTHDAY.includes(',')) return null;
  if (parts.BYDAY || parts.BYSETPOS || parts.BYMONTH) return null;
  const n = Number(parts.BYMONTHDAY);
  return n > 28 && n <= 31 ? n : null;
}

function monthlyInterval(rule: string): number {
  const m = /INTERVAL=(\d+)/.exec(normalizeRule(rule));
  return m ? Math.max(1, Number(m[1])) : 1;
}

function clampedMonthDate(date: string, monthsToAdd: number, day: number): string {
  const first = addMonthsClamped(date.slice(0, 8) + '01', monthsToAdd);
  const { y, m } = parseDate(first);
  return fmtDate(y, m, Math.min(day, daysInMonth(y, m)));
}

function buildRRule(rule: string, dtstart: Date): RRule {
  const opts = RRule.parseString(normalizeRule(rule));
  return new RRule({ ...opts, dtstart });
}

/**
 * Next occurrence strictly after `current` (fixed) or after `completedOn` (after_completion).
 * Returns null when the series is exhausted (COUNT/UNTIL).
 */
export function nextOccurrence(
  rec: Recurrence,
  current: LocalMoment,
  completedOn: LocalMoment,
): LocalMoment | null {
  const hasTime = current.time !== null;
  const base = rec.mode === 'after_completion' ? { date: completedOn.date, time: current.time } : current;

  const clamp = monthlyClampDay(rec.rule);
  if (clamp !== null) {
    const step = monthlyInterval(rec.rule);
    let months = 0;
    for (let i = 0; i < 60; i++) {
      months += step;
      const date = clampedMonthDate(base.date, months, clamp);
      if (date > base.date) return { date, time: base.time };
    }
    return null;
  }

  const rr = buildRRule(rec.rule, toFloating(base));
  const next = rr.after(toFloating(base), false);
  if (!next) return null;
  return fromFloating(next, hasTime);
}

/** Expand occurrences in [from, to] (inclusive local dates), starting from an anchor moment. */
export function expandOccurrences(
  rec: Recurrence,
  anchor: LocalMoment,
  from: string,
  to: string,
  limit = 200,
): LocalMoment[] {
  const hasTime = anchor.time !== null;
  const out: LocalMoment[] = [];
  const clamp = monthlyClampDay(rec.rule);
  if (clamp !== null) {
    const step = monthlyInterval(rec.rule);
    for (let i = 1; i < 600 && out.length < limit; i++) {
      const date = clampedMonthDate(anchor.date, i * step, clamp);
      if (date > to) break;
      if (date >= from) out.push({ date, time: anchor.time });
    }
    return out;
  }
  const rr = buildRRule(rec.rule, toFloating(anchor));
  const list = rr.between(toFloating({ date: addDays(from, -1), time: '23:59' }), toFloating({ date: addDays(to, 1), time: '00:00' }), true, (_d, i) => i < limit * 4);
  for (const d of list) {
    const m = fromFloating(d, hasTime);
    if (m.date >= from && m.date <= to && !(m.date === anchor.date && m.time === anchor.time)) out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}

export function occurrenceKey(rec: Recurrence | null, m: LocalMoment | null): string {
  if (!rec || !m) return 'once';
  return m.time ? `${m.date}T${m.time}` : m.date;
}

export interface RulePreset {
  label: string;
  rule: string;
}

export const RULE_PRESETS: RulePreset[] = [
  { label: 'Every day', rule: 'FREQ=DAILY' },
  { label: 'Every weekday', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { label: 'Every week', rule: 'FREQ=WEEKLY' },
  { label: 'Every 2 weeks', rule: 'FREQ=WEEKLY;INTERVAL=2' },
  { label: 'Every month', rule: 'FREQ=MONTHLY' },
  { label: 'Every year', rule: 'FREQ=YEARLY' },
];

export function weeklyRule(days: number[]): string {
  const codes = [...new Set(days)].sort((a, b) => a - b).map((d) => DAY_CODES[d]);
  return `FREQ=WEEKLY;BYDAY=${codes.join(',')}`;
}

export function describeRule(ruleInput: string): string {
  try {
    const rule = normalizeRule(ruleInput);
    const p = Object.fromEntries(rule.split(';').map((x) => x.split('=') as [string, string]));
    const interval = Number(p.INTERVAL ?? 1);
    const every = (unit: string, plural: string) => (interval === 1 ? `Every ${unit}` : `Every ${interval} ${plural}`);
    let text: string;
    switch (p.FREQ) {
      case 'DAILY':
        text = every('day', 'days');
        break;
      case 'WEEKLY': {
        if (p.BYDAY) {
          const days = p.BYDAY.split(',').map((c) => DAY_CODES.indexOf(c));
          if (days.length === 5 && !days.includes(0) && !days.includes(6)) text = 'Every weekday';
          else text = `${interval === 1 ? 'Every' : `Every ${interval} weeks on`} ${days.map((d) => DAY_NAMES[d] ?? '').join(', ')}`;
        } else text = every('week', 'weeks');
        break;
      }
      case 'MONTHLY':
        text = p.BYMONTHDAY ? `${every('month', 'months')} on day ${p.BYMONTHDAY}` : every('month', 'months');
        break;
      case 'YEARLY':
        text = every('year', 'years');
        break;
      default:
        text = rule;
    }
    return text;
  } catch {
    return ruleInput;
  }
}

/** Weekday helper re-exported for UI */
export function weekdayCode(date: string): string {
  return DAY_CODES[weekdayOf(date)] as string;
}

export { rrulestr };
