import { Calendar, CalendarDays, CloudOff, Hash, Inbox, LayoutList, Plus, RefreshCw, Search, Settings, Tag, WifiOff, Filter, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { parseDate } from '@wos/shared';
import { actions, flush, resolveConflict, useStore } from '../lib/store';
import { useIsDesktop } from '../lib/hooks';
import { flattenTree, useAllTasks, useProjectTree, useTodayView } from '../lib/selectors';
import { Button, Sheet, clsx } from './ui';
import { QuickAdd } from './QuickAdd';
import { TaskSheet } from './TaskSheet';

function useShortcuts() {
  const nav = useNavigate();
  useEffect(() => {
    let gPressed = 0;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const qa = (useStore.getState().prefs['shortcuts.quickAdd'] as string) || 'q';
      if (key === qa) {
        e.preventDefault();
        actions.openQuickAdd();
      } else if (key === '/') {
        e.preventDefault();
        nav('/search');
      } else if (key === 'g') gPressed = Date.now();
      else if (Date.now() - gPressed < 1200) {
        const map: Record<string, string> = { i: '/inbox', t: '/today', u: '/upcoming', c: '/calendar', b: '/browse' };
        if (map[key]) {
          e.preventDefault();
          nav(map[key] as string);
        }
        gPressed = 0;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);
}

function SyncBadge() {
  const online = useStore((s) => s.online);
  const pending = useStore((s) => s.outbox.length);
  const syncing = useStore((s) => s.syncing);
  const stream = useStore((s) => s.stream);
  if (!online) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-warn" role="status">
        <WifiOff size={14} aria-hidden /> Offline{pending ? ` \u00b7 ${pending} change${pending > 1 ? 's' : ''} waiting` : ''}
      </span>
    );
  }
  if (pending || syncing) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted" role="status">
        <RefreshCw size={14} className="animate-spin" aria-hidden /> Syncing{pending ? ` ${pending}` : ''}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" role="status">
      <span className={clsx('h-2 w-2 rounded-full', stream === 'live' ? 'bg-ok' : 'bg-warn')} aria-hidden /> {stream === 'live' ? 'Live' : 'Reconnecting'}
    </span>
  );
}

function Banners() {
  const online = useStore((s) => s.online);
  const pending = useStore((s) => s.outbox.length);
  const expired = useStore((s) => s.sessionExpired);
  const nav = useNavigate();
  return (
    <>
      {expired && (
        <div role="alert" className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-warn px-4 py-2 text-sm font-medium text-black">
          <span>Your session expired. Your {pending} unsynced change(s) are kept on this device.</span>
          <Button size="sm" onClick={() => nav('/login')}>
            Sign in
          </Button>
        </div>
      )}
      {!online && !expired && (
        <div role="status" className="flex items-center justify-center gap-2 bg-surface2 px-4 py-1.5 text-xs text-muted">
          <CloudOff size={14} aria-hidden /> You are offline. Changes are saved on this device and will sync when you reconnect.
          {pending > 0 && (
            <button className="underline" onClick={() => void flush()}>
              Retry now
            </button>
          )}
        </div>
      )}
    </>
  );
}

