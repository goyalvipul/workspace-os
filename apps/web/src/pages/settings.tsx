import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Bell, CalendarDays, ChevronRight, Database, Info, LifeBuoy, LogOut, Mic, Palette, RefreshCw, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Stethoscope, Target, Trash2, User as UserIcon, Clock, Archive } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { passwordSchema, type CalendarAccountDTO, type CalendarProviderInfo, type SyncStatusDTO } from '@wos/shared';
import { PageHeader } from '../components/PageHeader';
import { Digests, General, Help, Integrations, Productivity, Reminders, Row, WhatsNew } from './settings-extra';
import { Button, Confirm, EmptyState, Field, Input, Segmented, Select, Sheet, SheetHeader, Spinner, Switch, clsx } from '../components/ui';
import { api, download, errorMessage } from '../lib/api';
import { useExternalCalendars, useHour12, useTz } from '../lib/hooks';
import { actions, applyTheme, logout, refresh, toast, useStore } from '../lib/store';

const SECTIONS: { id: string; label: string; icon: ReactNode; hint: string }[] = [
  { id: 'profile', label: 'Account', icon: <UserIcon size={20} />, hint: 'Name, email, username' },
  { id: 'general', label: 'General', icon: <Settings2 size={20} />, hint: 'Home view, dates, swipe actions, sound, sync' },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={20} />, hint: 'Theme and motion' },
  { id: 'tasks', label: 'Task defaults', icon: <SlidersHorizontal size={20} />, hint: 'Priority, reminders, quick add' },
  { id: 'productivity', label: 'Productivity', icon: <Target size={20} />, hint: 'Karma, daily and weekly goals, days off, vacation' },
  { id: 'datetime', label: 'Date & time', icon: <Clock size={20} />, hint: 'Time zone, week start, clock' },
  { id: 'reminders', label: 'Reminders', icon: <AlarmClock size={20} />, hint: 'Snooze, automatic reminders, channel' },
  { id: 'notifications', label: 'Notifications', icon: <Bell size={20} />, hint: 'Push, morning overview, evening review' },
  { id: 'integrations', label: 'Siri & Apple Watch', icon: <Mic size={20} />, hint: 'Add tasks by voice with Shortcuts' },
  { id: 'accounts', label: 'Connected accounts', icon: <CalendarDays size={20} />, hint: 'Google and Microsoft calendars (read-only)' },
  { id: 'diagnostics', label: 'Sync diagnostics', icon: <Stethoscope size={20} />, hint: 'Calendar sync health' },
  { id: 'data', label: 'Import & export', icon: <Database size={20} />, hint: 'JSON, CSV, Todoist' },
  { id: 'backup', label: 'Backups', icon: <Archive size={20} />, hint: 'Create and download backups' },
  { id: 'security', label: 'Security', icon: <ShieldCheck size={20} />, hint: 'Password and sessions' },
  { id: 'whatsnew', label: "What's new", icon: <Sparkles size={20} />, hint: 'Recent changes' },
  { id: 'help', label: 'Help & feedback', icon: <LifeBuoy size={20} />, hint: 'Quick add syntax, gestures, troubleshooting' },
  { id: 'about', label: 'About', icon: <Info size={20} />, hint: 'Version and build' },
];

