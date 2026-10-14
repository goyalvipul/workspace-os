import { describe, expect, it } from 'vitest';
import {
  BUILTIN_TEMPLATES,
  addDays,
  buildDue,
  compareTasks,
  evalFilter,
  expandOccurrences,
  isOverdue,
  localDateOf,
  localTimeOf,
  nextOccurrence,
  parseQuickAdd,
  selectToday,
  templateBodySchema,
  todayLocal,
  validateRule,
  type TaskDTO,
} from '@wos/shared';

const TZ = 'America/Vancouver';

function task(p: Partial<TaskDTO>): TaskDTO {
  return {
    id: '01HZZZZZZZZZZZZZZZZZZZZZZZ', projectId: null, sectionId: null, parentTaskId: null, title: 't', description: '', status: 'open', priority: 4,
    position: 'a', labelIds: [], scheduledDate: null, scheduledAtUtc: null, dueDate: null, dueAtUtc: null, dueTimezone: null, deadlineDate: null,
    estimateMinutes: null, recurrence: null, reminders: [], completedAt: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null, version: 1, ...p,
  } as unknown as TaskDTO;
}

describe('dates and time zones', () => {
  it('computes the local day in the owner time zone, not UTC', () => {
    expect(todayLocal(TZ, new Date('2026-10-15T03:00:00Z'))).toBe('2026-10-14');
    expect(localDateOf('2026-10-15T08:00:00Z', TZ)).toBe('2026-10-15');
  });
  it('keeps wall-clock times across DST changes', () => {
    // Property rather than hard-coded offsets: 09:00 local must stay 09:00 local on both sides of every transition,
    // even though the UTC instant moves by an hour.
    const days = ['2026-03-07', '2026-03-08', '2026-03-09', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'];
    const utc = days.map((d) => {
      const due = buildDue({ date: d, time: '09:00', timezone: TZ });
      expect(due.dueDate).toBe(d);
      expect(localTimeOf(due.dueAtUtc as string, TZ)).toBe('09:00');
      return Date.parse(due.dueAtUtc as string) % 86_400_000;
    });
    expect(new Set(utc).size).toBeGreaterThan(1); // the UTC time-of-day really does shift when DST changes
  });
  it('date-only values have no UTC instant', () => {
    expect(buildDue({ date: '2026-10-14', timezone: TZ }).dueAtUtc).toBeNull();
  });
  it('adds days across month ends', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('quick add parser', () => {
  const ctx = { today: '2026-10-14', projects: [{ id: 'P1', name: 'Home' }, { id: 'P2', name: 'Work Stuff' }], labels: [{ id: 'L1', name: 'errands' }] };
  it('parses date, time, priority, project and label tokens', () => {
    const r = parseQuickAdd('Buy milk tomorrow 5pm p1 #Home @errands', ctx);
    expect(r.dueDate).toBe('2026-10-15');
    expect(r.dueTime).toBe('17:00');
    expect(r.priority).toBe(1);
    expect(r.projectId).toBe('P1');
    expect(r.labelNames).toContain('errands');
  });
  it('detects recurrence', () => {
    const r = parseQuickAdd('Water plants every monday', ctx);
    expect(r.recurrenceRule).toMatch(/MO/);
  });
  it('leaves plain text alone', () => {
    const r = parseQuickAdd('Write the report', ctx);
    expect(r.dueDate).toBeNull();
    expect(r.priority).toBeNull();
  });
  it('"next week" and "weekend" follow the user settings (2026-10-14 is a Wednesday)', () => {
    expect(parseQuickAdd('plan next week', ctx).dueDate).toBe('2026-10-19'); // Monday by default
    expect(parseQuickAdd('plan next week', { ...ctx, nextWeekStart: 0 }).dueDate).toBe('2026-10-18'); // Sunday
    expect(parseQuickAdd('hike this weekend', ctx).dueDate).toBe('2026-10-17'); // Saturday by default
    expect(parseQuickAdd('hike weekend', { ...ctx, weekendDay: 0 }).dueDate).toBe('2026-10-18'); // Sunday
    expect(parseQuickAdd('hike weekend', { ...ctx, today: '2026-10-17' }).dueDate).toBe('2026-10-17'); // already Saturday
  });
});

describe('recurrence', () => {
  it('fixed schedules advance from the due date', () => {
    const n = nextOccurrence({ rule: 'FREQ=WEEKLY;BYDAY=MO', mode: 'fixed' }, { date: '2026-10-12', time: null }, { date: '2026-10-14', time: null });
    expect(n?.date).toBe('2026-10-19');
  });
  it('after-completion schedules advance from the completion day', () => {
    const n = nextOccurrence({ rule: 'FREQ=DAILY', mode: 'after_completion' }, { date: '2026-10-14', time: null }, { date: '2026-10-20', time: null });
    expect(n?.date).toBe('2026-10-21');
  });
  it('month-end rules clamp instead of skipping', () => {
    const n = nextOccurrence({ rule: 'FREQ=MONTHLY;BYMONTHDAY=31', mode: 'fixed' }, { date: '2026-01-31', time: null }, { date: '2026-01-31', time: null });
    expect(n?.date).toBe('2026-02-28');
  });
  it('rejects invalid rules and expands windows', () => {
    expect(validateRule('FREQ=NOPE').ok).toBe(false);
    const list = expandOccurrences({ rule: 'FREQ=DAILY', mode: 'fixed' }, { date: '2026-10-14', time: null }, '2026-10-14', '2026-10-20');
    expect(list.length).toBeGreaterThanOrEqual(6);
  });
});

describe('filters and views', () => {
  const today = '2026-10-14';
  const ctx = { today };
  it('evaluates and/or/not over fields', () => {
    const t = task({ priority: 1, dueDate: '2026-10-14', labelIds: ['L1'] });
    expect(evalFilter({ op: 'and', children: [{ field: 'priority', cmp: 'is', value: 1 }, { field: 'due', cmp: 'is', value: 'today' }] }, t, ctx)).toBe(true);
    expect(evalFilter({ op: 'not', child: { field: 'label', cmp: 'is', value: ['L1'] } }, t, ctx)).toBe(false);
    expect(evalFilter({ op: 'or', children: [{ field: 'priority', cmp: 'is', value: 3 }, { field: 'overdue', cmp: 'is', value: true }] }, t, ctx)).toBe(false);
  });
  it('treats unscheduled-but-past tasks as overdue only when open', () => {
    expect(isOverdue({ status: 'open', dueDate: '2026-10-13', scheduledDate: null }, today)).toBe(true);
    expect(isOverdue({ status: 'completed', dueDate: '2026-10-13', scheduledDate: null }, today)).toBe(false);
  });
  it('Today lists overdue and due-today tasks', () => {
    const view = selectToday([task({ id: 'A', dueDate: '2026-10-13' }), task({ id: 'B', dueDate: today }), task({ id: 'C', dueDate: '2026-10-20' })], today, TZ, localDateOf);
    expect(view.overdue.map((t) => t.id)).toEqual(['A']);
    expect(JSON.stringify(view)).toContain('"B"');
    expect(JSON.stringify(view.overdue)).not.toContain('"C"');
  });
  it('sorts by priority then due date', () => {
    const list = [task({ id: 'x', priority: 3 }), task({ id: 'y', priority: 1 })].sort(compareTasks('priority'));
    expect(list[0]?.id).toBe('y');
  });
});

describe('built-in templates', () => {
  it('all validate against the template schema', () => {
    expect(BUILTIN_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    for (const t of BUILTIN_TEMPLATES) expect(templateBodySchema.safeParse(t.body).success, t.key).toBe(true);
  });
});
