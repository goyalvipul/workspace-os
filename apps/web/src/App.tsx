import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Button, Spinner, Toaster } from './components/ui';
import { setUnauthenticatedHandler } from './lib/api';
import { actions, boot, useStore } from './lib/store';
import { ArchivedPage } from './pages/archived';
import { startSync } from './lib/sync';
import { ActivityPage } from './pages/activity';
import { LoginPage, SetupPage } from './pages/auth';
import { CalendarPage } from './pages/calendar';
import { BrowsePage, FilterTasksPage, LabelsPage, LabelTasksPage, SearchPage, TemplatesPage } from './pages/organize';
import { ProjectPage } from './pages/project';
import { SettingsPage } from './pages/settings';
import { InboxPage, TodayPage, UpcomingPage } from './pages/views';

// "/?add=Buy milk tomorrow" (from a Siri / Shortcuts "Open URL" action or the installed app's "Add task" shortcut) opens Quick Add pre-filled.
let launchAdd: string | null = (() => {
  try { return new URLSearchParams(window.location.search).get('add'); } catch { return null; }
})();

function LaunchActions() {
  const status = useStore((s) => s.status);
  useEffect(() => {
    if (status !== 'authed' || launchAdd === null) return;
    const text = launchAdd === '1' ? '' : launchAdd;
    launchAdd = null;
    actions.openQuickAdd(text ? { text } : null);
  }, [status]);
  return null;
}

/** Opens the view chosen in Settings → General → Home view. */
function HomeRedirect() {
  const view = useStore((s) => s.prefs['general.homeView'] as string);
  return <Navigate to={`/${view || 'today'}`} replace />;
}

function Gate() {
  const status = useStore((s) => s.status);
  const loc = useLocation();
  if (status === 'boot') return <div className="flex min-h-dvh items-center justify-center"><Spinner label="Loading Workspace OS" /></div>;
  if (status === 'anon') return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <Shell />;
}

function UpdateBanner() {
  const [apply, setApply] = useState<(() => void) | null>(null);
  useEffect(() => {
    const on = (e: Event) => setApply(() => (e as CustomEvent<() => void>).detail);
    window.addEventListener('wos:update-available', on);
    return () => window.removeEventListener('wos:update-available', on);
  }, []);
  if (!apply) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-[90] flex items-center justify-center gap-3 bg-surface2 px-4 py-2 text-sm shadow">
      A new version is ready.
      <Button size="sm" variant="primary" onClick={apply}>Update now</Button>
      <Button size="sm" variant="ghost" onClick={() => setApply(null)}>Later</Button>
    </div>
  );
}

export function App() {
  const qc = useQueryClient();
  useEffect(() => {
    setUnauthenticatedHandler(() => useStore.setState({ sessionExpired: true, status: 'anon' }));
    void boot();
    return startSync(qc);
  }, [qc]);
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[100] focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg">Skip to content</a>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route element={<Gate />}>
          <Route index element={<HomeRedirect />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="today" element={<TodayPage />} />
          <Route path="upcoming" element={<UpcomingPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="project/:id" element={<ProjectPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="browse" element={<BrowsePage />} />
          <Route path="labels" element={<LabelsPage />} />
          <Route path="label/:id" element={<LabelTasksPage />} />
          <Route path="filter/:id" element={<FilterTasksPage />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="archived" element={<ArchivedPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/:section" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Route>
      </Routes>
      <UpdateBanner />
      <LaunchActions />
      <Toaster />
    </>
  );
}