function ConflictDialog() {
  const conflicts = useStore((s) => s.conflicts);
  const c = conflicts[0];
  const show = (v: unknown) => (v === null || v === undefined || v === '' ? '(empty)' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (
    <Sheet open={!!c} onOpenChange={() => undefined} title="Resolve a sync conflict">
      {c && (
        <div className="space-y-4 p-5">
          <h2 className="text-lg font-semibold">This task changed in two places</h2>
          <p className="text-sm text-muted">&ldquo;{c.title}&rdquo; was edited on another device while you were offline. Choose which version to keep.</p>
          {c.fields.map((f) => (
            <div key={f.key} className="rounded-lg bg-surface p-3 text-sm">
              <p className="mb-1 font-medium">{f.key}</p>
              <p>
                <span className="text-muted">Your edit:</span> {show(f.mine)}
              </p>
              <p>
                <span className="text-muted">Other device:</span> {show(f.theirs)}
              </p>
            </div>
          ))}
          <div className="flex justify-end gap-2">
            <Button onClick={() => resolveConflict(c.id, 'theirs')}>Keep other device&apos;s version</Button>
            <Button variant="primary" onClick={() => resolveConflict(c.id, 'mine')}>
              Keep my edit
            </Button>
          </div>
          {conflicts.length > 1 && <p className="text-xs text-muted">{conflicts.length - 1} more to review.</p>}
        </div>
      )}
    </Sheet>
  );
}

const navItem = 'flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm hover:bg-surface2';

function Sidebar() {
  const tasks = useAllTasks();
  const today = useTodayView();
  const tree = useProjectTree();
  const favorites = flattenTree(tree).filter((n) => n.project.favorite);
  const inbox = tasks.filter((t) => t.status === 'open' && !t.projectId && !t.parentTaskId).length;
  const todayCount = today.overdue.length + today.dueToday.length;
  const user = useStore((s) => s.user);
  const [showProjects, setShowProjects] = useState(true);
  const [addingProject, setAddingProject] = useState(false);
  const [projectName, setProjectName] = useState('');
  const nav = useNavigate();
  const link = ({ isActive }: { isActive: boolean }) => clsx(navItem, isActive && 'bg-surface2 font-semibold text-accent-text');
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-surface/40 p-3" aria-label="Sidebar">
      <div className="mb-3 flex items-center gap-2 px-2 pt-1">
        <img src="/icons/icon.svg" alt="" className="h-7 w-7 rounded-lg" />
        <span className="font-semibold">Workspace OS</span>
      </div>
      <button type="button" onClick={() => actions.openQuickAdd()} className="mb-2 flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-semibold text-accent-text hover:bg-surface2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-accent-fg">
          <Plus size={16} />
        </span>
        Add task <kbd className="ml-auto rounded bg-surface2 px-1.5 text-xs text-muted">Q</kbd>
      </button>
      <nav className="flex-1 space-y-0.5 overflow-y-auto scroll-thin" aria-label="Main">
        <NavLink to="/search" className={link}>
          <Search size={18} aria-hidden /> Search
        </NavLink>
        <NavLink to="/inbox" className={link}>
          <Inbox size={18} aria-hidden /> Inbox <span className="ml-auto text-xs text-muted">{inbox || ''}</span>
        </NavLink>
        <NavLink to="/today" className={link}>
          <CalendarDays size={18} aria-hidden /> Today <span className="ml-auto text-xs text-muted">{todayCount || ''}</span>
        </NavLink>
        <NavLink to="/upcoming" className={link}>
          <LayoutList size={18} aria-hidden /> Upcoming
        </NavLink>
        <NavLink to="/calendar" className={link}>
          <Calendar size={18} aria-hidden /> Calendar
        </NavLink>
        <NavLink to="/labels" className={link}>
          <Filter size={18} aria-hidden /> Filters &amp; Labels
        </NavLink>
        {favorites.length > 0 && (
          <div className="pt-3">
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">Favorites</p>
            {favorites.map((n) => (
              <NavLink key={n.project.id} to={`/project/${n.project.id}`} className={link}>
                <Hash size={16} style={{ color: n.project.color }} aria-hidden /> <span className="truncate">{n.project.name}</span>
              </NavLink>
            ))}
          </div>
        )}
        <div className="pt-3">
          <div className="flex items-center justify-between px-3 pb-1">
            <button className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted" onClick={() => setShowProjects(!showProjects)} aria-expanded={showProjects}>
              <ChevronRight size={12} className={clsx('transition-transform', showProjects && 'rotate-90')} aria-hidden /> Projects
            </button>
            <button type="button" aria-label="New project" title="New project" onClick={() => setAddingProject(true)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface2 hover:text-fg">
              <Plus size={16} aria-hidden />
            </button>
          </div>
          {addingProject && (
            <form
              className="mb-1 flex gap-1 px-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!projectName.trim()) return;
                const p = actions.createProject({ name: projectName });
                setProjectName('');
                setAddingProject(false);
                nav(`/project/${p.id}`);
              }}
            >
              <input
                autoFocus
                aria-label="New project name"
                placeholder="Project name"
                value={projectName}
                maxLength={120}
                onChange={(e) => setProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setAddingProject(false);
                    setProjectName('');
                  }
                }}
                className="min-h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-sm text-fg placeholder:text-muted focus:border-accent-text focus:outline-none"
              />
              <Button type="submit" size="sm" variant="primary" disabled={!projectName.trim()}>Add</Button>
            </form>
          )}
          {showProjects &&
            flattenTree(tree).map((n) => (
              <NavLink key={n.project.id} to={`/project/${n.project.id}`} className={link} style={{ paddingLeft: 12 + n.depth * 14 }}>
                <Hash size={16} style={{ color: n.project.color }} aria-hidden /> <span className="truncate">{n.project.name}</span>
              </NavLink>
            ))}
          <NavLink to="/browse" className="mt-0.5 block px-3 py-1 text-xs text-muted hover:text-fg">
            Browse all &amp; archived
          </NavLink>
        </div>
      </nav>
      <div className="mt-2 space-y-1 border-t border-line pt-2">
        <NavLink to="/settings" className={link}>
          <Settings size={18} aria-hidden /> Settings
        </NavLink>
        <div className="flex items-center justify-between px-3 py-1">
          <span className="truncate text-xs text-muted">{user?.displayName}</span>
          <SyncBadge />
        </div>
      </div>
    </aside>
  );
}