export function SettingsPage() {
  const { section } = useParams();
  const current = SECTIONS.find((s) => s.id === section);
  if (!current) {
    return (
      <>
        <PageHeader title="Settings" back="/browse" />
        <ul className="space-y-0.5">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <Link to={`/settings/${s.id}`} className="flex min-h-14 items-center gap-3 rounded-lg px-3 hover:bg-surface2">
                <span className="text-muted" aria-hidden>{s.icon}</span>
                <span className="flex-1"><span className="block">{s.label}</span><span className="block text-xs text-muted">{s.hint}</span></span>
                <ChevronRight size={16} className="text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-6 px-3"><Button onClick={() => void logout()}><LogOut size={16} aria-hidden /> Sign out</Button></div>
      </>
    );
  }
  return (
    <>
      <PageHeader title={current.label} back="/settings" />
      <div className="max-w-xl space-y-5">
        {section === 'profile' && <Profile />}
        {section === 'general' && <General />}
        {section === 'appearance' && <Appearance />}
        {section === 'tasks' && <TaskDefaults />}
        {section === 'productivity' && <Productivity />}
        {section === 'datetime' && <DateTime />}
        {section === 'reminders' && <Reminders />}
        {section === 'notifications' && <Notifications />}
        {section === 'integrations' && <Integrations />}
        {section === 'whatsnew' && <WhatsNew />}
        {section === 'help' && <Help />}
        {section === 'accounts' && <Accounts />}
        {section === 'diagnostics' && <Diagnostics />}
        {section === 'data' && <ImportExport />}
        {section === 'backup' && <Backups />}
        {section === 'security' && <Security />}
        {section === 'about' && <About />}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- profile
function Profile() {
  const user = useStore((s) => s.user);
  const [name, setName] = useState(user?.displayName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await actions.patchProfile({ displayName: name.trim(), email: email.trim() || null }); toast('Profile saved', 'success'); } catch (x) { toast(errorMessage(x), 'error'); } finally { setBusy(false); } }}>
      <Field label="Username" hint="Usernames cannot be changed."><Input value={user?.username ?? ''} readOnly disabled /></Field>
      <Field label="Display name" htmlFor="pn"><Input id="pn" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required /></Field>
      <Field label="Email (optional)" htmlFor="pe"><Input id="pe" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Button type="submit" variant="primary" disabled={busy || !name.trim()}>Save</Button>
    </form>
  );
}

// ---------------------------------------------------------------- appearance
function Appearance() {
  const theme = useStore((s) => s.user?.theme ?? 'dark');
  const motion = useStore((s) => (s.prefs['ui.reducedMotion'] as string) ?? 'system');
  return (
    <>
      <Row label="Theme"><Segmented label="Theme" value={theme} onChange={(v) => { applyTheme(v); void actions.patchProfile({ theme: v }); }} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'System' }]} /></Row>
      <Row label="Reduce motion" hint="Follows your device setting by default."><Segmented label="Reduce motion" value={motion as 'system' | 'on' | 'off'} onChange={(v) => void actions.setPref('ui.reducedMotion', v)} options={[{ value: 'system', label: 'Auto' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} /></Row>
    </>
  );
}

// ---------------------------------------------------------------- task defaults
function TaskDefaults() {
  const prefs = useStore((s) => s.prefs);
  const set = (k: string, v: unknown) => void actions.setPref(k, v);
  return (
    <>
      <Row label="Default priority"><Select aria-label="Default priority" className="w-32" value={String(prefs['tasks.defaultPriority'])} onChange={(e) => set('tasks.defaultPriority', Number(e.target.value))}>{[1, 2, 3, 4].map((p) => <option key={p} value={p}>Priority {p}</option>)}</Select></Row>
      <Row label="Default reminder time" hint="Used for date-only tasks with a reminder."><Input aria-label="Default reminder time" type="time" className="w-32" value={String(prefs['tasks.defaultReminderTime'])} onChange={(e) => e.target.value && set('tasks.defaultReminderTime', e.target.value)} /></Row>
      <Row label="Remember last project" hint="Quick add starts in the project you used last."><Switch label="Remember last project" checked={!!prefs['tasks.rememberLastProject']} onChange={(v) => set('tasks.rememberLastProject', v)} /></Row>
      <Row label="Ask when completing a parent" hint="Offer to complete open subtasks too."><Switch label="Ask when completing a parent" checked={!!prefs['tasks.completeParentPrompt']} onChange={(v) => set('tasks.completeParentPrompt', v)} /></Row>
      <Row label="Quick add shortcut" hint="Single key, when not typing."><Input aria-label="Quick add shortcut" className="w-16 text-center" maxLength={1} value={String(prefs['shortcuts.quickAdd'])} onChange={(e) => e.target.value.trim() && set('shortcuts.quickAdd', e.target.value.trim().toLowerCase())} /></Row>
      <Row label="Today: show completed"><Switch label="Show completed on Today" checked={!!prefs['display.todayShowCompleted']} onChange={(v) => set('display.todayShowCompleted', v)} /></Row>
      <Row label="Today: sort"><Select aria-label="Today sort" className="w-36" value={String(prefs['display.todaySort'])} onChange={(e) => set('display.todaySort', e.target.value)}><option value="time">Time</option><option value="priority">Priority</option><option value="project">Project</option><option value="manual">Manual</option></Select></Row>
    </>
  );
}

