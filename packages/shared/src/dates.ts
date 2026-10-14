import { TZDate } from '@date-fns/tz';

// Date-only values are plain 'YYYY-MM-DD' strings in the owner's local calendar.
// They are never converted to UTC midnight. Timed values are UTC ISO + an IANA timezone.

export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidDateStr(s: string): boolean {
  if (!DATE_REGEX.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

export function fmtDate(y: number, m: number, d: number): string {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

export function parseDate(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return { y, m, d };
}

/** Local calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function localDateOf(instant: Date | string | number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function localTimeOf(instant: Date | string | number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(instant));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const h = get('hour') === '24' ? '00' : get('hour');
  return `${h}:${get('minute')}`;
}

export function todayLocal(tz: string, now: Date | number = new Date()): string {
  return localDateOf(now, tz);
}

export function addDays(date: string, n: number): string {
  const { y, m, d } = parseDate(date);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return fmtDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addMonthsClamped(date: string, n: number): string {
  const { y, m, d } = parseDate(date);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fmtDate(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function diffDays(a: string, b: string): number {
  const pa = parseDate(a);
  const pb = parseDate(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/** 0 = Sunday .. 6 = Saturday */
export function weekdayOf(date: string): number {
  const { y, m, d } = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function startOfWeek(date: string, weekStartsOn: 0 | 1): string {
  const wd = weekdayOf(date);
  const diff = (wd - weekStartsOn + 7) % 7;
  return addDays(date, -diff);
}

export function startOfMonth(date: string): string {
  const { y, m } = parseDate(date);
  return fmtDate(y, m, 1);
}

export function endOfMonth(date: string): string {
  const { y, m } = parseDate(date);
  return fmtDate(y, m, daysInMonth(y, m));
}

export function rangeDays(start: string, endInclusive: string): string[] {
  const out: string[] = [];
  let cur = start;
  let guard = 0;
  while (cur <= endInclusive && guard++ < 800) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/** Convert local wall-clock date+time in tz to a UTC instant. DST-safe via TZDate. */
export function localToUtc(date: string, time: string, tz: string): Date {
  const { y, m, d } = parseDate(date);
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const tzd = new TZDate(y, m - 1, d, hh, mm, 0, tz);
  return new Date(tzd.getTime());
}

export interface DueInput {
  date: string;
  time?: string | null;
  timezone: string;
}

/** Build the persisted due fields from picker values. */
export function buildDue(input: DueInput): { dueDate: string; dueAtUtc: string | null; dueTimezone: string } {
  if (input.time) {
    const utc = localToUtc(input.date, input.time, input.timezone);
    return { dueDate: localDateOf(utc, input.timezone), dueAtUtc: utc.toISOString(), dueTimezone: input.timezone };
  }
  return { dueDate: input.date, dueAtUtc: null, dueTimezone: input.timezone };
}

export function formatTime(time: string, hour12: boolean): string {
  const [h, m] = time.split(':').map(Number) as [number, number];
  if (!hour12) return `${pad(h)}:${pad(m)}`;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${pad(m)} ${suffix}`;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_NAMES = WEEKDAYS;

export function formatDateLabel(date: string, today: string): string {
  const diff = diffDays(today, date);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const { y, m, d } = parseDate(date);
  const wd = WEEKDAYS[weekdayOf(date)] as string;
  if (diff > 1 && diff < 7) return wd;
  const base = `${MONTHS_SHORT[m - 1]} ${d}`;
  return parseDate(today).y === y ? base : `${base} ${y}`;
}

export function formatLongDate(date: string): string {
  const { m, d } = parseDate(date);
  return `${MONTHS_SHORT[m - 1]} ${d} \u00b7 ${WEEKDAYS[weekdayOf(date)]}`;
}

export function monthName(m: number): string {
  return MONTHS_SHORT[m - 1] as string;
}
