import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, MoreHorizontal, Plus, Star, Settings2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { addDays, agendaDate, formatDateLabel, isOverdue, monthName, parseDate, selectUpcoming, startOfWeek, rangeDays, weekdayOf, compareTasks, type CalendarEventDTO, type TaskDTO } from '@wos/shared';
import { EventBlock } from '../components/EventRow';
import { PageHeader } from '../components/PageHeader';
import { TaskList } from '../components/TaskRow';
import { MiniCalendar } from '../components/pickers';
import { Button, EmptyState, IconButton, MenuContent, MenuItem, MenuRoot, MenuTrigger, PopoverContent, PopoverRoot, PopoverTrigger, Segmented, Switch, clsx } from '../components/ui';
import { dayHeading, rescheduleTask } from '../lib/format';
import { eventDays, useCalendarEvents, useToday, useTz, useWeekStart } from '../lib/hooks';
import { useAllTasks, useInboxTasks, useTodayView } from '../lib/selectors';
import { actions, useStore } from '../lib/store';
import { formatLongDate } from '@wos/shared';
import { MonthGrid } from './calendar';
import { useNavigate } from 'react-router-dom';

export function InboxPage() {
  const tasks = useInboxTasks();
  const sort = useStore((s) => s.prefs['display.inboxSort'] as string);
  const sorted = useMemo(() => {
    if (sort === 'due') return [...tasks].sort(compareTasks('due'));
    if (sort === 'priority') return [...tasks].sort(compareTasks('priority'));
    if (sort === 'created') return [...tasks].sort(compareTasks('created'));
    return tasks;
  }, [tasks, sort]);
  return (
    <>
      <PageHeader
        title="Inbox"
        right={
          <MenuRoot>
            <MenuTrigger asChild>
              <IconButton label="Inbox options">
                <MoreHorizontal size={20} />
              </IconButton>
            </MenuTrigger>
            <MenuContent>
              {(['manual', 'due', 'priority', 'created'] as const).map((s) => (
                <MenuItem key={s} onSelect={() => void actions.setPref('display.inboxSort', s)}>
                  Sort: {s === 'manual' ? 'Manual' : s === 'due' ? 'Due date' : s === 'priority' ? 'Priority' : 'Newest'} {sort === s ? '\u2713' : ''}
                </MenuItem>
              ))}
            </MenuContent>
          </MenuRoot>
        }
      />
      {sorted.length === 0 ? (
        <EmptyState title="Your inbox is empty" body="Capture anything with the + button. Sort it into projects later.">
          <Button variant="primary" onClick={() => actions.openQuickAdd()}>
            <Plus size={16} aria-hidden /> Add task
          </Button>
        </EmptyState>
      ) : (
        <TaskList tasks={sorted} nested sortable={sort === 'manual' ? { projectId: null, sectionId: null } : undefined} />
      )}
      <AddInline onClick={() => actions.openQuickAdd({ projectId: null })} />
    </>
  );
}

export function AddInline({ onClick, label = 'Add task' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="mt-1 flex min-h-11 w-full items-center gap-3 px-3 text-sm text-muted hover:text-accent-text">
      <span className="flex h-5 w-5 items-center justify-center rounded-full text-accent-text">
        <Plus size={18} />
      </span>
      {label}
    </button>
  );
}

function RescheduleMenu({ tasks, label = 'Reschedule' }: { tasks: TaskDTO[]; label?: string }) {
  const today = useToday();
  const tz = useTz();
  const move = (d: string) => tasks.forEach((t) => rescheduleTask(t, d, tz));
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <Button size="sm" variant="ghost" className="text-accent-text">
          {label}
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={() => move(today)}>Today</MenuItem>
        <MenuItem onSelect={() => move(addDays(today, 1))}>Tomorrow</MenuItem>
        <MenuItem onSelect={() => move(addDays(today, 7))}>Next week</MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}

