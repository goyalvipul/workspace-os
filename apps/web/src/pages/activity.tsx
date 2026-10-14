import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Flame } from 'lucide-react';
import { useMemo, useState } from 'react';
import { addDays, formatTime, localDateOf, localTimeOf, type ActivityDTO } from '@wos/shared';
import { PageHeader } from '../components/PageHeader';
import { Button, EmptyState, Segmented, Select, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { dayHeading } from '../lib/format';
import { useHour12, useToday, useTz } from '../lib/hooks';
import { computeProductivity } from '../lib/productivity';
import { useStore } from '../lib/store';

interface Summary {
  from: string; to: string; totalCompleted: number;
  days: { date: string; completed: number }[];
  byProject: { projectId: string | null; name: string; color: string; completed: number }[];
  overdue: number; openTasks: number; activeProjects: number; streakDays: number;
}

export function ActivityPage() {
  const [tab, setTab] = useState<'feed' | 'report' | 'goals'>('feed');
  return (
    <>
      <PageHeader title="Activity" back="/browse" />
      <div className="mb-4"><Segmented label="View" value={tab} onChange={setTab} options={[{ value: 'feed', label: 'Activity feed' }, { value: 'report', label: 'Last 7 days' }, { value: 'goals', label: 'Goals & karma' }]} /></div>
      {tab === 'feed' ? <Feed /> : tab === 'report' ? <Report /> : <Goals />}
    </>
  );
}

function Goals() {
  const today = useToday();
  const user = useStore((s) => s.user);
  const prefs = useStore((s) => s.prefs);
  const from = addDays(today, -89);
  const q = useQuery<Summary>({ queryKey: ['report', from, today], queryFn: () => api('GET', `/reports/summary?from=${from}&to=${today}`) });
  const p = useMemo(
    () => q.data && user ? computeProductivity(q.data.days, { dailyGoal: Number(prefs['productivity.dailyGoal']), weeklyGoal: Number(prefs['productivity.weeklyGoal']), daysOff: prefs['productivity.daysOff'] as number[], vacation: !!prefs['productivity.vacation'] }, today, user.weekStartsOn) : null,
    [q.data, user, prefs, today],
  );
  if (!prefs['productivity.karma']) return <EmptyState title="Karma is turned off" body="Turn it on in Settings → Productivity to track daily and weekly goals." art={false} />;
  if (q.isLoading) return <Spinner />;
  if (!p) return <EmptyState title="Goals need a connection" art={false} />;
  const daily = Number(prefs['productivity.dailyGoal']);
  const weekly = Number(prefs['productivity.weeklyGoal']);
  const stat = 'rounded-xl bg-surface p-4';
  const bar = (v: number, max: number, label: string) => (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(v, max)} className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface2">
      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.min(100, (v / max) * 100)}%` }} />
    </div>
  );
  const span = p.next ? p.next.at - p.level.at : 1;
  return (
    <>
      {prefs['productivity.vacation'] && <p role="status" className="mb-3 rounded-lg bg-surface2 p-3 text-sm">Vacation mode is on. Goals and goal reminders are paused, and your streak is protected.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <section aria-label="Daily goal" className={stat}>
          <p className="text-sm text-muted">Daily goal</p>
          <p className="text-2xl font-semibold">{p.todayCount} <span className="text-base font-normal text-muted">/ {daily}</span></p>
          {bar(p.todayCount, daily, 'Daily goal progress')}
        </section>
        <section aria-label="Weekly goal" className={stat}>
          <p className="text-sm text-muted">Weekly goal</p>
          <p className="text-2xl font-semibold">{p.weekCount} <span className="text-base font-normal text-muted">/ {weekly}</span></p>
          {bar(p.weekCount, weekly, 'Weekly goal progress')}
        </section>
        <section aria-label="Goal streak" className={stat}>
          <p className="text-sm text-muted">Goal streak</p>
          <p className="flex items-center gap-1 text-2xl font-semibold"><Flame size={20} className="text-warn" aria-hidden />{p.streak} <span className="text-base font-normal text-muted">days</span></p>
          <p className="text-xs text-muted">Longest in 90 days: {p.longest}</p>
        </section>
        <section aria-label="Karma" className={stat}>
          <p className="text-sm text-muted">Karma (last 90 days)</p>
          <p className="text-2xl font-semibold">{p.karma} <span className="text-base font-normal text-accent-text">{p.level.name}</span></p>
          {p.next ? (<>{bar(p.karma - p.level.at, span, 'Progress to next karma level')}<p className="mt-1 text-xs text-muted">{p.next.at - p.karma} points to {p.next.name}</p></>) : <p className="text-xs text-muted">Top level reached.</p>}
        </section>
      </div>
      <p className="mt-4 text-xs text-muted">Karma is 1 point per completed task plus 10 for every day you reach your daily goal. Days off never break a streak.</p>
    </>
  );
}

function Feed() {
  const tz = useTz();
  const today = useToday();
  const hour12 = useHour12();
  const projects = useStore((s) => s.projects);
  const [action, setAction] = useState('');
  const [projectId, setProjectId] = useState('');
  const q = useInfiniteQuery({
    queryKey: ['activity', action, projectId],
    initialPageParam: '' as string,
    queryFn: ({ pageParam }) => api<{ items: ActivityDTO[]; nextBefore: string | null }>('GET', `/activity?limit=50${action ? `&action=${action}` : ''}${projectId ? `&projectId=${projectId}` : ''}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const groups = useMemo(() => {
    const m = new Map<string, ActivityDTO[]>();
    for (const a of items) { const d = localDateOf(a.createdAt, tz); m.set(d, [...(m.get(d) ?? []), a]); }
    return [...m.entries()];
  }, [items, tz]);
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <Select aria-label="Filter by action" value={action} onChange={(e) => setAction(e.target.value)} className="w-40">
          <option value="">All activity</option><option value="task.created">Added</option><option value="task.completed">Completed</option><option value="task.updated">Updated</option><option value="task.deleted">Deleted</option><option value="project">Projects</option>
        </Select>
        <Select aria-label="Filter by project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-48">
          <option value="">All projects</option>{Object.values(projects).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>
      {q.isLoading && <Spinner />}
      {q.isError && <EmptyState title="Activity needs a connection" body="Reconnect and try again." art={false} />}
      {!q.isLoading && !q.isError && !items.length && <EmptyState title="No activity yet" body="Completing and editing tasks will show up here." art={false} />}
      {groups.map(([date, list]) => (
        <section key={date} className="mb-5" aria-label={dayHeading(date, today)}>
          <h2 className="mb-1 border-b border-line pb-1 text-sm font-semibold">{dayHeading(date, today)}</h2>
          <ul>
            {list.map((a) => (
              <li key={a.id} className="flex items-start gap-3 py-2 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: a.projectColor ?? 'var(--muted)' }} aria-hidden />
                <span className="flex-1">{a.summary}{a.projectName && <span className="text-muted"> &middot; {a.projectName}</span>}</span>
                <time className="shrink-0 text-xs text-muted" dateTime={a.createdAt}>{formatTime(localTimeOf(a.createdAt, tz), hour12)}</time>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {q.hasNextPage && <div className="flex justify-center"><Button onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>{q.isFetchingNextPage ? 'Loading...' : 'Load more'}</Button></div>}
    </>
  );
}

function Report() {
  const today = useToday();
  const from = addDays(today, -6);
  const q = useQuery<Summary>({ queryKey: ['report', from, today], queryFn: () => api('GET', `/reports/summary?from=${from}&to=${today}`) });
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <EmptyState title="Reports need a connection" art={false} />;
  const d = q.data;
  const max = Math.max(1, ...d.days.map((x) => x.completed));
  const stat = 'rounded-xl bg-surface p-3';
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className={stat}><p className="text-2xl font-semibold">{d.totalCompleted}</p><p className="text-xs text-muted">Completed (7 days)</p></div>
        <div className={stat}><p className="flex items-center gap-1 text-2xl font-semibold"><Flame size={20} className="text-warn" aria-hidden />{d.streakDays}</p><p className="text-xs text-muted">Day streak</p></div>
        <div className={stat}><p className="text-2xl font-semibold">{d.openTasks}</p><p className="text-xs text-muted">Open tasks</p></div>
        <div className={stat}><p className="text-2xl font-semibold">{d.overdue}</p><p className="text-xs text-muted">Overdue</p></div>
      </div>
      <h2 className="mb-2 mt-6 text-sm font-semibold">Completed per day</h2>
      <div role="img" aria-label={`Bar chart of tasks completed per day: ${d.days.map((x) => `${x.date} ${x.completed}`).join(', ')}`} className="flex h-36 items-end gap-2 rounded-xl bg-surface p-3">
        {d.days.map((x) => (
          <div key={x.date} className="flex flex-1 flex-col items-center justify-end gap-1">
            <span className="text-xs text-muted">{x.completed || ''}</span>
            <div className="w-full rounded-t bg-accent" style={{ height: `${Math.max(2, (x.completed / max) * 80)}px`, opacity: x.completed ? 1 : 0.25 }} />
            <span className="text-[10px] text-muted">{new Date(`${x.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'narrow', timeZone: 'UTC' })}</span>
          </div>
        ))}
      </div>
      {d.byProject.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-sm font-semibold">By project</h2>
          <ul className="space-y-2">{d.byProject.map((p) => <li key={p.projectId ?? 'inbox'} className="flex items-center gap-3 text-sm"><span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} aria-hidden /><span className="flex-1 truncate">{p.name}</span><span className="text-muted">{p.completed}</span></li>)}</ul>
        </>
      )}
    </>
  );
}
