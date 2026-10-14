import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, RefreshCw, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays, endOfMonth, formatLongDate, monthName, parseDate, rangeDays, startOfMonth, startOfWeek, type CalendarEventDTO, type TaskDTO, WEEKDAY_NAMES, compareTasks } from '@wos/shared';
import { EventBlock } from '../components/EventRow';
import { PageHeader } from '../components/PageHeader';
import { TaskList, PRIORITY_COLOR } from '../components/TaskRow';
import { Button, Chip, IconButton, Segmented, Spinner, clsx } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import type { DayBucket } from '../lib/format';
import { eventDays, useCalendarEvents, useExternalCalendars, useToday, useTz, useWeekStart } from '../lib/hooks';
import { useAllTasks } from '../lib/selectors';
import { actions, toast, useStore } from '../lib/store';

type Bucket = { tasks: { task: TaskDTO; virtual: boolean }[] | TaskDTO[]; events: CalendarEventDTO[] };

const taskOf = (x: TaskDTO | { task: TaskDTO }): TaskDTO => ('task' in x ? x.task : x);

export function MonthGrid({ month, byDay, today, weekStart, selected, onSelect }: { month: string; byDay: Map<string, Bucket | DayBucket>; today: string; weekStart: 0 | 1; selected: string | null; onSelect: (d: string) => void }) {
  const first = startOfWeek(startOfMonth(month), weekStart);
  const last = addDays(startOfWeek(endOfMonth(month), weekStart), 6);
  const days = rangeDays(first, last);
  const heads = days.slice(0, 7).map((d) => WEEKDAY_NAMES[weekdayIdx(d)] as string);
  return (
    <div role="grid" aria-label={`${monthName(parseDate(month).m)} ${parseDate(month).y}`} className="overflow-hidden rounded-xl border border-line">
      <div role="row" className="grid grid-cols-7 border-b border-line bg-surface text-center text-xs text-muted">
        {heads.map((h) => (
          <span key={h} role="columnheader" className="py-1.5">
            {h.slice(0, 3)}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const b = byDay.get(d);
          const tasks = (b?.tasks ?? []).map(taskOf);
          const events = b?.events ?? [];
          const inMonth = d.slice(0, 7) === month.slice(0, 7);
          const total = tasks.length + events.length;
          return (
            <button
              key={d}
              role="gridcell"
              aria-label={`${formatLongDate(d)}: ${events.length} events, ${tasks.length} tasks`}
              aria-selected={selected === d}
              onClick={() => onSelect(d)}
              className={clsx('min-h-[64px] border-b border-r border-line p-1 text-left align-top hover:bg-surface md:min-h-[92px]', !inMonth && 'opacity-40', selected === d && 'bg-surface')}
            >
              <span className={clsx('mb-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs', d === today && 'bg-accent font-bold text-accent-fg')}>{parseDate(d).d}</span>
              <span className="hidden space-y-0.5 md:block">
                {events.slice(0, 2).map((e) => (
                  <span key={e.id} className="flex items-center gap-1 truncate rounded px-1 text-[11px]" style={{ background: `color-mix(in srgb, ${e.color} 22%, transparent)` }}>
                    {e.subject}
                  </span>
                ))}
                {tasks.slice(0, Math.max(0, 3 - Math.min(events.length, 2))).map((t) => (
                  <span key={t.id} className="flex items-center gap-1 truncate text-[11px]">
                    <span className="h-2 w-2 shrink-0 rounded-full border" style={{ borderColor: PRIORITY_COLOR[t.priority] }} aria-hidden />
                    <span className={clsx('truncate', t.status === 'completed' && 'line-through opacity-60')}>{t.title}</span>
                  </span>
                ))}
                {total > 3 && <span className="block text-[11px] text-muted">+{total - 3} more</span>}
              </span>
              <span className="flex flex-wrap gap-0.5 md:hidden" aria-hidden>
                {events.slice(0, 3).map((e) => (
                  <span key={e.id} className="h-1.5 w-1.5 rounded-full" style={{ background: e.color }} />
                ))}
                {tasks.slice(0, 3).map((t) => (
                  <span key={t.id} className="h-1.5 w-1.5 rounded-full border" style={{ borderColor: PRIORITY_COLOR[t.priority] }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function weekdayIdx(d: string): number {
  return new Date(Date.UTC(parseDate(d).y, parseDate(d).m - 1, parseDate(d).d)).getUTCDay();
}

export function CalendarPage() {
  const today = useToday();
  const tz = useTz();
  const weekStart = useWeekStart();
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [cursor, setCursor] = useState(startOfMonth(today));
  const [selected, setSelected] = useState<string>(today);
  const all = useAllTasks();
  const hidden = useStore((s) => s.prefs['calendar.hiddenSources'] as string[]);
  const cals = useExternalCalendars();
  const online = useStore((s) => s.online);

  const weekFirst = startOfWeek(selected, weekStart);
  const range = mode === 'month' ? { start: startOfWeek(startOfMonth(cursor), weekStart), end: addDays(startOfWeek(endOfMonth(cursor), weekStart), 6) } : { start: weekFirst, end: addDays(weekFirst, 6) };
  const ev = useCalendarEvents(range.start, range.end);

  const byDay = useMemo(() => {
    const map = new Map<string, DayBucket>();
    const get = (d: string) => {
      let b = map.get(d);
      if (!b) map.set(d, (b = { tasks: [], events: [] }));
      return b;
    };
    for (const t of all) {
      const d = t.dueDate ?? t.scheduledDate;
      if (d && d >= range.start && d <= range.end && t.status !== 'archived') get(d).tasks.push(t);
    }
    for (const e of ev.events) for (const d of eventDays(e, tz, range.start, range.end)) get(d).events.push(e);
    for (const b of map.values()) b.tasks.sort(compareTasks('time'));
    return map;
  }, [all, ev.events, tz, range.start, range.end]);

  const sync = async () => {
    try {
      await api('POST', '/calendar/sync');
      toast('Calendar sync started', 'info');
      setTimeout(() => void ev.refetch(), 4000);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const items = cals.data?.items ?? [];
  const anyProblem = items.some((c) => c.isSelected && (c.syncHealth === 'reauth_required' || c.syncHealth === 'error'));
  const day = byDay.get(selected);
  const move = (n: number) => {
    if (mode === 'month') setCursor(startOfMonth(addDays(endOfMonth(cursor), n > 0 ? 1 : -1)));
    else setSelected(addDays(selected, 7 * n));
  };
  const { y, m } = parseDate(mode === 'month' ? cursor : selected);

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle={`${monthName(m)} ${y}`}
        right={
          <>
            <Segmented label="Calendar layout" value={mode} onChange={setMode} options={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }]} />
            <IconButton label="Sync calendars now" onClick={sync} disabled={!online}>
              <RefreshCw size={18} />
            </IconButton>
          </>
        }
      />
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <IconButton label="Previous" onClick={() => move(-1)}>
            <ChevronLeft size={20} />
          </IconButton>
          <IconButton label="Next" onClick={() => move(1)}>
            <ChevronRight size={20} />
          </IconButton>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setCursor(startOfMonth(today));
              setSelected(today);
            }}
          >
            Today
          </Button>
        </div>
        {ev.isFetching && <span className="text-xs text-muted">Updating...</span>}
      </div>

      {items.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Calendars">
          {items.map((c) => {
            const on = c.isSelected && !hidden.includes(c.id);
            return (
              <Chip key={c.id} color={c.color} active={on} onClick={() => void actions.setPref('calendar.hiddenSources', on ? [...hidden, c.id] : hidden.filter((x) => x !== c.id))} title={`${c.accountLabel}${c.isStale ? ' (not synced recently)' : ''}`}>
                {c.displayName ?? c.name}
                {c.isStale && <TriangleAlert size={12} className="text-warn" aria-label="stale" />}
              </Chip>
            );
          })}
        </div>
      )}
      {items.length === 0 && !cals.isLoading && (
        <p className="mb-3 rounded-lg bg-surface p-3 text-sm text-muted">
          No calendars connected yet. <Link to="/settings/accounts" className="text-accent-text underline">Connect Google or Microsoft</Link> in Settings to see your events here (read-only).
        </p>
      )}
      {anyProblem && (
        <p role="alert" className="mb-3 rounded-lg bg-surface p-3 text-sm text-warn">
          A calendar needs attention. <Link to="/settings/sync" className="underline">Open sync diagnostics</Link>.
        </p>
      )}
      {ev.offlineCache && <p className="mb-2 text-xs text-warn">Offline: showing the last saved calendar data.</p>}

      {ev.isLoading ? (
        <Spinner />
      ) : mode === 'month' ? (
        <MonthGrid month={cursor} byDay={byDay} today={today} weekStart={weekStart} selected={selected} onSelect={setSelected} />
      ) : (
        <div className="grid gap-2 md:grid-cols-7">
          {rangeDays(weekFirst, addDays(weekFirst, 6)).map((d) => {
            const b = byDay.get(d);
            return (
              <button key={d} onClick={() => setSelected(d)} aria-pressed={selected === d} className={clsx('rounded-lg border border-line p-2 text-left text-xs', selected === d && 'bg-surface', d === today && 'border-accent-text')}>
                <span className="mb-1 block font-semibold">{WEEKDAY_NAMES[weekdayIdx(d)]?.slice(0, 3)} {parseDate(d).d}</span>
                {(b?.events ?? []).slice(0, 4).map((e) => (
                  <span key={e.id} className="mb-0.5 block truncate rounded px-1" style={{ background: `color-mix(in srgb, ${e.color} 22%, transparent)` }}>
                    {e.subject}
                  </span>
                ))}
                {(b?.tasks ?? []).slice(0, 4).map((t) => (
                  <span key={t.id} className="mb-0.5 block truncate">
                    &bull; {t.title}
                  </span>
                ))}
              </button>
            );
          })}
        </div>
      )}

      <section className="mt-5" aria-label={`Details for ${formatLongDate(selected)}`}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">{formatLongDate(selected)}</h2>
          <Button size="sm" variant="ghost" onClick={() => actions.openQuickAdd({ date: selected })}>
            Add task
          </Button>
        </div>
        {day?.events.length ? <div className="mt-1"><EventBlock events={day.events} /></div> : null}
        {day?.tasks.length ? <TaskList tasks={day.tasks} showProject /> : null}
        {!day?.events.length && !day?.tasks.length && <p className="py-4 text-sm text-muted">Nothing on this day.</p>}
      </section>
    </>
  );
}