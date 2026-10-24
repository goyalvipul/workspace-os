import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { passwordSchema } from '@wos/shared';
import { Button, Field, Input, Select } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { afterAuth, useStore } from '../lib/store';

function Card({ title, children, sub }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-xl">
        <div className="mb-5 flex items-center gap-3">
          <img src="/icons/icon-192.png" alt="" width={40} height={40} className="rounded-xl" />
          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
            {sub && <p className="text-sm text-muted">{sub}</p>}
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

export function LoginPage() {
  const status = useStore((s) => s.status);
  const ownerConfigured = useStore((s) => s.ownerConfigured);
  const expired = useStore((s) => s.sessionExpired);
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (status === 'authed') return <Navigate to="/today" replace />;
  if (status === 'anon' && ownerConfigured === false) return <Navigate to="/setup" replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await afterAuth(await api('POST', '/auth/login', { username, password }));
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Workspace OS" sub={expired ? 'Your session expired. Sign in again.' : 'Sign in to your workspace'}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Username" htmlFor="lu"><Input id="lu" autoComplete="username" autoCapitalize="none" autoFocus required value={username} onChange={(e) => setU(e.target.value)} /></Field>
        <Field label="Password" htmlFor="lp"><Input id="lp" type="password" autoComplete="current-password" required value={password} onChange={(e) => setP(e.target.value)} /></Field>
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <Button type="submit" variant="primary" className="w-full" disabled={busy || !username || !password}>{busy ? 'Signing in...' : 'Sign in'}</Button>
      </form>
    </Card>
  );
}

const ZONES = ['America/Vancouver', 'America/Edmonton', 'America/Toronto', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'];

export function SetupPage() {
  const status = useStore((s) => s.status);
  const ownerConfigured = useStore((s) => s.ownerConfigured);
  const [f, setF] = useState({ setupCode: '', username: '', displayName: '', password: '', confirm: '', timezone: 'America/Vancouver' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (status === 'authed') return <Navigate to="/today" replace />;
  if (status === 'anon' && ownerConfigured) return <Navigate to="/login" replace />;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const pw = passwordSchema.safeParse(f.password);
  const pwErr = f.password && !pw.success ? pw.error.issues[0]?.message : '';
  const mismatch = f.confirm && f.confirm !== f.password;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await afterAuth(await api('POST', '/bootstrap/owner', { setupCode: f.setupCode.trim(), username: f.username.trim(), displayName: f.displayName.trim(), password: f.password, timezone: f.timezone, theme: 'dark' }));
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setBusy(false);
    }
  };
  const zones = ZONES.includes(f.timezone) ? ZONES : [f.timezone, ...ZONES];
  return (
    <Card title="Welcome" sub="Create the owner account. The setup code is printed in the server console.">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Setup code" htmlFor="sc" hint="Shown when the server starts, or run: docker compose exec app node dist/cli.js setup-code"><Input id="sc" autoComplete="off" autoCapitalize="none" required value={f.setupCode} onChange={set('setupCode')} /></Field>
        <Field label="Your name" htmlFor="dn"><Input id="dn" autoComplete="name" required value={f.displayName} onChange={set('displayName')} /></Field>
        <Field label="Username" htmlFor="un"><Input id="un" autoComplete="username" autoCapitalize="none" required minLength={3} value={f.username} onChange={set('username')} /></Field>
        <Field label="Password" htmlFor="pw" hint="At least 6 characters."><Input id="pw" type="password" autoComplete="new-password" required minLength={6} maxLength={200} value={f.password} onChange={set('password')} aria-invalid={!!pwErr} /></Field>
        {pwErr && <p role="alert" className="text-sm text-danger">{pwErr}</p>}
        <Field label="Confirm password" htmlFor="pc"><Input id="pc" type="password" autoComplete="new-password" required value={f.confirm} onChange={set('confirm')} /></Field>
        {mismatch && <p role="alert" className="text-sm text-danger">Passwords do not match.</p>}
        <Field label="Time zone" htmlFor="tz"><Select id="tz" value={f.timezone} onChange={set('timezone')}>{zones.map((z) => <option key={z}>{z}</option>)}</Select></Field>
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <Button type="submit" variant="primary" className="w-full" disabled={busy || !pw.success || !!mismatch || !f.setupCode || !f.username || !f.displayName}>{busy ? 'Creating...' : 'Create account'}</Button>
      </form>
    </Card>
  );
}