// ---------------------------------------------------------------- date & time
function DateTime() {
  const user = useStore((s) => s.user);
  const zones = useMemo(() => {
    const list: string[] = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['America/Vancouver', 'UTC'];
    return user && !list.includes(user.timezone) ? [user.timezone, ...list] : list;
  }, [user]);
  if (!user) return null;
  const save = (p: Parameters<typeof actions.patchProfile>[0]) => void actions.patchProfile(p).catch((e) => toast(errorMessage(e), 'error'));
  return (
    <>
      <Row label="Time zone" hint="All Today/Upcoming days use this zone."><Select aria-label="Time zone" className="w-56" value={user.timezone} onChange={(e) => save({ timezone: e.target.value })}>{zones.map((z) => <option key={z}>{z}</option>)}</Select></Row>
      <Row label="Week starts on"><Segmented label="Week starts on" value={String(user.weekStartsOn) as '0' | '1'} onChange={(v) => save({ weekStartsOn: Number(v) as 0 | 1 })} options={[{ value: '1', label: 'Monday' }, { value: '0', label: 'Sunday' }]} /></Row>
      <Row label="Clock"><Segmented label="Clock" value={user.timeFormat} onChange={(v) => save({ timeFormat: v })} options={[{ value: '12h', label: '12-hour' }, { value: '24h', label: '24-hour' }]} /></Row>
    </>
  );
}

