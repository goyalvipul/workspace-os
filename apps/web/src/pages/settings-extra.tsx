import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, Trash2, Volume2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SWIPE_ACTIONS, type SwipeAction } from '@wos/shared';
import { Button, Confirm, Field, Input, Segmented, Select, Spinner, Switch, clsx } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { CHANGELOG } from '../lib/changelog';
import { playTone } from '../lib/sound';
import { downloadWatchShortcut } from '../lib/watch-shortcut';
import { actions, refresh, toast, useStore } from '../lib/store';

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line/60 py-3">
      <div className="min-w-0"><p className="text-sm">{label}</p>{hint && <p className="text-xs text-muted">{hint}</p>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const usePrefs = () => {
  const prefs = useStore((s) => s.prefs);
  const set = (k: string, v: unknown) => void actions.setPref(k, v);
  return { prefs, set };
};

/** A number preference that can be edited freely and is saved (when valid) on blur / Enter. */
function NumberPref({ label, pref, min, max, width = 'w-24' }: { label: string; pref: string; min: number; max: number; width?: string }) {
  const value = useStore((s) => Number(s.prefs[pref]));
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(text));
    if (Number.isFinite(n) && n >= min && n <= max) void actions.setPref(pref, n);
    else setText(String(value));
  };
  return <Input aria-label={label} type="number" inputMode="numeric" min={min} max={max} className={clsx(width, 'text-center')} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

// ---------------------------------------------------------------- General
const SWIPE_LABEL: Record<SwipeAction, string> = { delete: 'Delete', archive: 'Archive', complete: 'Complete', tomorrow: 'Move to tomorrow', none: 'Nothing' };
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function General() {
  const { prefs, set } = usePrefs();
  const lastSyncedAt = useStore((s) => s.lastSyncedAt);
  const pending = useStore((s) => s.outbox.length);
  const online = useStore((s) => s.online);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Row label="Home view" hint="What opens when you launch the app. Saved to your account, so every device follows it.">
        <Select aria-label="Home view" className="w-36" value={String(prefs['general.homeView'])} onChange={(e) => set('general.homeView', e.target.value)}>
          <option value="today">Today</option><option value="inbox">Inbox</option><option value="upcoming">Upcoming</option><option value="calendar">Calendar</option><option value="browse">Browse</option>
        </Select>
      </Row>
      <Row label="Detect dates in task names" hint='Turns "tomorrow 5pm" or "every monday" typed in Quick Add into a due date.'>
        <Switch label="Detect dates in task names" checked={prefs['dates.detect'] !== false} onChange={(v) => set('dates.detect', v)} />
      </Row>
      <Row label="Reset sub-tasks on repeat" hint="When a repeating task is completed, its finished sub-tasks open again for the next time.">
        <Switch label="Reset sub-tasks on repeat" checked={!!prefs['tasks.resetSubtasks']} onChange={(v) => set('tasks.resetSubtasks', v)} />
      </Row>
      <Row label={'Interpret "next week" as'} hint="Used by Quick Add and the date picker.">
        <Select aria-label="Next week means" className="w-36" value={String(prefs['dates.nextWeekStart'])} onChange={(e) => set('dates.nextWeekStart', Number(e.target.value))}>
          {[1, 2, 3, 4, 5, 6, 0].map((d) => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}
        </Select>
      </Row>
      <Row label={'Interpret "weekend" as'}>
        <Segmented label="Weekend means" value={String(prefs['dates.weekendDay']) as '6' | '0'} onChange={(v) => set('dates.weekendDay', Number(v))} options={[{ value: '6', label: 'Saturday' }, { value: '0', label: 'Sunday' }]} />
      </Row>
      <Row label="Task complete sound" hint="Plays when you finish a task (needs your device volume on).">
        <div className="flex items-center gap-2">
          <Select aria-label="Task complete sound" className="w-28" value={String(prefs['sound.completeTone'])} onChange={(e) => { set('sound.completeTone', e.target.value); playTone(e.target.value); }}>
            <option value="chime">Chime</option><option value="pop">Pop</option><option value="ding">Ding</option><option value="off">Off</option>
          </Select>
          <Button size="sm" variant="ghost" aria-label="Preview sound" onClick={() => playTone(String(prefs['sound.completeTone']))}><Volume2 size={16} aria-hidden /></Button>
        </div>
      </Row>

      <h2 className="pt-4 text-sm font-semibold">Swipe actions</h2>
      <p className="text-xs text-muted">On a touch screen, swipe a task row sideways. Delete and archive can be undone from the toast.</p>
      <Row label="Swipe right">
        <Select aria-label="Swipe right action" className="w-44" value={String(prefs['swipe.right'])} onChange={(e) => set('swipe.right', e.target.value)}>
          {SWIPE_ACTIONS.map((a) => <option key={a} value={a}>{SWIPE_LABEL[a]}</option>)}
        </Select>
      </Row>
      <Row label="Swipe left">
        <Select aria-label="Swipe left action" className="w-44" value={String(prefs['swipe.left'])} onChange={(e) => set('swipe.left', e.target.value)}>
          {SWIPE_ACTIONS.map((a) => <option key={a} value={a}>{SWIPE_LABEL[a]}</option>)}
        </Select>
      </Row>

      <h2 className="pt-4 text-sm font-semibold">Sync</h2>
      <Row label={online ? 'Connected' : 'Offline'} hint={`${lastSyncedAt ? `Last synced ${new Date(lastSyncedAt).toLocaleTimeString()}` : 'Not synced yet'} · ${pending ? `${pending} change${pending === 1 ? '' : 's'} waiting to upload` : 'nothing waiting to upload'}`}>
        <Button size="sm" disabled={busy || !online} onClick={async () => { setBusy(true); try { await refresh(true); toast('Synced', 'success'); } finally { setBusy(false); } }}>Sync now</Button>
      </Row>
      <p className="pt-2 text-sm"><Link to="/archived" className="text-accent-text underline">Open archived tasks</Link></p>
    </>
  );
}

