import { ArrowRight, CalendarDays, Check, CircleHelp, Inbox, LayoutGrid, Plus, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { addDays, compareTasks, formatLongDate } from '@wos/shared';
import { EventBlock } from '../components/EventRow';
import { TaskList } from '../components/TaskRow';
import { useCalendarEvents, useToday, useTz, eventDays } from '../lib/hooks';
import { flattenTree, useAllTasks, useInboxTasks, useProjectTree, useTodayView } from '../lib/selectors';
import { actions, useStore } from '../lib/store';

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

/** A presentational home screen built entirely from existing tasks, projects and read-only calendars. */
export function HomePage() {
  const today = useToday();
  const tz = useTz();
  const user = useStore((s) => s.user);
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
        <div className="mt-7 grid grid-cols-3 gap-2 sm:gap-4">
          <Link to="/today" className="wos-metric"><span className="wos-metric-number">{view.dueToday.length}</span><span className="wos-metric-label">Due today</span></Link>
          <Link to="/today" className="wos-metric"><span className="wos-metric-number">{view.overdue.length}</span><span className="wos-metric-label">Overdue</span></Link>
          <Link to="/inbox" className="wos-metric"><span className="wos-metric-number">{inbox.length}</span><span className="wos-metric-label">Inbox</span></Link>
        </div>
      </section>

      <section aria-labelledby="wos-progress-heading">
        <SectionHeading title="Your progress" to="/activity" tone="lime" linkLabel="Activity" />
        <div className="wos-panel flex items-center gap-5 p-5">
          <div className="wos-progress-ring shrink-0" style={{ background: `conic-gradient(var(--accent) ${percent}%, var(--line) ${percent}% 100%)` }} role="progressbar" aria-label="Tasks completed today" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <div><strong>{percent}%</strong><span>today</span></div>
          </div>
          <div>
            <h3 id="wos-progress-heading" className="text-lg font-bold">{completed > 0 ? 'Look at what you have done' : 'A fresh start'}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {planned > 0 ? `${completed} of ${planned} tasks completed today. Keep the momentum going.` : 'Nothing scheduled yet. Add a task to start planning your day.'}
            </p>
          </div>
        </div>
      </section>

      <section aria-label="Today's tasks">
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

      <section aria-label="Upcoming calendar events">
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
              <div>
                <p className="font-semibold">No connected events this week</p>
                <p className="mt-0.5 text-sm text-muted">Your calendar, schedule and tasks are one tap away.</p>
              </div>
            </div>
          )}
        </div>
      </section>

      <section aria-label="Projects and organization">
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
      <div className="flex flex-wrap items-center gap-2 pb-1 text-xs text-muted">
        <Inbox size={14} aria-hidden /> Quick capture stays available from the bottom bar.
        <span aria-hidden>·</span><Sparkles size={14} aria-hidden /> No features have been removed.
        <Link to="/settings" className="ml-auto inline-flex items-center gap-1 underline"><CircleHelp size={14} aria-hidden /> Preferences</Link>
      </div>
    </div>
  );
}
