import { Calendar, CalendarDays, CloudOff, Hash, House, Inbox, LayoutList, ListTodo, Menu, Plus, RefreshCw, Search, Settings, WifiOff, Filter, ChevronRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
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

const navItem = 'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors hover:bg-surface2';

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
    <aside className="wos-sidebar flex w-[268px] shrink-0 flex-col border-r border-line p-3" aria-label="Sidebar">
      <div className="mb-6 flex items-center gap-3 px-2 pt-4">
        <img src="/icons/icon.svg" alt="" className="h-10 w-10 rounded-2xl bg-surface p-1 shadow-sm" />
        <span className="text-base font-extrabold tracking-tight">Workspace OS</span>
      </div>
      <button type="button" onClick={() => actions.openQuickAdd()} className="wos-sidebar-add mb-5 flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-bold hover:brightness-95">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-accent-fg">
          <Plus size={16} />
        </span>
        Add task <kbd className="ml-auto rounded bg-surface2 px-1.5 text-xs text-muted">Q</kbd>
      </button>
      <nav className="flex-1 space-y-0.5 overflow-y-auto scroll-thin" aria-label="Main">
        <NavLink to="/home" className={link}><House size={18} aria-hidden /> Home</NavLink>
        <NavLink to="/tasks" className={link}><ListTodo size={18} aria-hidden /> All tasks</NavLink>
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


const mobilePrimary = [
  { to: '/home', label: 'Home' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/today', label: 'Today' },
  { to: '/upcoming', label: 'Upcoming' },
] as const;
const mobileMore = [
  { to: '/home', label: 'Home', icon: House },
  { to: '/today', label: 'Today', icon: CalendarDays },
  { to: '/tasks', label: 'All tasks', icon: ListTodo },
  { to: '/inbox', label: 'Inbox', icon: Inbox },
  { to: '/calendar', label: 'Calendar', icon: Calendar },
  { to: '/upcoming', label: 'Upcoming', icon: LayoutList },
  { to: '/browse', label: 'Projects & browse', icon: Hash },
  { to: '/labels', label: 'Filters & labels', icon: Filter },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/activity', label: 'Activity & productivity', icon: RefreshCw },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

function MobileNav() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <>
      <header className="wos-mobile-header md:hidden">
        <button type="button" aria-label="Open navigation menu" aria-expanded={open} onClick={() => setOpen(true)} className="wos-mobile-menu">
          <Menu size={25} aria-hidden />
        </button>
        <nav aria-label="Primary pages" className="wos-mobile-pills no-scrollbar">
          {mobilePrimary.map(({ to, label }) => {
            const active = pathname === to;
            return <NavLink key={to} to={to} aria-current={active ? 'page' : undefined} className={clsx('wos-mobile-pill', active && 'wos-mobile-pill-active')}>{label}</NavLink>;
          })}
        </nav>
        <button type="button" aria-label="Search" onClick={() => navigate('/search')} className="wos-mobile-search">
          <Search size={22} aria-hidden />
        </button>
      </header>
      <Sheet open={open} onOpenChange={setOpen} title="Navigate Workspace OS">
        <div className="max-h-[85dvh] overflow-y-auto p-5">
          <div className="mb-4 flex items-center justify-between">
            <div><h2 className="text-2xl font-extrabold">Your workspace</h2><p className="mt-1 text-sm text-muted">Everything, in one place.</p></div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="wos-mobile-menu"><X size={21} aria-hidden /></button>
          </div>
          <nav aria-label="All pages" className="grid grid-cols-2 gap-2">
            {mobileMore.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} onClick={() => setOpen(false)} className={({ isActive }) => clsx('flex min-h-[64px] flex-col justify-center gap-2 rounded-2xl border border-line bg-surface p-3 text-sm font-semibold', isActive && 'border-accent-text text-accent-text')}>
                <Icon size={20} aria-hidden />{label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-5 flex items-center justify-between border-t border-line pt-3"><span className="text-xs text-muted">Connection</span><SyncBadge /></div>
        </div>
      </Sheet>
    </>
  );
}

function MobileCaptureDock() {
  const navigate = useNavigate();
  return (
    <div className="wos-capture-dock md:hidden" role="group" aria-label="Quick actions">
      <button type="button" onClick={() => actions.openQuickAdd()} aria-label="Add task" className="wos-capture-plus"><Plus size={24} aria-hidden /></button>
      <button type="button" onClick={() => actions.openQuickAdd()} className="min-w-0 flex-1 truncate py-3 text-left text-sm font-semibold text-muted">Capture a task or reminder...</button>
      <button type="button" onClick={() => navigate('/search')} aria-label="Search tasks" className="wos-capture-search"><Search size={21} aria-hidden /></button>
    </div>
  );
}

export function Shell() {
  const isDesktop = useIsDesktop();
  useShortcuts();
  return (
    <div className="flex h-dvh flex-col md:flex-row">
      {isDesktop && <Sidebar />}
      {!isDesktop && <MobileNav />}
      <main id="main" className="wos-main min-h-0 min-w-0 flex-1 overflow-y-auto scroll-thin" tabIndex={-1}>
        <Banners />
        <div className="wos-content mx-auto max-w-4xl px-4 pb-36 md:px-8 md:pb-12">
          <Outlet />
        </div>
      </main>
      {!isDesktop && <MobileCaptureDock />}
      <QuickAdd />
      <TaskSheet />
      <ConflictDialog />
    </div>
  );
}

export { SyncBadge };