// ---------------------------------------------------------------- notifications
function b64ToU8(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function Notifications() {
  const prefs = useStore((s) => s.prefs);
  const qc = useQueryClient();
  const cfg = useQuery<{ configured: boolean; publicKey: string | null; subscriptions: number }>({ queryKey: ['push-config'], queryFn: () => api('GET', '/push/config') });
  const list = useQuery<{ unread: number; items: { id: string; kind: string; title: string; body: string; createdAt: string; readAt: string | null }[] }>({ queryKey: ['notifications'], queryFn: () => api('GET', '/notifications') });
  const supported = typeof Notification !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
  const [perm, setPerm] = useState(() => (typeof Notification !== 'undefined' ? Notification.permission : 'denied'));
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const standalone = matchMedia('(display-mode: standalone)').matches;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  useEffect(() => {
    if (!supported) return;
    void navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => setSubscribed(!!s)).catch(() => undefined);
  }, [supported]);
  const enable = async () => {
    if (!cfg.data?.publicKey) return;
    setBusy(true);
    try {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== 'granted') { toast('Notifications were not allowed on this device.', 'error'); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(cfg.data.publicKey) as BufferSource });
      const j = sub.toJSON();
      await api('POST', '/push/subscribe', { endpoint: j.endpoint, keys: j.keys, deviceName: ios ? 'iPhone' : navigator.platform });
      setSubscribed(true);
      void qc.invalidateQueries({ queryKey: ['push-config'] });
      toast('Push notifications enabled', 'success');
    } catch (x) { toast(errorMessage(x), 'error'); } finally { setBusy(false); }
  };
  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await api('POST', '/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
      setSubscribed(false);
      void qc.invalidateQueries({ queryKey: ['push-config'] });
    } catch (x) { toast(errorMessage(x), 'error'); } finally { setBusy(false); }
  };
  return (
    <>
      <section aria-label="Push notifications" className="rounded-xl bg-surface p-4">
        <h2 className="font-semibold">Push notifications</h2>
        {!cfg.data?.configured && !cfg.isLoading && <p className="mt-1 text-sm text-warn">Push is not configured on the server (VAPID keys missing). See docs/PWA_MOBILE.md.</p>}
        {ios && !standalone && <p className="mt-1 text-sm text-warn">On iPhone, add this app to your Home Screen first (Share &rarr; Add to Home Screen), then open it from there to enable push.</p>}
        {!supported && <p className="mt-1 text-sm text-muted">This browser does not support web push.</p>}
        {perm === 'denied' && supported && <p className="mt-1 text-sm text-muted">Notifications are blocked for this site in your device settings.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {!subscribed ? <Button variant="primary" disabled={!supported || !cfg.data?.configured || busy || perm === 'denied'} onClick={enable}>Enable on this device</Button> : <Button onClick={disable} disabled={busy}>Disable on this device</Button>}
          <Button disabled={!subscribed || busy} onClick={async () => { try { const r = await api<{ sent: number }>('POST', '/push/test'); toast(r.sent ? 'Test sent' : 'No device received it', r.sent ? 'success' : 'error'); } catch (x) { toast(errorMessage(x), 'error'); } }}>Send test</Button>
        </div>
        <p className="mt-2 text-xs text-muted">{cfg.data?.subscriptions ?? 0} device(s) registered.</p>
      </section>
      <Row label="Late reminder grace" hint="Skip reminders older than this after downtime (minutes)."><Input aria-label="Late grace minutes" type="number" min={0} max={1440} className="w-24" value={Number(prefs['notifications.lateGraceMinutes'])} onChange={(e) => { const n = Number(e.target.value); if (n >= 0 && n <= 1440) void actions.setPref('notifications.lateGraceMinutes', n); }} /></Row>
      <Digests />
      <section aria-label="Recent notifications">
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Recent</h2>{(list.data?.unread ?? 0) > 0 && <Button size="sm" variant="ghost" onClick={async () => { await api('POST', '/notifications/read', { id: null }); void list.refetch(); }}>Mark all read</Button>}</div>
        {list.isLoading ? <Spinner /> : !list.data?.items.length ? <p className="py-3 text-sm text-muted">Nothing yet.</p> : (
          <ul>{list.data.items.map((n) => <li key={n.id} className={clsx('flex items-center gap-3 border-b border-line/60 py-2 text-sm', !n.readAt && 'font-medium')}><span className="min-w-0 flex-1">{n.title}<span className="block text-xs font-normal text-muted">{n.body}</span></span>{n.kind === 'reminder' && <Button size="sm" variant="ghost" aria-label={`Snooze ${n.title}`} onClick={async () => { const m = Number(prefs['reminders.snoozeMinutes'] ?? 15); try { await api('POST', `/notifications/${n.id}/snooze`, { minutes: m }); toast(`Snoozed for ${m} minutes`, 'success'); void list.refetch(); } catch (x) { toast(errorMessage(x), 'error'); } }}>Snooze</Button>}</li>)}</ul>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------- connected accounts
function Accounts() {
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const hour12 = useHour12();
  const tz = useTz();
  const providers = useQuery<{ items: CalendarProviderInfo[] }>({ queryKey: ['calendar', 'providers'], queryFn: () => api('GET', '/calendar/providers') });
  const accounts = useQuery<{ items: CalendarAccountDTO[] }>({ queryKey: ['calendar', 'accounts'], queryFn: () => api('GET', '/calendar/accounts') });
  const cals = useExternalCalendars();
  const [disc, setDisc] = useState<CalendarAccountDTO | null>(null);
  const [guide, setGuide] = useState<CalendarProviderInfo | null>(null);
  const online = useStore((s) => s.online);
  useEffect(() => {
    if (sp.get('connected')) { toast('Account connected. Choose which calendars to show below.', 'success'); void qc.invalidateQueries({ queryKey: ['calendar'] }); setSp({}, { replace: true }); }
    else if (sp.get('error')) { toast(`Could not connect: ${sp.get('error')}`, 'error'); setSp({}, { replace: true }); }
  }, [sp, setSp, qc]);
  const inval = () => void qc.invalidateQueries({ queryKey: ['calendar'] });
  const connect = async (p: CalendarProviderInfo, reconnect?: string) => {
    if (!p.configured) { setGuide(p); return; }
    try { const r = await api<{ authorizationUrl: string }>('POST', '/calendar/accounts/connect', { provider: p.provider, reconnectAccountId: reconnect }); window.location.assign(r.authorizationUrl); } catch (x) { toast(errorMessage(x), 'error'); }
  };
  return (
    <>
      <p className="text-sm text-muted">Calendars are read-only. Workspace OS never creates, edits or deletes events in Google or Microsoft.</p>
      <div className="flex flex-wrap gap-2">
        {providers.data?.items.map((p) => <Button key={p.provider} variant="primary" disabled={!online} onClick={() => connect(p)}>Connect {p.label}{!p.configured && ' (setup needed)'}</Button>)}
      </div>
      {accounts.isLoading && <Spinner />}
      {!accounts.isLoading && !accounts.data?.items.length && <EmptyState title="No calendars connected" body="Connect an account to see meetings next to your tasks." art={false} />}
      <ul className="space-y-3">
        {accounts.data?.items.map((a) => {
          const mine = cals.data?.items.filter((c) => c.accountId === a.id) ?? [];
          return (
            <li key={a.id} className="rounded-xl bg-surface p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1"><p className="font-medium">{a.displayEmail ?? a.displayName ?? a.provider}</p><p className="text-xs text-muted">{a.provider === 'google' ? 'Google' : 'Microsoft'} &middot; {a.status === 'connected' ? 'Connected' : a.status === 'reauth_required' ? 'Reconnect required' : a.status}</p>{a.lastError && <p className="text-xs text-danger">{a.lastError}</p>}</div>
                {a.status !== 'connected' && <Button size="sm" variant="primary" onClick={() => { const p = providers.data?.items.find((x) => x.provider === a.provider); if (p) void connect(p, a.id); }}>Reconnect</Button>}
                <Button size="sm" variant="ghost" onClick={async () => { await api('POST', `/calendar/accounts/${a.id}/discover`); toast('Refreshing calendar list', 'info'); setTimeout(inval, 2500); }}><RefreshCw size={14} aria-hidden /> Refresh list</Button>
                <Button size="sm" variant="danger" onClick={() => setDisc(a)}>Disconnect</Button>
              </div>
              <ul className="mt-3 space-y-1">
                {mine.map((c) => (
                  <li key={c.id} className="flex min-h-10 items-center gap-3 text-sm">
                    <input type="color" aria-label={`Color for ${c.displayName ?? c.name}`} value={c.color} onChange={(e) => void api('PATCH', `/calendar/calendars/${c.id}`, { color: e.target.value }).then(inval)} className="h-6 w-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" />
                    <span className="flex-1 truncate">{c.displayName ?? c.name}{c.isPrimary && <span className="text-xs text-muted"> (primary)</span>}</span>
                    <span className="text-xs text-muted">{c.syncHealth === 'ok' ? (c.lastSuccessAt ? new Date(c.lastSuccessAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12, timeZone: tz }) : 'ok') : c.syncHealth}</span>
                    <Switch label={`Show ${c.displayName ?? c.name}`} checked={c.isSelected} onChange={(v) => void api('PATCH', `/calendar/calendars/${c.id}`, { isSelected: v }).then(inval)} />
                  </li>
                ))}
                {!mine.length && <li className="text-sm text-muted">No calendars found yet.</li>}
              </ul>
            </li>
          );
        })}
      </ul>
      <Confirm open={!!disc} onOpenChange={(o) => !o && setDisc(null)} danger title="Disconnect this account?" body="Tokens are deleted. Cached events are also removed from this app. Your provider calendar is not changed." confirmLabel="Disconnect" onConfirm={async () => { if (!disc) return; try { await api('DELETE', `/calendar/accounts/${disc.id}?deleteCache=true`); inval(); } catch (x) { toast(errorMessage(x), 'error'); } }} />
      {guide && (
        <Sheet open onOpenChange={(o) => !o && setGuide(null)} title={`Set up ${guide.label}`}>
          <SheetHeader title={`Set up ${guide.label}`} onClose={() => setGuide(null)} />
          <div className="space-y-3 overflow-auto p-4 text-sm">
            <p>{guide.guidance}</p>
            <p>Redirect URI to register with the provider:</p>
            <code className="block break-all rounded bg-surface p-2">{guide.redirectUri}</code>
            <p>Read-only scopes requested:</p>
            <ul className="list-disc pl-5">{guide.scopes.map((s) => <li key={s}><code>{s}</code></li>)}</ul>
            <p>Missing environment values: {guide.missingEnv.map((m) => <code key={m} className="mr-1 rounded bg-surface px-1">{m}</code>)}</p>
            <p className="text-muted">Add them to <code>.env</code>, restart the container, then try again. Details: docs/PROVIDER_NOTES.md.</p>
          </div>
        </Sheet>
      )}
    </>
  );
}

// ---------------------------------------------------------------- diagnostics
function Diagnostics() {
  const q = useQuery<SyncStatusDTO>({ queryKey: ['calendar', 'status'], queryFn: () => api('GET', '/calendar/status'), refetchInterval: 8000 });
  const cals = useExternalCalendars();
  const [busy, setBusy] = useState(false);
  const d = q.data;
  return (
    <>
      <div className="flex items-center gap-2"><Button variant="primary" disabled={busy} onClick={async () => { setBusy(true); try { await api('POST', '/calendar/sync'); toast('Sync requested', 'info'); setTimeout(() => void q.refetch(), 2000); } catch (x) { toast(errorMessage(x), 'error'); } finally { setBusy(false); } }}><RefreshCw size={14} aria-hidden /> Sync now</Button></div>
      {q.isLoading ? <Spinner /> : d && (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {[['Accounts', d.accounts], ['Calendars shown', d.calendars], ['Queued jobs', d.queued], ['Running jobs', d.running], ['Last success', d.lastSuccessAt ? new Date(d.lastSuccessAt).toLocaleString() : 'never'], ['Oldest data', d.oldestStaleSeconds == null ? 'n/a' : `${Math.round(d.oldestStaleSeconds / 60)} min`]].map(([k, v]) => <div key={String(k)} className="rounded-xl bg-surface p-3"><dt className="text-xs text-muted">{k}</dt><dd className="font-medium">{v}</dd></div>)}
        </dl>
      )}
      <h2 className="text-sm font-semibold">Calendars</h2>
      <ul className="space-y-1 text-sm">
        {cals.data?.items.filter((c) => c.isSelected).map((c) => <li key={c.id} className="rounded-lg bg-surface p-3"><span className="font-medium">{c.displayName ?? c.name}</span> <span className="text-muted">({c.accountLabel})</span><br /><span className="text-xs text-muted">health: {c.syncHealth}{c.isStale ? ' (stale)' : ''} &middot; last success: {c.lastSuccessAt ? new Date(c.lastSuccessAt).toLocaleString() : 'never'}{c.lastErrorCode ? ` &middot; error: ${c.lastErrorCode}` : ''}</span>{c.lastErrorMessage && <span className="block text-xs text-danger">{c.lastErrorMessage}</span>}</li>)}
        {!cals.data?.items.some((c) => c.isSelected) && <li className="text-muted">No calendars selected.</li>}
      </ul>
      <h2 className="text-sm font-semibold">Recent jobs</h2>
      <ul className="space-y-1 text-xs text-muted">{d?.recentJobs.slice(0, 12).map((j) => <li key={j.id}>{new Date(j.requestedAt).toLocaleTimeString()} &middot; {j.kind} &middot; {j.status}{j.lastErrorCode ? ` (${j.lastErrorCode})` : ''}{j.attemptCount > 1 ? ` &middot; attempt ${j.attemptCount}` : ''}</li>)}</ul>
    </>
  );
}

// ---------------------------------------------------------------- import / export
interface ImportSummary { projects: number; sections: number; labels: number; tasks: number; subtasks?: number; comments?: number; warnings?: string[]; [k: string]: unknown }

function ImportExport() {
  const [kind, setKind] = useState<'todoist_csv' | 'wos_csv'>('todoist_csv');
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [prev, setPrev] = useState<{ summary: ImportSummary; previewToken: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [wsConfirm, setWsConfirm] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<HTMLInputElement>(null);
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (x) { toast(errorMessage(x), 'error'); } finally { setBusy(false); } };
  return (
    <>
      <section className="space-y-2" aria-label="Export">
        <h2 className="font-semibold">Export</h2>
        <p className="text-sm text-muted">Exports never include passwords, sessions, or calendar tokens.</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void run(() => download('/export/workspace.json', 'workspace-os-export.json'))}>Workspace JSON</Button>
          <Button onClick={() => void run(() => download('/export/tasks.csv', 'workspace-os-tasks.csv'))}>Tasks CSV</Button>
        </div>
      </section>
      <section className="space-y-3 border-t border-line pt-5" aria-label="Import CSV">
        <h2 className="font-semibold">Import tasks from CSV</h2>
        <Field label="Source" htmlFor="ik"><Select id="ik" value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setPrev(null); }}><option value="todoist_csv">Todoist CSV export</option><option value="wos_csv">Workspace OS CSV</option></Select></Field>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="CSV file" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 8_000_000) { toast('File is too large (8 MB max).', 'error'); return; } setContent(await f.text()); setFileName(f.name); setPrev(null); e.target.value = ''; }} />
        <div className="flex items-center gap-3"><Button onClick={() => fileRef.current?.click()}>Choose file</Button><span className="truncate text-sm text-muted">{fileName || 'No file chosen'}</span></div>
        <Button variant="primary" disabled={!content || busy} onClick={() => void run(async () => setPrev(await api('POST', '/imports/preview', { kind, content })))}>Preview import</Button>
        {prev && (
          <div className="rounded-xl bg-surface p-3 text-sm" aria-live="polite">
            <p className="font-medium">Ready to import: {prev.summary.tasks} tasks, {prev.summary.projects} projects, {prev.summary.sections} sections, {prev.summary.labels} labels</p>
            {prev.summary.warnings?.slice(0, 5).map((w, i) => <p key={i} className="text-warn">{w}</p>)}
            <Button className="mt-3" variant="primary" disabled={busy} onClick={() => void run(async () => { await api('POST', '/imports/apply', { kind, content, previewToken: prev.previewToken }, { idempotencyKey: prev.previewToken }); await refresh(true); toast('Import complete', 'success'); setPrev(null); setContent(''); setFileName(''); })}>Import now</Button>
          </div>
        )}
      </section>
      <section className="space-y-2 border-t border-line pt-5" aria-label="Restore JSON">
        <h2 className="font-semibold">Restore from workspace JSON</h2>
        <p className="text-sm text-muted">Merges an export into this workspace. Existing items with the same id are reported, not overwritten.</p>
        <input ref={wsRef} type="file" accept=".json,application/json" className="sr-only" aria-label="Workspace JSON file" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { setWsConfirm(JSON.parse(await f.text())); } catch { toast('That file is not valid JSON.', 'error'); } e.target.value = ''; }} />
        <Button onClick={() => wsRef.current?.click()}>Choose JSON file</Button>
      </section>
      <Confirm open={!!wsConfirm} onOpenChange={(o) => !o && setWsConfirm(null)} title="Restore this export?" body="Items are merged into your current workspace." confirmLabel="Restore" onConfirm={() => void run(async () => { const r = await api<Record<string, unknown>>('POST', '/imports/workspace', { data: wsConfirm, confirm: true }); await refresh(true); toast(`Restore finished${r.conflicts ? ` (${String(r.conflicts)} conflicts)` : ''}`, 'success'); })} />
    </>
  );
}