function BottomNav() {
  const { pathname } = useLocation();
  const today = useTodayView();
  const dayNum = useMemo(() => parseDate(today.date).d, [today.date]);
  const tab = (to: string, label: string, icon: React.ReactNode, match: (p: string) => boolean) => {
    const active = match(pathname);
    return (
      <NavLink to={to} aria-current={active ? 'page' : undefined} className={clsx('flex min-h-[52px] min-w-[68px] flex-col items-center justify-center gap-0.5 rounded-full px-3 text-[11px]', active ? 'bg-surface2 font-semibold text-accent-text' : 'text-fg')}>
        {icon}
        {label}
      </NavLink>
    );
  };
  return (
    <>
      <button type="button" onClick={() => actions.openQuickAdd()} aria-label="Add task" className="fixed bottom-24 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-xl active:scale-95" style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
        <Plus size={28} />
      </button>
      <nav aria-label="Main" className="safe-bottom fixed inset-x-3 bottom-3 z-20 mb-0 flex items-center justify-around rounded-full border border-line bg-surface/95 p-1 shadow-xl backdrop-blur" style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
        {tab('/inbox', 'Inbox', <Inbox size={22} aria-hidden />, (p) => p.startsWith('/inbox'))}
        {tab(
          '/today',
          'Today',
          <span className="relative flex h-[22px] w-[22px] items-center justify-center rounded-[5px] border-2 border-current text-[10px] font-bold leading-none">{dayNum}</span>,
          (p) => p.startsWith('/today'),
        )}
        {tab('/upcoming', 'Upcoming', <LayoutList size={22} aria-hidden />, (p) => p.startsWith('/upcoming') || p.startsWith('/calendar'))}
        {tab('/browse', 'Browse', <Tag size={22} aria-hidden />, (p) => !/^\/(inbox|today|upcoming|calendar)/.test(p))}
      </nav>
    </>
  );
}

export function Shell() {
  const isDesktop = useIsDesktop();
  useShortcuts();
  return (
    <div className="flex h-dvh">
      {isDesktop && <Sidebar />}
      <main id="main" className="min-w-0 flex-1 overflow-y-auto scroll-thin" tabIndex={-1}>
        <Banners />
        <div className="safe-top mx-auto max-w-3xl px-4 pb-36 md:pb-12">
          <Outlet />
        </div>
      </main>
      {!isDesktop && <BottomNav />}
      <QuickAdd />
      <TaskSheet />
      <ConflictDialog />
    </div>
  );
}

export { SyncBadge };