// ---------------------------------------------------------------- Productivity
export function Productivity() {
  const { prefs, set } = usePrefs();
  const on = !!prefs['productivity.karma'];
  const off = (prefs['productivity.daysOff'] as number[]) ?? [];
  return (
    <>
      <Row label="Use Karma" hint="Track daily and weekly goals, goal streaks and a karma level.">
        <Switch label="Use Karma" checked={on} onChange={(v) => set('productivity.karma', v)} />
      </Row>
      {on && (
        <>
          <Row label="Daily goal" hint="Tasks to complete each day."><NumberPref label="Daily goal" pref="productivity.dailyGoal" min={1} max={100} /></Row>
          <Row label="Weekly goal" hint="Tasks to complete each week."><NumberPref label="Weekly goal" pref="productivity.weeklyGoal" min={1} max={700} /></Row>
          <Row label="Goal celebrations" hint="A sound and a message when you reach a goal.">
            <Switch label="Goal celebrations" checked={!!prefs['productivity.celebrations']} onChange={(v) => set('productivity.celebrations', v)} />
          </Row>
          <div className="border-b border-line/60 py-3">
            <p className="text-sm">Days off</p>
            <p className="mb-2 text-xs text-muted">Days off never break your streak.</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days off">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <button key={d} type="button" aria-pressed={off.includes(d)} onClick={() => set('productivity.daysOff', off.includes(d) ? off.filter((x) => x !== d) : [...off, d].sort())} className={clsx('min-h-9 rounded-full px-3 text-sm', off.includes(d) ? 'bg-accent text-accent-fg' : 'bg-surface2')}>
                  {(DAY_NAMES[d] as string).slice(0, 3)}
                </button>
              ))}
            </div>
          </div>
          <Row label="Vacation mode" hint="Pause goals, celebrations and digests while you are away. Your streak is protected.">
            <Switch label="Vacation mode" checked={!!prefs['productivity.vacation']} onChange={(v) => set('productivity.vacation', v)} />
          </Row>
          <p className="pt-3 text-sm"><Link to="/activity" className="text-accent-text underline">See your progress in Activity</Link></p>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Reminders
export function Reminders() {
  const { prefs, set } = usePrefs();
  return (
    <>
      <Row label="Remind me via" hint="Push needs the device enabled under Notifications.">
        <Segmented label="Remind me via" value={prefs['reminders.via'] as 'both' | 'push' | 'inapp'} onChange={(v) => set('reminders.via', v)} options={[{ value: 'both', label: 'Both' }, { value: 'push', label: 'Push' }, { value: 'inapp', label: 'In-app' }]} />
      </Row>
      <Row label="Automatic reminders" hint="Add a reminder to every new task that has a due time.">
        <Select aria-label="Automatic reminders" className="w-44" value={String(prefs['reminders.auto'])} onChange={(e) => set('reminders.auto', e.target.value)}>
          <option value="none">Off</option><option value="0">At the due time</option><option value="10">10 minutes before</option><option value="30">30 minutes before</option><option value="60">1 hour before</option>
        </Select>
      </Row>
      <Row label="When snoozed, remind me again in" hint="Used by the Snooze button on a reminder.">
        <Select aria-label="Snooze duration" className="w-36" value={String(prefs['reminders.snoozeMinutes'])} onChange={(e) => set('reminders.snoozeMinutes', Number(e.target.value))}>
          {[5, 10, 15, 30, 60, 120, 240].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`}</option>)}
        </Select>
      </Row>
      <Row label="Default reminder time" hint="Used for date-only tasks that have a reminder.">
        <Input aria-label="Default reminder time (reminders)" type="time" className="w-32" value={String(prefs['tasks.defaultReminderTime'])} onChange={(e) => e.target.value && set('tasks.defaultReminderTime', e.target.value)} />
      </Row>
      <p className="pt-3 text-sm"><Link to="/settings/notifications" className="text-accent-text underline">Set up push on this device</Link></p>
    </>
  );
}

// ---------------------------------------------------------------- Daily digests (rendered inside Notifications)
export function Digests() {
  const { prefs, set } = usePrefs();
  return (
    <section aria-label="Daily digests" className="mt-2">
      <h2 className="pt-2 text-sm font-semibold">Daily digests</h2>
      <Row label="Morning overview" hint="What is on your plate today.">
        <div className="flex items-center gap-3">
          <Input aria-label="Morning overview time" type="time" className="w-28" disabled={!prefs['notifications.morningEnabled']} value={String(prefs['notifications.morningTime'])} onChange={(e) => e.target.value && set('notifications.morningTime', e.target.value)} />
          <Switch label="Morning overview" checked={!!prefs['notifications.morningEnabled']} onChange={(v) => set('notifications.morningEnabled', v)} />
        </div>
      </Row>
      <Row label="Evening review" hint="What you finished, and what is still open.">
        <div className="flex items-center gap-3">
          <Input aria-label="Evening review time" type="time" className="w-28" disabled={!prefs['notifications.eveningEnabled']} value={String(prefs['notifications.eveningTime'])} onChange={(e) => e.target.value && set('notifications.eveningTime', e.target.value)} />
          <Switch label="Evening review" checked={!!prefs['notifications.eveningEnabled']} onChange={(v) => set('notifications.eveningEnabled', v)} />
        </div>
      </Row>
    </section>
  );
}

// ---------------------------------------------------------------- Siri, Shortcuts & Apple Watch
export interface TokenItem { id: string; name: string; scope?: 'capture' | 'creatoros'; hint: string; createdAt: string; lastUsedAt: string | null }

export function Code({ children }: { children: ReactNode }) {
  return <code className="break-all rounded bg-surface2 px-1.5 py-0.5 text-[12px]">{children}</code>;
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" aria-label={label} onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { toast('Copy is not available here. Select the text and copy it by hand.', 'error'); } }}>
      {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {done ? 'Copied' : 'Copy'}
    </Button>
  );
}

export function Integrations() {
  const qc = useQueryClient();
  const origin = window.location.origin;
  const endpoint = `${origin}/api/v1/capture`;
  const list = useQuery<{ items: TokenItem[] }>({ queryKey: ['api-tokens'], queryFn: () => api('GET', '/api-tokens') });
  const captureTokens = useMemo(() => (list.data?.items ?? []).filter((t) => t.scope !== 'creatoros'), [list.data]);
  const [name, setName] = useState('Siri & Apple Watch');
  const [fresh, setFresh] = useState<{ token: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoke, setRevoke] = useState<TokenItem | null>(null);
  const [testText, setTestText] = useState('Siri test tomorrow 9am p3');
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    try {
      const r = await api<{ token: string; item: TokenItem }>('POST', '/api-tokens', { name: name.trim() || 'Siri & Apple Watch' });
      setFresh({ token: r.token, name: r.item.name });
      void qc.invalidateQueries({ queryKey: ['api-tokens'] });
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  };
  const tokenShown = fresh?.token ?? 'YOUR_TOKEN';
  const step = 'mt-2 list-decimal space-y-1.5 pl-5 text-sm';
  return (
    <>
      <p className="text-sm text-muted">
        Add tasks and update notes by voice with <strong className="text-fg">Hey Siri</strong> on iPhone, iPad, Mac and <strong className="text-fg">Apple Watch</strong>. Download the shortcut below, paste a token into it, and say <strong className="text-fg">Hey Siri, Todo</strong>.
        Spoken tasks use the same parser as Quick Add, so &ldquo;Call mom tomorrow at 5pm p2 #Family&rdquo; just works.
      </p>

      <section aria-label="Access tokens" className="rounded-xl bg-surface p-4">
        <h2 className="flex items-center gap-2 font-semibold"><KeyRound size={18} aria-hidden /> Step 1. Create an access token</h2>
        <p className="mt-1 text-xs text-muted">A token lets a shortcut add tasks, update the note on a task that is due today, and read today&rsquo;s list. It cannot see anything else, and you can revoke it any time. Make one per device.</p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1"><Field label="Token name" htmlFor="tok-name"><Input id="tok-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></Field></div>
          <Button variant="primary" onClick={create} disabled={busy}>Create token</Button>
        </div>
        {fresh && (
          <div role="status" className="mt-3 rounded-lg border border-line bg-bg p-3">
            <p className="text-sm font-medium">Copy your token now. It is shown only once.</p>
            <p className="mt-2 break-all font-mono text-xs" data-testid="new-token">{fresh.token}</p>
            <div className="mt-2 flex gap-2"><CopyButton text={fresh.token} label="Copy token" /><Button size="sm" variant="ghost" onClick={() => setFresh(null)}>Done</Button></div>
          </div>
        )}
        <div className="mt-4">
          <h3 className="text-sm font-semibold">Your tokens</h3>
          {list.isLoading ? <Spinner /> : !captureTokens.length ? <p className="py-2 text-sm text-muted">No tokens yet.</p> : (
            <ul>
              {captureTokens.map((t) => (
                <li key={t.id} className="flex items-center gap-3 border-b border-line/60 py-2 text-sm">
                  <span className="min-w-0 flex-1"><span className="block truncate">{t.name}</span><span className="block text-xs text-muted">{t.hint} · {t.lastUsedAt ? `used ${new Date(t.lastUsedAt).toLocaleDateString()}` : 'never used'}</span></span>
                  <Button size="sm" variant="ghost" aria-label={`Revoke ${t.name}`} onClick={() => setRevoke(t)}><Trash2 size={16} aria-hidden /></Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-label="Siri shortcut" className="rounded-xl bg-surface p-4">
        <h2 className="font-semibold">Step 2. &ldquo;Hey Siri, add task&rdquo;</h2>
        <ol className={step}>
          <li>Open the <strong>Shortcuts</strong> app, tap <strong>+</strong>, and name the shortcut <strong>Add task</strong>. The name is the phrase you say to Siri.</li>
          <li>Add the action <strong>Dictate Text</strong>. (Prefer typing? Use <strong>Ask for Input</strong> with type Text instead.)</li>
          <li>Add <strong>Get Contents of URL</strong> and open its details:
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>URL: <Code>{endpoint}</Code> <CopyButton text={endpoint} label="Copy endpoint" /></li>
              <li>Method: <Code>POST</Code></li>
              <li>Headers: <Code>Authorization</Code> = <Code>Bearer {tokenShown}</Code></li>
              <li>Request Body: <Code>JSON</Code>, add a <strong>Text</strong> field named <Code>text</Code> and set its value to the <strong>Dictated Text</strong> variable.</li>
            </ul>
          </li>
          <li>Add <strong>Get Dictionary Value</strong> for the key <Code>message</Code>, then <strong>Speak Text</strong> (or Show Result). Siri will answer &ldquo;Added &lsquo;Call mom&rsquo; to Inbox for tomorrow at 17:00&rdquo;.</li>
          <li>Say <strong>&ldquo;Hey Siri, Add task&rdquo;</strong>, then speak the task.</li>
        </ol>
        <h3 className="mt-4 text-sm font-semibold">Optional: &ldquo;Hey Siri, what&rsquo;s on today&rdquo;</h3>
        <ol className={step}>
          <li>New shortcut named <strong>My tasks today</strong>.</li>
          <li><strong>Get Contents of URL</strong>: <Code>{endpoint}/today?format=text</Code>, Method <Code>GET</Code>, same <Code>Authorization</Code> header.</li>
          <li>Add <strong>Speak Text</strong> (or Show Result).</li>
        </ol>
        <h3 className="mt-4 text-sm font-semibold">Optional: open Quick Add instead</h3>
        <p className="mt-1 text-sm text-muted">A shortcut with <strong>Open URLs</strong> pointing at <Code>{origin}/?add=Buy%20milk%20tomorrow</Code> opens the app with Quick Add pre-filled. Installed app icons also get an &ldquo;Add task&rdquo; long-press shortcut on Android.</p>
      </section>

      <section aria-label="Apple Watch" className="rounded-xl bg-surface p-4">
        <h2 className="font-semibold">Step 3. Apple Watch</h2>
        <p className="mt-1 text-sm text-muted">
          Download this shortcut on your iPhone and open it. It asks for the token from step 1 and the server address. The shortcut is named <strong className="text-fg">Todo</strong>.
        </p>
        <Button className="mt-3" onClick={() => downloadWatchShortcut(origin)}>Download Apple Watch shortcut</Button>
        <ol className={step}>
          <li>On your iPhone, open the downloaded <strong>Todo.shortcut</strong> file in Safari. If iOS blocks it, open Settings, Shortcuts, and turn on Allow Untrusted Shortcuts (run any shortcut once first if that switch is missing).</li>
          <li>Paste the access token when asked. Leave the server address as shown if you opened this page on the public https name. If you opened it on a private address, change the server to <Code>https://todo.goyalfamily.ca</Code> with no slash at the end. To change either later, edit the Token or Server action.</li>
          <li>Open the shortcut&rsquo;s details and turn on <strong>Show on Apple Watch</strong>. It copies to the Watch over iCloud. You can also add it to a watch face or the Action Button.</li>
          <li>On the Watch, say <strong>Hey Siri, Todo</strong>, or open the Shortcuts app and tap Todo. Choose Add a task, Update a note, or What&rsquo;s on today.</li>
          <li>Update a note reads today&rsquo;s numbered list, asks which number, then replaces that task&rsquo;s note with what you dictate. The task name stays the same.</li>
        </ol>
        <p className="mt-3 text-xs text-muted">
          The Watch calls that address over Wi-Fi or cellular. It needs the public https name, which has to be reachable from the internet. A private Tailscale address will not work from the Watch.
        </p>
      </section>

      <section aria-label="Test capture" className="rounded-xl bg-surface p-4">
        <h2 className="font-semibold">Try it</h2>
        <p className="mt-1 text-xs text-muted">Sends this text to the same capture endpoint a shortcut uses. It creates a real task in your account.</p>
        <div className="mt-2 flex gap-2">
          <Input aria-label="Test capture text" value={testText} maxLength={500} onChange={(e) => setTestText(e.target.value)} />
          <Button onClick={async () => { try { const r = await api<{ message: string }>('POST', '/capture', { text: testText }); setTestMsg(r.message); void refresh(); } catch (e) { setTestMsg(errorMessage(e)); } }} disabled={!testText.trim()}>Send</Button>
        </div>
        {testMsg && <p role="status" className="mt-2 text-sm">{testMsg}</p>}
      </section>

      <Confirm open={!!revoke} onOpenChange={(o) => !o && setRevoke(null)} danger title={`Revoke "${revoke?.name}"?`} body="Any shortcut using this token stops working immediately." confirmLabel="Revoke" onConfirm={async () => { if (!revoke) return; try { await api('DELETE', `/api-tokens/${revoke.id}`); void qc.invalidateQueries({ queryKey: ['api-tokens'] }); } catch (e) { toast(errorMessage(e), 'error'); } }} />
    </>
  );
}

// ---------------------------------------------------------------- What's new / Help
export function WhatsNew() {
  return (
    <div className="space-y-5">
      {CHANGELOG.map((c) => (
        <section key={c.version} aria-label={`Version ${c.version}`}>
          <h2 className="text-sm font-semibold">{c.title} <span className="font-normal text-muted">· v{c.version}{c.date ? ` · ${c.date}` : ''}</span></h2>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{c.items.map((i) => <li key={i}>{i}</li>)}</ul>
        </section>
      ))}
    </div>
  );
}

export function Help() {
  return (
    <div className="space-y-5 text-sm">
      <section aria-label="Quick add syntax">
        <h2 className="font-semibold">Quick add cheat sheet</h2>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li><Code>tomorrow 5pm</Code>, <Code>next week</Code>, <Code>weekend</Code>, <Code>Oct 20</Code>, <Code>in 3 days</Code>: due date and time</li>
          <li><Code>every monday</Code>, <Code>every 2 weeks</Code>, <Code>daily</Code>: repeat</li>
          <li><Code>p1</Code> to <Code>p4</Code>: priority &middot; <Code>#Project</Code>: project &middot; <Code>@label</Code>: label</li>
        </ul>
      </section>
      <section aria-label="Gestures and keys">
        <h2 className="font-semibold">Gestures and shortcuts</h2>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>Swipe a task right to delete, left to archive (change under General). Both can be undone.</li>
          <li>Press <Code>q</Code> to add a task from anywhere on desktop (changeable under Task defaults).</li>
        </ul>
      </section>
      <section aria-label="Troubleshooting">
        <h2 className="font-semibold">Troubleshooting</h2>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>Changes not showing on another device? Open General and tap <strong>Sync now</strong>.</li>
          <li>No reminders on your phone? Add the app to your Home Screen, then enable push under Notifications.</li>
          <li>Siri says the shortcut failed? Check the token under Siri &amp; Shortcuts and that your shortcut uses a web address reachable from your phone.</li>
        </ul>
      </section>
      <p className="text-muted">Everything lives on your own server. Setup, backups and updates are described in the README that came with the app.</p>
    </div>
  );
}