// ---------------------------------------------------------------- backups
interface BackupRow { id: string; kind: string; status: string; filename: string | null; sizeBytes: number | null; startedAt: string; error: string | null }

function Backups() {
  const q = useQuery<{ items: BackupRow[] }>({ queryKey: ['backups'], queryFn: () => api('GET', '/backups') });
  const [busy, setBusy] = useState(false);
  const [dl, setDl] = useState<BackupRow | null>(null);
  const [pw, setPw] = useState('');
  return (
    <>
      <p className="text-sm text-muted">Backups are consistent SQLite snapshots (gzip, checksummed). The server also creates one daily. Restore is done from the host with <code>scripts/restore.ps1</code>; see docs/BACKUP_RESTORE.md.</p>
      <Button variant="primary" disabled={busy} onClick={async () => { setBusy(true); try { await api('POST', '/backups'); toast('Backup created', 'success'); void q.refetch(); } catch (x) { toast(errorMessage(x), 'error'); } finally { setBusy(false); } }}>Back up now</Button>
      {q.isLoading ? <Spinner /> : (
        <ul className="divide-y divide-line/60">
          {q.data?.items.map((b) => (
            <li key={b.id} className="flex items-center gap-3 py-3 text-sm">
              <div className="flex-1"><p>{new Date(b.startedAt).toLocaleString()} <span className="text-muted">({b.kind})</span></p><p className="text-xs text-muted">{b.status === 'ok' ? `${((b.sizeBytes ?? 0) / 1024).toFixed(0)} KB` : `failed: ${b.error ?? 'unknown'}`}</p></div>
              {b.status === 'ok' && <Button size="sm" onClick={() => { setDl(b); setPw(''); }}>Download</Button>}
            </li>
          ))}
          {!q.data?.items.length && <li className="py-3 text-muted">No backups yet.</li>}
        </ul>
      )}
      {dl && (
        <Sheet open onOpenChange={(o) => !o && setDl(null)} title="Download backup">
          <SheetHeader title="Confirm your password" onClose={() => setDl(null)} />
          <form className="space-y-3 p-4" onSubmit={async (e) => { e.preventDefault(); try { await download(`/backups/${dl.id}/download`, dl.filename ?? 'backup.sqlite.gz', 'POST', { password: pw }); setDl(null); } catch (x) { toast(errorMessage(x), 'error'); } }}>
            <p className="text-sm text-muted">Backups contain all your data. Re-enter your password to download.</p>
            <Input aria-label="Password" type="password" autoComplete="current-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
            <Button type="submit" variant="primary" disabled={!pw}>Download</Button>
          </form>
        </Sheet>
      )}
    </>
  );
}

