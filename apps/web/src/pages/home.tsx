import { ArrowDown, ArrowRight, ArrowUp, CalendarDays, Check, CheckCircle2, Eye, EyeOff, Inbox, LayoutGrid, Plus, Settings2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays, compareTasks, formatLongDate, parseDate, weekdayOf } from '@wos/shared';
import { EventBlock } from '../components/EventRow';
import { TaskList } from '../components/TaskRow';
import { Button, Sheet, SheetHeader } from '../components/ui';
import { useCalendarEvents, useToday, useTz, eventDays } from '../lib/hooks';
import { flattenTree, useAllTasks, useInboxTasks, useProjectTree, useTodayView } from '../lib/selectors';
import { actions, useStore } from '../lib/store';

type Widget = 'progress' | 'focus' | 'week' | 'calendar' | 'projects';
const defaultWidgets: Widget[] = ['progress', 'focus', 'week', 'calendar', 'projects'];
const widgetLabels: Record<Widget, string> = {
  progress: 'Your progress', focus: "Today's focus", week: 'Your week', calendar: 'Coming up', projects: 'Your spaces',
};
const weekNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function SectionHeading({ title, to, linkLabel = 'See all', tone = 'peach' }: { title: string; to: string; linkLabel?: string; tone?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className={`wos-section-label wos-section-${tone}`}>{title}</h2>
      <Link to={to} className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-muted hover:text-fg">
        {linkLabel} <ArrowRight size={15} aria-hidden />
      </Link>
    </div>
  );
}

