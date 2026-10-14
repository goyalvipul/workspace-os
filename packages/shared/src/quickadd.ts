import { addDays, parseDate, fmtDate, startOfWeek, weekdayOf, isValidDateStr } from './dates.js';
import { weeklyRule } from './recurrence.js';

// Natural-language Quick Add parsing (English). Only UNAMBIGUOUS patterns are recognised.
// Each recognised span becomes a token (chip). Text is never silently dropped: callers decide
// per-token whether to strip the matched text from the title (token.text/start/end are exact).

export type TokenKind = 'date' | 'time' | 'priority' | 'project' | 'label' | 'recurrence';

export interface QuickAddToken {
  kind: TokenKind;
  start: number;
  end: number;
  text: string;
  label: string; // human readable interpretation
  value: Record<string, unknown>;
}

export interface QuickAddContext {
  today: string;
  projects: { id: string; name: string }[];
  labels: { id: string; name: string }[];
}

export interface QuickAddResult {
  tokens: QuickAddToken[];
  dueDate: string | null;
  dueTime: string | null;
  priority: number | null;
  projectId: string | null;
  labelNames: string[];
  recurrenceRule: string | null;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function nextWeekday(today: string, target: number, forceNextWeek = false): string {
  const wd = weekdayOf(today);
  let diff = (target - wd + 7) % 7;
  if (diff === 0) diff = 7;
  if (forceNextWeek && diff < 7 && target > wd) {
    // "next friday" on a Wednesday -> following week's Friday only if the user typed 'next'
    diff += 7;
  }
  return addDays(today, diff);
}

interface Match {
  start: number;
  end: number;
}

function find(input: string, re: RegExp): (RegExpExecArray & Match) | null {
  const m = re.exec(input);
  if (!m) return null;
  const lead = m[1] ?? '';
  const start = m.index + lead.length;
  return Object.assign(m, { start, end: m.index + m[0].length });
}

const B = '(^|\\s)'; // boundary before
const A = '(?=$|[\\s,.;!?])'; // boundary after

export function parseQuickAdd(input: string, ctx: QuickAddContext): QuickAddResult {
  const tokens: QuickAddToken[] = [];
  const taken: Match[] = [];
  const overlaps = (s: number, e: number) => taken.some((t) => s < t.end && e > t.start);
  const add = (t: QuickAddToken) => {
    if (overlaps(t.start, t.end)) return false;
    tokens.push(t);
    taken.push({ start: t.start, end: t.end });
    return true;
  };

  // Priority: p1..p4
  {
    const re = new RegExp(`${B}(p([1-4]))${A}`, 'i');
    const m = find(input, re);
    if (m) add({ kind: 'priority', start: m.start, end: m.end, text: m[2] as string, label: `Priority ${m[3]}`, value: { priority: Number(m[3]) } });
  }

  // Project: #Name (longest known name first, multi-word allowed)
  {
    const lower = input.toLowerCase();
    const sorted = [...ctx.projects].sort((a, b) => b.name.length - a.name.length);
    for (let i = 0; i < input.length; i++) {
      if (input[i] !== '#' || (i > 0 && !/\s/.test(input[i - 1] as string))) continue;
      const hit = sorted.find((p) => {
        const name = p.name.toLowerCase();
        if (!lower.startsWith(name, i + 1)) return false;
        const after = lower[i + 1 + name.length];
        return after === undefined || /[\s,.;!?]/.test(after);
      });
      if (hit) {
        add({ kind: 'project', start: i, end: i + 1 + hit.name.length, text: input.slice(i, i + 1 + hit.name.length), label: hit.name, value: { projectId: hit.id } });
        break;
      }
    }
  }

  // Labels: @label
  {
    const re = /(^|\s)(@([^\s@#,.;!?]+))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(input))) {
      const start = m.index + (m[1] ?? '').length;
      const name = m[3] as string;
      const existing = ctx.labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
      add({ kind: 'label', start, end: start + (m[2] as string).length, text: m[2] as string, label: existing ? existing.name : `${name} (new)`, value: { name: existing ? existing.name : name, labelId: existing?.id ?? null } });
    }
  }

  // Recurrence
  {
    const dayList = WEEKDAYS.join('|');
    const patterns: [RegExp, (m: RegExpExecArray) => { rule: string; label: string } | null][] = [
      [new RegExp(`${B}(every\\s+weekdays?)${A}`, 'i'), () => ({ rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', label: 'Every weekday' })],
      [new RegExp(`${B}(every\\s+day|daily)${A}`, 'i'), () => ({ rule: 'FREQ=DAILY', label: 'Every day' })],
      [new RegExp(`${B}(every\\s+week|weekly)${A}`, 'i'), () => ({ rule: 'FREQ=WEEKLY', label: 'Every week' })],
      [new RegExp(`${B}(every\\s+month|monthly)${A}`, 'i'), () => ({ rule: 'FREQ=MONTHLY', label: 'Every month' })],
      [new RegExp(`${B}(every\\s+year|yearly|annually)${A}`, 'i'), () => ({ rule: 'FREQ=YEARLY', label: 'Every year' })],
      [new RegExp(`${B}(every\\s+(\\d{1,2})\\s+(day|week|month|year)s?)${A}`, 'i'), (m) => {
        const n = Number(m[3]);
        if (n < 1) return null;
        const freq = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }[(m[4] as string).toLowerCase()] as string;
        return { rule: `FREQ=${freq};INTERVAL=${n}`, label: `Every ${n} ${(m[4] as string).toLowerCase()}s` };
      }],
      [new RegExp(`${B}(every\\s+((?:${dayList})(?:\\s*(?:,|and)\\s*(?:${dayList}))*))${A}`, 'i'), (m) => {
        const days = (m[3] as string).toLowerCase().split(/\s*(?:,|and)\s*/).map((d) => WEEKDAYS.indexOf(d.trim())).filter((d) => d >= 0);
        if (!days.length) return null;
        return { rule: weeklyRule(days), label: `Every ${days.map((d) => (WEEKDAYS[d] as string).replace(/^./, (c) => c.toUpperCase())).join(', ')}` };
      }],
    ];
    for (const [re, build] of patterns) {
      const m = find(input, re);
      if (!m) continue;
      const out = build(m);
      if (out && add({ kind: 'recurrence', start: m.start, end: m.end, text: m[2] as string, label: out.label, value: { rule: out.rule } })) break;
    }
  }

  // Time: "at 3pm", "3pm", "3:30 pm", "15:00"
  {
    const re12 = new RegExp(`${B}((?:at\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s?(am|pm))${A}`, 'i');
    const re24 = new RegExp(`${B}((?:at\\s+)?([01]?\\d|2[0-3]):([0-5]\\d))${A}`, 'i');
    const m12 = find(input, re12);
    let done = false;
    if (m12) {
      let h = Number(m12[3]);
      const min = Number(m12[4] ?? 0);
      const pm = (m12[5] as string).toLowerCase() === 'pm';
      if (h >= 1 && h <= 12 && min < 60) {
        if (h === 12) h = pm ? 12 : 0;
        else if (pm) h += 12;
        const time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        done = add({ kind: 'time', start: m12.start, end: m12.end, text: m12[2] as string, label: time, value: { time } });
      }
    }
    if (!done) {
      const m24 = find(input, re24);
      if (m24) {
        const time = `${String(Number(m24[3])).padStart(2, '0')}:${m24[4]}`;
        add({ kind: 'time', start: m24.start, end: m24.end, text: m24[2] as string, label: time, value: { time } });
      }
    }
  }

  // Dates
  {
    const today = ctx.today;
    const dayList = WEEKDAYS.join('|');
    const monthList = [...MONTHS, ...MONTH_ABBR.filter((m) => m !== 'may')].join('|');
    const tries: [RegExp, (m: RegExpExecArray) => string | null][] = [
      [new RegExp(`${B}(today)${A}`, 'i'), () => today],
      [new RegExp(`${B}(tomorrow|tmrw)${A}`, 'i'), () => addDays(today, 1)],
      [new RegExp(`${B}(next\\s+week)${A}`, 'i'), () => addDays(startOfWeek(today, 1), 7)],
      [new RegExp(`${B}(in\\s+(\\d{1,3})\\s+(day|week)s?)${A}`, 'i'), (m) => addDays(today, Number(m[3]) * ((m[4] as string).toLowerCase() === 'week' ? 7 : 1))],
      [new RegExp(`${B}(next\\s+(${dayList}))${A}`, 'i'), (m) => nextWeekday(today, WEEKDAYS.indexOf((m[3] as string).toLowerCase()), true)],
      [new RegExp(`${B}(${dayList})${A}`, 'i'), (m) => nextWeekday(today, WEEKDAYS.indexOf((m[2] as string).toLowerCase()))],
      [new RegExp(`${B}(\\d{4}-\\d{2}-\\d{2})${A}`), (m) => (isValidDateStr(m[2] as string) ? (m[2] as string) : null)],
      [new RegExp(`${B}((${monthList})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?)${A}`, 'i'), (m) => {
        const name = (m[3] as string).toLowerCase().replace('.', '');
        const idx = MONTHS.findIndex((x) => x === name || x.startsWith(name));
        const day = Number(m[4]);
        if (idx < 0) return null;
        const t = parseDate(today);
        let y = t.y;
        let cand = fmtDate(y, idx + 1, day);
        if (!isValidDateStr(cand)) return null;
        if (cand < today) {
          y += 1;
          cand = fmtDate(y, idx + 1, day);
          if (!isValidDateStr(cand)) return null;
        }
        return cand;
      }],
    ];
    for (const [re, build] of tries) {
      const m = find(input, re);
      if (!m) continue;
      const date = build(m);
      if (date && add({ kind: 'date', start: m.start, end: m.end, text: m[2] as string, label: date, value: { date } })) break;
    }
  }

  tokens.sort((a, b) => a.start - b.start);
  const first = <T>(kind: TokenKind, key: string): T | null => (tokens.find((t) => t.kind === kind)?.value[key] as T | undefined) ?? null;
  return {
    tokens,
    dueDate: first<string>('date', 'date'),
    dueTime: first<string>('time', 'time'),
    priority: first<number>('priority', 'priority'),
    projectId: first<string>('project', 'projectId'),
    labelNames: tokens.filter((t) => t.kind === 'label').map((t) => t.value.name as string),
    recurrenceRule: first<string>('recurrence', 'rule'),
  };
}

/** Remove selected tokens from the text and normalise whitespace. */
export function stripTokens(input: string, tokens: QuickAddToken[]): string {
  const sorted = [...tokens].sort((a, b) => b.start - a.start);
  let out = input;
  for (const t of sorted) out = out.slice(0, t.start) + out.slice(t.end);
  return out.replace(/\s{2,}/g, ' ').trim();
}