export function TodayPage() {
  const view = useTodayView();
  const today = view.date;
  const prefs = useStore((s) => s.prefs);
  const projects = useStore((s) => s.projects);
  const all = useStore((s) => s.tasks);
  const { events, anyStale, offlineCache } = useCalendarEvents(today, today, prefs['display.todayShowEvents'] !== false);
  const [showOverdue, setShowOverdue] = useState(true);
  const showEvents = prefs['display.todayShowEvents'] !== false;
  const showTasks = prefs['display.todayShowTasks'] !== false;
  const sortMode = prefs['display.todaySort'] as string;
  const focusIds = (prefs['focus.taskIds'] as string[]).filter((id) => all[id] && all[id]?.status === 'open');
  const focus = focusIds.map((id) => all[id] as TaskDTO);

  const dueToday = useMemo(() => {
    let list = view.dueToday.filter((t) => !focusIds.includes(t.id));
    const pf = prefs['display.todayProjectFilter'] as string | null;
    const lf = prefs['display.todayLabelFilter'] as string | null;
    if (pf) list = list.filter((t) => t.projectId === pf);
    if (lf) list = list.filter((t) => t.labelIds.includes(lf));
    if (sortMode === 'priority') return [...list].sort(compareTasks('priority'));
    if (sortMode === 'manual') return [...list].sort(compareTasks('position'));
    if (sortMode === 'project') return [...list].sort((a, b) => (projects[a.projectId ?? '']?.name ?? '').localeCompare(projects[b.projectId ?? '']?.name ?? '') || compareTasks('time')(a, b));
    return [...list].sort(compareTasks('time'));
  }, [view.dueToday, sortMode, prefs, projects, focusIds]);

  const nothing = !view.overdue.length && !dueToday.length && !focus.length && !(showEvents && events.length);
  const completedCount = view.completedToday.length;
  return (
    <>
      <PageHeader
        title="Today"
        subtitle={formatLongDate(today)}
        right={
          <PopoverRoot>
            <PopoverTrigger asChild>
              <IconButton label="View options">
                <Settings2 size={20} />
              </IconButton>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[280px] space-y-3 p-3">
              <div>
                <p className="mb-1 text-sm font-medium">Sort tasks by</p>
                <Segmented
                  label="Sort"
                  value={sortMode as 'time'}
                  onChange={(v) => void actions.setPref('display.todaySort', v)}
                  options={[
                    { value: 'time', label: 'Time' },
                    { value: 'priority', label: 'Priority' },
                    { value: 'project', label: 'Project' },
                    { value: 'manual', label: 'Manual' },
                  ]}
                />
              </div>
              {(
                [
                  ['display.todayShowEvents', 'Show calendar events'],
                  ['display.todayShowTasks', 'Show tasks'],
                  ['display.todayShowCompleted', 'Show completed tasks'],
                ] as const
              ).map(([k, label]) => (
                <div key={k} className="flex items-center justify-between gap-3 text-sm">
                  <span>{label}</span>
                  <Switch label={label} checked={prefs[k] !== false && !!prefs[k]} onChange={(v) => void actions.setPref(k, v)} />
                </div>
              ))}
            </PopoverContent>
          </PopoverRoot>
        }
      />
      {showEvents && events.length > 0 && (
        <div className="mb-3">
          <EventBlock events={events} />
          {(anyStale || offlineCache) && <p className="mt-1 text-xs text-warn">{offlineCache ? 'Showing saved calendar data (offline).' : 'Some calendars have not synced recently.'}</p>}
        </div>
      )}
      {showTasks && (
        <>
          {focus.length > 0 && (
            <section aria-label="Focus" className="mb-3">
              <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
                <Star size={14} className="text-warn" fill="currentColor" aria-hidden /> Focus
              </h2>
              <TaskList tasks={focus} showProject />
            </section>
          )}
          {view.overdue.length > 0 && (
            <section aria-label="Overdue" className="mb-3">
              <div className="flex items-center justify-between">
                <button className="flex min-h-10 items-center gap-1 text-sm font-semibold" aria-expanded={showOverdue} onClick={() => setShowOverdue(!showOverdue)}>
                  <ChevronDown size={16} className={clsx('transition-transform', !showOverdue && '-rotate-90')} aria-hidden /> Overdue <span className="font-normal text-muted">{view.overdue.length}</span>
                </button>
                <RescheduleMenu tasks={view.overdue} />
              </div>
              {showOverdue && <TaskList tasks={[...view.overdue].sort(compareTasks('due'))} showProject />}
            </section>
          )}
          {dueToday.length > 0 && (
            <section aria-label="Tasks due today">
              {(view.overdue.length > 0 || focus.length > 0) && <h2 className="mb-1 text-sm font-semibold">Today</h2>}
              <TaskList tasks={dueToday} showProject showDate={false} sortable={sortMode === 'manual' ? undefined : undefined} />
            </section>
          )}
          <AddInline onClick={() => actions.openQuickAdd({ date: today })} />
          {prefs['display.todayShowCompleted'] === true && completedCount > 0 && (
            <section aria-label="Completed today" className="mt-4">
              <h2 className="mb-1 text-sm font-semibold text-muted">Completed today ({completedCount})</h2>
              <TaskList tasks={view.completedToday} showProject showDate={false} />
            </section>
          )}
        </>
      )}
      {nothing && (
        <EmptyState title="Enjoy the rest of your day." body={completedCount ? `Today you completed ${completedCount} task${completedCount > 1 ? 's' : ''}. Nothing else is due.` : 'Nothing is due today.'}>
          <Button variant="primary" onClick={() => actions.openQuickAdd({ date: today })}>
            <Plus size={16} aria-hidden /> Add task
          </Button>
        </EmptyState>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Upcoming
type Layout = 'agenda' | 'week' | 'month';

export function UpcomingPage() {
  const today = useToday();
  const tz = useTz();
  const weekStart = useWeekStart();
  const nav = useNavigate();
  const layout = useStore((s) => s.prefs['display.upcomingLayout'] as Layout);
  const all = useAllTasks();
  const [anchor, setAnchor] = useState<string | null>(null);
  const [days, setDays] = useState(14);
  const [showOverdue, setShowOverdue] = useState(true);
  const start = anchor ?? today;
  const { y, m } = parseDate(start);

  const weekFirst = startOfWeek(start, weekStart);
  const range = useMemo(() => {
    if (layout === 'month') {
      const first = startOfWeek(`${y}-${String(m).padStart(2, '0')}-01`, weekStart);
      return { start: first, end: addDays(first, 41) };
    }
    if (layout === 'week') return { start: weekFirst, end: addDays(weekFirst, 6) };
    return { start, end: addDays(start, days - 1) };
  }, [layout, start, days, weekFirst, y, m, weekStart]);
  const stripStart = layout === 'agenda' ? weekFirst : range.start;
  const evRange = { start: layout === 'agenda' ? (stripStart < range.start ? stripStart : range.start) : range.start, end: range.end };
  const { events } = useCalendarEvents(evRange.start, evRange.end);
  const open = useMemo(() => all.filter((t) => t.status === 'open'), [all]);
  const agenda = useMemo(() => selectUpcoming(open, evRange.start, evRange.end, today, true), [open, evRange.start, evRange.end, today]);
  const overdue = useMemo(() => open.filter((t) => isOverdue(t, today)).sort(compareTasks('due')), [open, today]);

  const byDay = useMemo(() => {
    const map = new Map<string, { tasks: { task: TaskDTO; virtual: boolean }[]; events: CalendarEventDTO[] }>();
    const get = (d: string) => {
      let b = map.get(d);
      if (!b) map.set(d, (b = { tasks: [], events: [] }));
      return b;
    };
    for (const a of agenda) get(a.date).tasks.push({ task: a.task, virtual: a.virtual });
    for (const e of events) for (const d of eventDays(e, tz, evRange.start, evRange.end)) get(d).events.push(e);
    return map;
  }, [agenda, events, tz, evRange.start, evRange.end]);

  const shift = (n: number, unit: 'day' | 'week' | 'month') => {
    if (unit === 'month') setAnchor(`${y + Math.floor((m - 1 + n) / 12)}-${String((((m - 1 + n) % 12) + 12) % 12 + 1).padStart(2, '0')}-01`);
    else setAnchor(addDays(start, unit === 'week' ? 7 * n : n));
  };

  const strip = rangeDays(stripStart, addDays(stripStart, 6));
  return (
    <>
      <PageHeader
        title="Upcoming"
        right={
          <>
            <IconButton label="Calendar view" onClick={() => nav('/calendar')}>
              <CalendarDays size={20} />
            </IconButton>
            <MenuRoot>
              <MenuTrigger asChild>
                <IconButton label="Upcoming layout">
                  <MoreHorizontal size={20} />
                </IconButton>
              </MenuTrigger>
              <MenuContent>
                {(['agenda', 'week', 'month'] as const).map((l) => (
                  <MenuItem key={l} onSelect={() => void actions.setPref('display.upcomingLayout', l)}>
                    {l[0]?.toUpperCase()}
                    {l.slice(1)} layout {layout === l ? '\u2713' : ''}
                  </MenuItem>
                ))}
              </MenuContent>
            </MenuRoot>
          </>
        }
      />
      <div className="mb-2 flex items-center justify-between">
        <PopoverRoot>
          <PopoverTrigger asChild>
            <button className="flex min-h-10 items-center gap-1 text-sm font-semibold" aria-label="Pick a date">
              {monthName(m)} {y} <ChevronRight size={14} aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent>
            <MiniCalendar value={start} onSelect={(d) => setAnchor(d)} today={today} weekStart={weekStart} />
          </PopoverContent>
        </PopoverRoot>
        <div className="flex items-center gap-1">
          <IconButton label={`Previous ${layout === 'month' ? 'month' : 'week'}`} onClick={() => shift(-1, layout === 'month' ? 'month' : 'week')}>
            <ChevronLeft size={20} />
          </IconButton>
          <Button size="sm" variant="ghost" onClick={() => setAnchor(null)}>
            Today
          </Button>
          <IconButton label={`Next ${layout === 'month' ? 'month' : 'week'}`} onClick={() => shift(1, layout === 'month' ? 'month' : 'week')}>
            <ChevronRight size={20} />
          </IconButton>
        </div>
      </div>

      {layout !== 'month' && (
        <div className="mb-3 grid grid-cols-7 border-b border-line pb-2 text-center" role="group" aria-label="Week">
          {strip.map((d) => {
            const has = byDay.get(d);
            const sel = d === start;
            const isToday = d === today;
            const wd = ['S', 'M', 'T', 'W', 'T', 'F', 'S'][weekdayOf(d)];
            return (
              <button key={d} onClick={() => setAnchor(d)} aria-label={formatDateLabel(d, today)} aria-pressed={sel} className="flex flex-col items-center gap-1 py-1 text-xs text-muted">
                {wd}
                <span className={clsx('flex h-9 w-9 items-center justify-center rounded-full text-base', sel || isToday ? 'text-fg' : '', sel && 'bg-accent font-semibold text-accent-fg', !sel && isToday && 'font-bold text-accent-text')}>{parseDate(d).d}</span>
                <span className={clsx('h-1 w-1 rounded-full', has && (has.tasks.length || has.events.length) ? 'bg-muted' : 'bg-transparent')} />
              </button>
            );
          })}
        </div>
      )}

      {layout === 'month' ? (
        <MonthGrid
          month={`${y}-${String(m).padStart(2, '0')}-01`}
          byDay={byDay as never}
          today={today}
          weekStart={weekStart}
          selected={anchor}
          onSelect={(d) => {
            setAnchor(d);
            void actions.setPref('display.upcomingLayout', 'agenda');
          }}
        />
      ) : (
        <>
          {start <= today && overdue.length > 0 && layout === 'agenda' && (
            <section aria-label="Overdue" className="mb-4">
              <div className="flex items-center justify-between">
                <button className="flex min-h-10 items-center gap-1 text-sm font-semibold text-danger" aria-expanded={showOverdue} onClick={() => setShowOverdue(!showOverdue)}>
                  <ChevronDown size={16} className={clsx('transition-transform', !showOverdue && '-rotate-90')} aria-hidden /> Overdue ({overdue.length})
                </button>
                <RescheduleMenu tasks={overdue} />
              </div>
              {showOverdue && <TaskList tasks={overdue} showProject />}
            </section>
          )}
          <div className={clsx(layout === 'week' && 'md:grid md:grid-cols-1')}>
            {rangeDays(range.start, range.end).map((d) => {
              const b = byDay.get(d);
              const tasks = (b?.tasks ?? []).filter((x) => !x.virtual).map((x) => x.task);
              const virtual = (b?.tasks ?? []).filter((x) => x.virtual).map((x) => x.task);
              const empty = !tasks.length && !virtual.length && !(b?.events.length ?? 0);
              return (
                <section key={d} aria-label={dayHeading(d, today)} className="mb-3 border-b border-line/60 pb-2">
                  <div className="flex items-center justify-between">
                    <h2 className={clsx('py-2 text-sm font-bold', empty && 'font-semibold text-muted')}>{dayHeading(d, today)}</h2>
                    <IconButton label={`Add task on ${d}`} onClick={() => actions.openQuickAdd({ date: d })}>
                      <Plus size={20} className={empty ? 'text-muted' : ''} />
                    </IconButton>
                  </div>
                  {b && b.events.length > 0 && <EventBlock events={b.events} />}
                  {tasks.length > 0 && <TaskList tasks={tasks} showProject showDate={false} />}
                  {virtual.length > 0 && (
                    <ul className="mt-1 space-y-0.5" aria-label="Upcoming repeats">
                      {virtual.map((t) => (
                        <li key={t.id} className="flex items-center gap-2 px-3 py-1 text-sm text-muted">
                          <span className="h-4 w-4 rounded-full border border-dashed border-muted" aria-hidden /> {t.title} <span className="text-xs">(repeat)</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
          {layout === 'agenda' && (
            <Button className="mx-auto mb-6 mt-2 flex" onClick={() => setDays(days + 14)}>
              Load 2 more weeks
            </Button>
          )}
        </>
      )}
    </>
  );
}