// ---------------------------------------------------------------- security
function Security() {
  const nav = useNavigate();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [others, setOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const sessions = useQuery<{ items: { id: string; userAgent: string | null; createdAt: string; lastSeenAt: string; current: boolean }[] }>({ queryKey: ['sessions'], queryFn: () => api('GET', '/auth/sessions') });
  const pw = passwordSchema.safeParse(next);
  return (
    <>
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await api('POST', '/auth/password', { currentPassword: cur, newPassword: next, logoutOthers: others }); toast('Password changed', 'success'); setCur(''); setNext(''); void sessions.refetch(); } catch (x) { toast(errorMessage(x), 'error'); } finally { setBusy(false); } }}>
        <h2 className="font-semibold">Change password</h2>
        <Field label="Current password" htmlFor="cp"><Input id="cp" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="New password" htmlFor="np" hint="At least 12 characters with upper case, lower case and a number."><Input id="np" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        {next && !pw.success && <p role="alert" className="text-sm text-danger">{pw.error.issues[0]?.message}</p>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={others} onChange={(e) => setOthers(e.target.checked)} /> Sign out other devices</label>
        <Button type="submit" variant="primary" disabled={busy || !cur || !pw.success}>Change password</Button>
      </form>
      <section className="border-t border-line pt-5" aria-label="Sessions">
        <h2 className="font-semibold">Signed-in devices</h2>
        {sessions.isLoading ? <Spinner /> : (
          <ul className="divide-y divide-line/60">
            {sessions.data?.items.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-3 text-sm">
                <div className="flex-1"><p className="truncate">{(s.userAgent ?? 'Unknown device').slice(0, 60)}{s.current && <span className="ml-2 rounded bg-surface2 px-1.5 py-0.5 text-xs">This device</span>}</p><p className="text-xs text-muted">Last active {new Date(s.lastSeenAt).toLocaleString()}</p></div>
                {!s.current && <Button size="sm" variant="danger" onClick={async () => { await api('DELETE', `/auth/sessions/${s.id}`); void sessions.refetch(); }}>Sign out</Button>}
              </li>
            ))}
          </ul>
        )}
        <Button variant="danger" className="mt-3" onClick={() => setConfirmAll(true)}><Trash2 size={14} aria-hidden /> Sign out everywhere</Button>
      </section>
      <Confirm open={confirmAll} onOpenChange={setConfirmAll} danger title="Sign out of every device?" body="You will need to sign in again here too." confirmLabel="Sign out everywhere" onConfirm={async () => { try { await api('POST', '/auth/logout-all'); } catch { /* ignore */ } await logout(); nav('/login'); }} />
    </>
  );
}

// ---------------------------------------------------------------- about
function About() {
  const v = useQuery<{ name: string; version: string; commit?: string; builtAt?: string; node?: string; schemaVersion?: number }>({ queryKey: ['version'], queryFn: () => api('GET', '/version') });
  const ready = useQuery<{ status: string; checks?: Record<string, unknown> }>({ queryKey: ['ready'], queryFn: async () => (await fetch('/api/health/ready')).json() });
  const [updating, setUpdating] = useState(false);
  return (
    <>
      <dl className="space-y-2 text-sm">
        {v.data && Object.entries(v.data).map(([k, val]) => <div key={k} className="flex justify-between border-b border-line/60 py-2"><dt className="text-muted">{k}</dt><dd>{String(val)}</dd></div>)}
        <div className="flex justify-between border-b border-line/60 py-2"><dt className="text-muted">Server health</dt><dd>{ready.data?.status ?? '...'}</dd></div>
      </dl>
      <Button disabled={updating} onClick={async () => { setUpdating(true); try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); toast('Checked for updates', 'info'); } finally { setUpdating(false); } }}>Check for app update</Button>
      <p className="text-xs text-muted">Workspace OS is self-hosted. Your data stays on your machine.</p>
    </>
  );
}