function DashboardCustomize({ order, update, onClose }: { order: Widget[]; update: (order: Widget[]) => void; onClose: () => void }) {
  const visibleFirst = [...order, ...defaultWidgets.filter((id) => !order.includes(id))];
  const toggle = (name: Widget) => update(order.includes(name) ? order.filter((id) => id !== name) : [...order, name]);
  const move = (name: Widget, step: -1 | 1) => {
    const i = order.indexOf(name);
    const nextIndex = i + step;
    if (i < 0 || nextIndex < 0 || nextIndex >= order.length) return;
    const next = [...order];
    [next[i], next[nextIndex]] = [next[nextIndex] as Widget, next[i] as Widget];
    update(next);
  };
  return (
    <>
      <SheetHeader title="Customize your home" onClose={onClose} />
      <div className="overflow-y-auto p-5">
        <p className="mb-5 text-sm text-muted">Choose which sections appear and their order. Your preferences sync between devices.</p>
        <div className="space-y-2">
          {visibleFirst.map((id) => {
            const active = order.includes(id);
            return (
              <div key={id} className="flex min-h-16 items-center gap-2 rounded-2xl border border-line bg-surface p-3">
                <button type="button" className="flex min-h-10 min-w-0 flex-1 items-center gap-3 text-left" onClick={() => toggle(id)} aria-pressed={active} aria-label={`${active ? 'Hide' : 'Show'} ${widgetLabels[id]}`}>
                  {active ? <Eye size={19} className="text-accent-text" aria-hidden /> : <EyeOff size={19} className="text-muted" aria-hidden />}
                  <span className="font-semibold">{widgetLabels[id]}</span>
                </button>
                {active && (
                  <div className="flex gap-1">
                    <button type="button" className="wos-icon-control" aria-label={`Move ${widgetLabels[id]} up`} disabled={order.indexOf(id) === 0} onClick={() => move(id, -1)}><ArrowUp size={17} aria-hidden /></button>
                    <button type="button" className="wos-icon-control" aria-label={`Move ${widgetLabels[id]} down`} disabled={order.indexOf(id) === order.length - 1} onClick={() => move(id, 1)}><ArrowDown size={17} aria-hidden /></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <Button variant="ghost" className="mt-4 w-full" onClick={() => update([...defaultWidgets])}>Restore default sections</Button>
      </div>
    </>
  );
}

export function HomePage() {
  const today = useToday();
  const tz = useTz();
  const user = useStore((s) => s.user);
  const savedWidgets = useStore((s) => s.prefs['dashboard.widgets']);
  const widgets: Widget[] = Array.isArray(savedWidgets)
    ? savedWidgets.filter((v): v is Widget => defaultWidgets.includes(v as Widget))
    : defaultWidgets;
  const [customize, setCustomize] = useState(false);
  const view = useTodayView();
  const inbox = useInboxTasks();
  const all = useAllTasks();
  const tree = useProjectTree();
  const { events, anyStale, offlineCache } = useCalendarEvents(today, addDays(today, 6));
  const upcomingEvents = useMemo(
    () => events.filter((e) => eventDays(e, tz, today, addDays(today, 6)).length > 0).slice(0, 3),
    [events, tz, today],
  );
  const due = useMemo(
    () => [...view.overdue, ...view.dueToday].filter((t) => !t.parentTaskId && !t.deletedAt).sort(compareTasks('priority')),
    [view.overdue, view.dueToday],
  );
  const projectCards = useMemo(() => {
    const nodes = flattenTree(tree);
    return [...nodes.filter((n) => n.project.favorite), ...nodes.filter((n) => !n.project.favorite)].slice(0, 4);
  }, [tree]);
  const completed = view.completedToday.length;
  const planned = completed + due.length;
  const percent = planned > 0 ? Math.round((completed / planned) * 100) : 0;
  const week = useMemo(() => Array.from({ length: 7 }, (_, n) => {
    const date = addDays(today, n);
    const tasks = all.filter((t) => t.status === 'open' && !t.deletedAt && !t.parentTaskId && (t.dueDate ?? t.scheduledDate) === date);
    return { date, tasks, count: tasks.length };
  }), [all, today]);

  const content: Record<Widget, React.ReactNode> = {
    progress: (
      <section aria-label="Your progress" key="progress">
        <SectionHeading title="Your progress" to="/activity" tone="lime" linkLabel="Activity" />
        <div className="wos-panel flex items-center gap-5 p-5">
          <div className="wos-progress-ring shrink-0" style={{ background: `conic-gradient(var(--accent) ${percent}%, var(--line) ${percent}% 100%)` }} role="progressbar" aria-label="Tasks completed today" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <div><strong>{percent}%</strong><span>today</span></div>
          </div>
          <div>
            <h3 className="text-lg font-bold">{completed > 0 ? 'Look at what you have done' : 'A fresh start'}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {planned > 0 ? `${completed} completed today; ${due.length} still due.` : 'Nothing scheduled yet. Add a task to start your day.'}
            </p>
          </div>
        </div>
      </section>
    ),
    focus: (
      <section aria-label="Today's tasks" key="focus">
        <SectionHeading title="Today's focus" to="/today" tone="yellow" />
        <div className="wos-panel p-3">
          {due.length ? (
            <>
              <TaskList tasks={due.slice(0, 5)} showProject showDate />
              {due.length > 5 && <Link to="/today" className="block px-4 py-3 text-center text-sm font-semibold text-muted hover:text-fg">{due.length - 5} more tasks</Link>}
            </>
          ) : (
            <div className="flex flex-col items-center px-5 py-8 text-center">
              <div className="wos-empty-icon"><Check size={26} aria-hidden /></div>
              <h3 className="mt-3 text-base font-bold">All clear for today</h3>
              <p className="mt-1 text-sm text-muted">No open tasks due. Add one whenever you're ready.</p>
              <button type="button" className="wos-soft-button mt-4" onClick={() => actions.openQuickAdd({ date: today })}><Plus size={16} aria-hidden /> Add a task</button>
            </div>
          )}
        </div>
      </section>
    ),
    week: (
      <section aria-label="Weekly overview" key="week">
        <SectionHeading title="Your week" to="/calendar" tone="peach" linkLabel="Full calendar" />
        <div className="wos-panel p-4">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div><h3 className="text-base font-bold">The next seven days</h3><p className="mt-0.5 text-xs text-muted">Open tasks due each day</p></div>
            <CheckCircle2 size={23} className="text-accent-text" aria-hidden />
          </div>
          <div className="wos-week-grid">
            {week.map(({ date, count }) => (
              <Link key={date} to={`/calendar?date=${date}`} aria-label={`${formatLongDate(date)}: ${count} open tasks`} className="wos-week-day">
                <span className="text-xs font-semibold text-muted">{weekNames[weekdayOf(date)]}</span>
                <strong className="text-base">{parseDate(date).d}</strong>
                <span className={count ? 'wos-week-count' : 'wos-week-none'}>{count || '·'}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    ),
    calendar: (
      <section aria-label="Upcoming calendar events" key="calendar">
        <SectionHeading title="Coming up" to="/calendar" tone="lavender" linkLabel="Calendar" />
        <div className="wos-panel p-4">
          {upcomingEvents.length ? (
            <>
              <EventBlock events={upcomingEvents} />
              {(anyStale || offlineCache) && <p className="mt-3 text-xs text-warn">{offlineCache ? 'Showing saved events while offline.' : 'Some events may need a calendar sync.'}</p>}
            </>
          ) : (
            <div className="flex items-center gap-4 py-3">
              <span className="wos-empty-icon"><CalendarDays size={23} aria-hidden /></span>
              <div><p className="font-semibold">No connected events this week</p><p className="mt-0.5 text-sm text-muted">Your calendar and schedule are one tap away.</p></div>
            </div>
          )}
        </div>
      </section>
    ),
    projects: (
      <section aria-label="Projects and organization" key="projects">
        <SectionHeading title="Your spaces" to="/browse" tone="mint" linkLabel="All projects" />
        {projectCards.length ? (
          <div className="grid grid-cols-2 gap-3">
            {projectCards.map(({ project }) => {
              const count = all.filter((t) => t.projectId === project.id && t.status === 'open' && !t.parentTaskId && !t.deletedAt).length;
              return (
                <Link to={`/project/${project.id}`} key={project.id} className="wos-space-card">
                  <span className="wos-space-icon" style={{ color: project.color }}><LayoutGrid size={22} aria-hidden /></span>
                  <span className="mt-5 block truncate text-base font-bold">{project.name}</span>
                  <span className="mt-1 block text-sm text-muted">{count} open task{count === 1 ? '' : 's'}</span>
                </Link>
              );
            })}
          </div>
        ) : (
          <Link to="/browse" className="wos-panel flex items-center gap-3 p-5 text-sm font-semibold">
            <LayoutGrid size={23} className="text-accent-text" aria-hidden /> Create your first project <ArrowRight className="ml-auto" size={16} aria-hidden />
          </Link>
        )}
      </section>
    ),
  };

  return (
    <div className="wos-home space-y-7">
      <section className="wos-hero" aria-label="Workspace overview">
        <div className="relative z-10 flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div className="min-w-0">
            <p className="mb-2 text-sm font-semibold text-muted">{formatLongDate(today)}</p>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              {user?.displayName ? `Hello, ${user.displayName.split(' ')[0]}` : 'Welcome home'}<span className="text-accent-text">.</span>
            </h1>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">One calm place for everything on your mind.</p>
          </div>
          <button type="button" onClick={() => actions.openQuickAdd({ date: today })} className="wos-primary-cta">
            <Plus size={19} aria-hidden /> Plan something
          </button>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-4">
          <Link to="/today" className="wos-metric"><span className="wos-metric-number">{view.dueToday.length}</span><span className="wos-metric-label">Due today</span></Link>
          <Link to="/today" className="wos-metric"><span className="wos-metric-number">{view.overdue.length}</span><span className="wos-metric-label">Overdue</span></Link>
          <Link to="/inbox" className="wos-metric"><span className="wos-metric-number">{inbox.length}</span><span className="wos-metric-label">Inbox</span></Link>
        </div>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2" aria-label="Quick capture options">
          <button type="button" onClick={() => actions.openQuickAdd({ date: today })} className="wos-filter-pill"><Plus size={15} aria-hidden /> Today</button>
          <button type="button" onClick={() => actions.openQuickAdd({ date: addDays(today, 1) })} className="wos-filter-pill"><Plus size={15} aria-hidden /> Tomorrow</button>
          <button type="button" onClick={() => actions.openQuickAdd({ projectId: null })} className="wos-filter-pill"><Inbox size={15} aria-hidden /> Inbox</button>
        </div>
        <button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-sm font-semibold text-muted hover:bg-surface2 hover:text-fg" onClick={() => setCustomize(true)}>
          <Settings2 size={17} aria-hidden /> Customize
        </button>
      </div>
      {widgets.map((id) => content[id])}
      {!widgets.length && (
        <div className="wos-panel flex flex-col items-center p-8 text-center">
          <p className="text-base font-bold">Your dashboard is empty</p>
          <p className="mt-1 text-sm text-muted">Choose a section to show on your home screen.</p>
          <Button className="mt-4" onClick={() => setCustomize(true)}>Choose sections</Button>
        </div>
      )}
      <Sheet open={customize} onOpenChange={setCustomize} title="Customize dashboard">
        <DashboardCustomize order={widgets} update={(order) => void actions.setPref('dashboard.widgets', order)} onClose={() => setCustomize(false)} />
      </Sheet>
    </div>
  );
}
