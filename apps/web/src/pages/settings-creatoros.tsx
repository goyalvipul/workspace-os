import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Confirm, Field, Input, Select, Spinner, Switch } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { CREATOROS_KEY, useCreatoros } from '../lib/creatoros';
import { toast, useStore } from '../lib/store';
import { Code, CopyButton, Row, type TokenItem } from './settings-extra';

interface SaveResult { secret: string | null }

export function CreatorOSSettings() {
  const qc = useQueryClient();
  const { status, isLoading } = useCreatoros();
  const labelsMap = useStore((s) => s.labels);
  const projectsMap = useStore((s) => s.projects);
  const labels = useMemo(() => Object.values(labelsMap).sort((a, b) => a.name.localeCompare(b.name)), [labelsMap]);
  const projects = useMemo(() => Object.values(projectsMap).filter((p) => !p.archivedAt).sort((a, b) => a.name.localeCompare(b.name)), [projectsMap]);

  const [url, setUrl] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [disconnect, setDisconnect] = useState(false);
  const [rotate, setRotate] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const tokens = useQuery<{ items: TokenItem[] }>({ queryKey: ['api-tokens'], queryFn: () => api('GET', '/api-tokens') });
  const coTokens = useMemo(() => (tokens.data?.items ?? []).filter((t) => t.scope === 'creatoros'), [tokens.data]);

  const form = {
    webhookUrl: (url ?? status?.webhookUrl ?? '').trim(),
    enabled: enabled ?? status?.enabled ?? true,
    autoLabelId: (label ?? status?.autoLabelId ?? '') || null,
    autoProjectId: (project ?? status?.autoProjectId ?? '') || null,
  };
  const reload = () => void qc.invalidateQueries({ queryKey: CREATOROS_KEY });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  };
  const save = (rotateSecret = false) => run(async () => {
    const r = await api<SaveResult>('PUT', '/integrations/creatoros', { ...form, rotateSecret });
    if (r.secret) setSecret(r.secret);
    setUrl(null); setEnabled(null); setLabel(null); setProject(null);
    reload();
    toast(r.secret ? 'Saved. Copy the signing secret now.' : 'Saved', 'success');
  });
  const test = () => run(async () => {
    const r = await api<{ ok: boolean; message: string }>('POST', '/integrations/creatoros/test');
    setTestMsg({ ok: r.ok, text: r.message });
    reload();
  });
  const sync = () => run(async () => {
    await api('POST', '/integrations/creatoros/sync');
    reload();
    toast('Sync started', 'success');
  });
  const makeToken = () => run(async () => {
    const r = await api<{ token: string }>('POST', '/api-tokens', { name: 'CreatorOS', scope: 'creatoros' });
    setFreshToken(r.token);
    void qc.invalidateQueries({ queryKey: ['api-tokens'] });
  });

  if (isLoading) return <Spinner />;
  const configured = !!status?.configured;
  const origin = window.location.origin;
  const base = `${origin}/api/v1/integrations/creatoros/tasks`;

  return (
    <>
      <p className="text-sm text-muted">
        Publish your to-dos to <strong className="text-fg">CreatorOS</strong> and manage them there. Workspace OS sends each change as a signed message to CreatorOS, and CreatorOS can complete, edit or add tasks back.
        Both apps stay on your own network.
      </p>

      <section aria-label="Connection" className="rounded-xl bg-surface p-4">
        <h2 className="font-semibold">Step 1. Connect</h2>
        <p className="mt-1 text-xs text-muted">The address on CreatorOS that receives tasks. Use an address this server can reach (the machine&rsquo;s LAN or Tailscale IP, not <Code>localhost</Code> when this app runs in Docker).</p>
        <div className="mt-3 space-y-3">
          <Field label="CreatorOS webhook address" htmlFor="co-url"><Input id="co-url" inputMode="url" placeholder="http://192.168.1.20:3001/api/integrations/workspace-os" value={url ?? status?.webhookUrl ?? ''} onChange={(e) => setUrl(e.target.value)} /></Field>
          <Row label="Publishing on" hint="Turn off to pause. Nothing is sent or accepted while paused.">
            <Switch label="Publishing on" checked={form.enabled} onChange={(v) => setEnabled(v)} />
          </Row>
          <Field label="Always publish tasks with this label" htmlFor="co-label" hint="Optional. Applies to open tasks, now and in future.">
            <Select id="co-label" value={form.autoLabelId ?? ''} onChange={(e) => setLabel(e.target.value)}>
              <option value="">None</option>
              {labels.map((l) => <option key={l.id} value={l.id}>@{l.name}</option>)}
            </Select>
          </Field>
          <Field label="Always publish open tasks in this project" htmlFor="co-project" hint="Optional.">
            <Select id="co-project" value={form.autoProjectId ?? ''} onChange={(e) => setProject(e.target.value)}>
              <option value="">None</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void save(false)} disabled={busy || !form.webhookUrl}>{configured ? 'Save' : 'Connect and create secret'}</Button>
          {configured && <Button onClick={() => void test()} disabled={busy}>Send test</Button>}
          {configured && <Button onClick={() => void sync()} disabled={busy || !status?.enabled}>Sync now</Button>}
          {configured && <Button onClick={() => setRotate(true)} disabled={busy}>New secret</Button>}
          {configured && <Button variant="ghost" onClick={() => setDisconnect(true)} disabled={busy}>Disconnect</Button>}
        </div>
        {testMsg && <p role="status" className="mt-3 text-sm">{testMsg.ok ? 'Test succeeded. ' : 'Test failed. '}{testMsg.text}</p>}
        {secret && (
          <div role="status" className="mt-3 rounded-lg border border-line bg-bg p-3">
            <p className="text-sm font-medium">Signing secret. Copy it into CreatorOS now; it is shown only once.</p>
            <p className="mt-2 break-all font-mono text-xs" data-testid="creatoros-secret">{secret}</p>
            <div className="mt-2 flex gap-2"><CopyButton text={secret} label="Copy signing secret" /><Button size="sm" variant="ghost" onClick={() => setSecret(null)}>Done</Button></div>
          </div>
        )}
      </section>

      {configured && status && (
        <section aria-label="Status" className="rounded-xl bg-surface p-4">
          <h2 className="font-semibold">Status</h2>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-lg bg-bg p-2"><dt className="text-xs text-muted">Published</dt><dd className="text-lg font-semibold">{status.counts.published}</dd></div>
            <div className="rounded-lg bg-bg p-2"><dt className="text-xs text-muted">Waiting</dt><dd className="text-lg font-semibold">{status.counts.pending}</dd></div>
            <div className="rounded-lg bg-bg p-2"><dt className="text-xs text-muted">Failed</dt><dd className="text-lg font-semibold">{status.counts.failed}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-muted">{status.lastSuccessAt ? `Last delivered ${new Date(status.lastSuccessAt).toLocaleString()}.` : 'Nothing delivered yet.'}</p>
          {status.lastError && <p role="alert" className="mt-1 text-sm text-danger">Last problem: {status.lastError}</p>}
          <p className="mt-2 text-xs text-muted">To publish a single task, open it and choose <strong>Publish to CreatorOS</strong> from the &hellip; menu.</p>
        </section>
      )}

      <section aria-label="Access for CreatorOS" className="rounded-xl bg-surface p-4">
        <h2 className="flex items-center gap-2 font-semibold"><KeyRound size={18} aria-hidden /> Step 2. Let CreatorOS call back</h2>
        <p className="mt-1 text-xs text-muted">
          This token lets CreatorOS read, add, update and complete only the tasks that are published to it. It can see nothing else.
          CreatorOS sends it as <Code>Authorization: Bearer &hellip;</Code> to <Code>{base}</Code>. Use the address of this app that CreatorOS can reach.
        </p>
        <div className="mt-3"><Button onClick={() => void makeToken()} disabled={busy}>Create access token</Button></div>
        {freshToken && (
          <div role="status" className="mt-3 rounded-lg border border-line bg-bg p-3">
            <p className="text-sm font-medium">Copy your token now. It is shown only once.</p>
            <p className="mt-2 break-all font-mono text-xs" data-testid="creatoros-token">{freshToken}</p>
            <div className="mt-2 flex gap-2"><CopyButton text={freshToken} label="Copy access token" /><Button size="sm" variant="ghost" onClick={() => setFreshToken(null)}>Done</Button></div>
          </div>
        )}
        {coTokens.length > 0 && (
          <ul className="mt-3">
            {coTokens.map((t) => (
              <li key={t.id} className="flex items-center gap-3 border-b border-line/60 py-2 text-sm">
                <span className="min-w-0 flex-1"><span className="block truncate">{t.name}</span><span className="block text-xs text-muted">{t.hint} · {t.lastUsedAt ? `used ${new Date(t.lastUsedAt).toLocaleDateString()}` : 'never used'}</span></span>
                <Button size="sm" variant="ghost" aria-label={`Revoke ${t.name}`} onClick={async () => { try { await api('DELETE', `/api-tokens/${t.id}`); void qc.invalidateQueries({ queryKey: ['api-tokens'] }); } catch (e) { toast(errorMessage(e), 'error'); } }}><Trash2 size={16} aria-hidden /></Button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">The message format, signature check and endpoints are described in <Code>docs/CREATOROS_INTEGRATION.md</Code>.</p>
      </section>

      <Confirm open={rotate} onOpenChange={setRotate} title="Create a new signing secret?" body="The old secret stops working at once. Put the new one into CreatorOS or it will reject every message." confirmLabel="Create new secret" onConfirm={() => void save(true)} />
      <Confirm open={disconnect} onOpenChange={setDisconnect} danger title="Disconnect CreatorOS?" body="This forgets the address, the secret and which tasks were published. Your tasks are not changed, and nothing is deleted in CreatorOS." confirmLabel="Disconnect" onConfirm={() => void run(async () => { await api('DELETE', '/integrations/creatoros'); reload(); toast('Disconnected', 'success'); })} />
    </>
  );
}
