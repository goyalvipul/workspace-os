import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deliverTick } from '../../apps/server/src/services/creatoros.js';
import { startHarness, today, type Client, type Harness } from './harness.js';

const V = '/api/v1';
const CO = `${V}/integrations/creatoros`;

let h: Harness;
let c: Client;
let fake: Server;
let url = '';
let secret = '';
let linkToken = '';

interface Hit { headers: IncomingHttpHeaders; raw: string; body: any }
let hits: Hit[] = [];
let respond: () => { status: number; body?: unknown } = () => ({ status: 200, body: {} });

beforeAll(async () => {
  fake = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      hits.push({ headers: req.headers, raw, body: raw ? JSON.parse(raw) : null });
      const r = respond();
      res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.body ?? {}));
    });
  });
  await new Promise<void>((ok) => fake.listen(0, '127.0.0.1', ok));
  url = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/api/integrations/workspace-os`;
  h = await startHarness();
  c = h.client();
  await c.signup();
});
afterAll(async () => {
  await h.close();
  await new Promise((ok) => fake.close(ok));
});
beforeEach(() => {
  hits = [];
  respond = () => ({ status: 200, body: {} });
});

/** Run the delivery worker until the queue is empty (each tick sends at most one batch). */
async function flush(now = new Date()) {
  let n = 0;
  for (let i = 0; i < 20; i++) {
    const d = await deliverTick(h.ctx, now);
    n += d;
    if (!d) break;
  }
  return n;
}
const outbox = () => h.ctx.sqlite.prepare('SELECT task_id, kind, status, attempts, last_error FROM creatoros_outbox').all() as { task_id: string; kind: string; status: string; attempts: number; last_error: string | null }[];
const mkTask = async (title: string, extra: Record<string, unknown> = {}) => (await c.call('POST', `${V}/tasks`, { title, ...extra })).json.task;

/** A request the way CreatorOS sends it: Bearer token only. */
async function bearer(token: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) {
  const r = await h.app.inject({ method, url: path, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, payload: body === undefined ? undefined : JSON.stringify(body) });
  let json: any = null;
  try { json = r.body ? JSON.parse(r.body) : null; } catch { /* not json */ }
  return { status: r.statusCode, json, text: r.body };
}
const verify = (hit: Hit) => {
  const ts = String(hit.headers['x-wos-timestamp']);
  const expected = `v1=${createHmac('sha256', secret).update(`${ts}.${hit.raw}`).digest('hex')}`;
  return hit.headers['x-wos-signature'] === expected;
};

describe('configuration', () => {
  it('requires a connection before anything can be published', async () => {
    const t = await mkTask('Too early');
    expect((await c.call('POST', `${CO}/publish`, { taskIds: [t.id] })).status).toBe(409);
    expect((await c.call('GET', CO)).json.status.configured).toBe(false);
  });

  it('rejects unsafe or malformed addresses', async () => {
    for (const bad of ['not a url', 'ftp://host/x', 'http://user:pw@host/x', 'http://169.254.169.254/latest/meta-data']) {
      expect((await c.call('PUT', CO, { webhookUrl: bad })).status, bad).toBe(400);
    }
  });

  it('stores the signing secret encrypted and shows it once', async () => {
    const r = await c.call('PUT', CO, { webhookUrl: url });
    expect(r.status).toBe(200);
    secret = r.json.secret;
    expect(secret.startsWith('wos_whsec_')).toBe(true);
    expect(r.json.status.configured).toBe(true);
    const stored = JSON.stringify(h.ctx.sqlite.prepare('SELECT * FROM creatoros_config').all());
    expect(stored).not.toContain(secret);
    const again = await c.call('GET', CO);
    expect(again.text).not.toContain(secret);
    // updating settings does not rotate it
    expect((await c.call('PUT', CO, { webhookUrl: url })).json.secret).toBeNull();
  });

  it('sends a signed ping', async () => {
    const r = await c.call('POST', `${CO}/test`);
    expect(r.json.ok).toBe(true);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.body.type).toBe('ping');
    expect(verify(hits[0] as Hit)).toBe(true);
    respond = () => ({ status: 403 });
    const bad = await c.call('POST', `${CO}/test`);
    expect(bad.json.ok).toBe(false);
    expect(bad.json.message).toContain('signature');
  });
});

describe('publishing to CreatorOS', () => {
  it('publishes a task with its sub-tasks, signed, and keeps the externalId CreatorOS returns', async () => {
    const parent = await mkTask('Shoot video', { priority: 2, dueDate: today(), description: 'Intro + outro' });
    const sub = (await c.call('POST', `${V}/tasks/${parent.id}/subtasks`, { title: 'Charge batteries' })).json.task;
    respond = () => ({ status: 200, body: { externalId: 'co_123' } });
    const r = await c.call('POST', `${CO}/publish`, { taskIds: [parent.id] });
    expect(r.json.count).toBe(2);
    expect(await flush()).toBe(2);
    expect(hits.every((x) => verify(x))).toBe(true);
    const sent = hits.find((x) => x.body.task.id === parent.id)?.body;
    expect(sent.type).toBe('task.upsert');
    expect(sent.task).toMatchObject({ title: 'Shoot video', priority: 2, status: 'open', description: 'Intro + outro', version: 1 });
    expect(hits.some((x) => x.body.task.id === sub.id && x.body.task.parentTaskId === parent.id)).toBe(true);
    expect(outbox()).toHaveLength(0);
    const links = (await c.call('GET', `${CO}/links`)).json.items;
    expect(links.find((l: { taskId: string }) => l.taskId === parent.id)).toMatchObject({ externalId: 'co_123', state: 'synced' });
  });

  it('sends later edits and completion, coalescing rapid changes into one delivery', async () => {
    const t = await mkTask('Edit me');
    await c.call('POST', `${CO}/publish`, { taskIds: [t.id] });
    await flush();
    hits = [];
    let cur = (await c.call('GET', `${V}/tasks/${t.id}`)).json.task;
    cur = (await c.call('PATCH', `${V}/tasks/${t.id}`, { version: cur.version, title: 'Edited once' })).json.task;
    cur = (await c.call('PATCH', `${V}/tasks/${t.id}`, { version: cur.version, title: 'Edited twice', priority: 1 })).json.task;
    expect(outbox()).toHaveLength(1);
    await flush();
    expect(hits).toHaveLength(1);
    expect(hits[0]?.body.task).toMatchObject({ title: 'Edited twice', priority: 1 });
    hits = [];
    await c.call('POST', `${V}/tasks/${t.id}/complete`, { version: cur.version });
    await flush();
    expect(hits[0]?.body.task.status).toBe('completed');
  });

  it('does nothing for tasks that are not published', async () => {
    const t = await mkTask('Private');
    await c.call('PATCH', `${V}/tasks/${t.id}`, { version: t.version, title: 'Still private' });
    expect(outbox()).toHaveLength(0);
    expect(await flush()).toBe(0);
  });

  it('publishes automatically by label or project, including tasks that gain the label later', async () => {
    const label = (await c.call('POST', `${V}/labels`, { name: 'creatoros' })).json.label;
    const project = (await c.call('POST', `${V}/projects`, { name: 'Channel' })).json.project;
    const r = await c.call('PUT', CO, { webhookUrl: url, autoLabelId: label.id, autoProjectId: project.id });
    expect(r.status).toBe(200);
    const byLabel = await mkTask('Labelled', { labelIds: [label.id] });
    const byProject = await mkTask('In project', { projectId: project.id });
    const plain = await mkTask('Plain');
    const later = await mkTask('Labelled later');
    await c.call('PATCH', `${V}/tasks/${later.id}`, { version: later.version, labelIds: [label.id] });
    await flush();
    const ids = hits.filter((x) => x.body.type === 'task.upsert').map((x) => x.body.task.id);
    expect(ids).toEqual(expect.arrayContaining([byLabel.id, byProject.id, later.id]));
    expect(ids).not.toContain(plain.id);
    const sent = hits.find((x) => x.body.task.id === byLabel.id)?.body.task;
    expect(sent.labels).toEqual(['creatoros']);
    expect(hits.find((x) => x.body.task.id === byProject.id)?.body.task.projectName).toBe('Channel');
  });

  it('backfills existing tasks when a rule is added and "Sync now" is pressed', async () => {
    const project = (await c.call('POST', `${V}/projects`, { name: 'Backfill' })).json.project;
    const old = await mkTask('Already there', { projectId: project.id });
    await flush();
    hits = [];
    await c.call('PUT', CO, { webhookUrl: url, autoProjectId: project.id });
    const r = await c.call('POST', `${CO}/sync`);
    expect(r.status).toBe(200);
    await flush();
    expect(hits.some((x) => x.body.task.id === old.id)).toBe(true);
  });

  it('tells CreatorOS to remove a task when it is unpublished or deleted, and sends it again on restore', async () => {
    const a = await mkTask('Unpublish me');
    const b = await mkTask('Delete me');
    await c.call('POST', `${CO}/publish`, { taskIds: [a.id, b.id] });
    await flush();
    hits = [];
    await c.call('POST', `${CO}/unpublish`, { taskIds: [a.id] });
    await c.call('DELETE', `${V}/tasks/${b.id}`);
    await flush();
    const rm = Object.fromEntries(hits.map((x) => [x.body.task.id, x.body]));
    expect(rm[a.id]).toMatchObject({ type: 'task.remove', reason: 'unpublished' });
    expect(rm[b.id]).toMatchObject({ type: 'task.remove', reason: 'deleted' });
    // unpublished tasks are no longer linked; edits stay private
    hits = [];
    await c.call('PATCH', `${V}/tasks/${a.id}`, { version: 2, title: 'Private again' });
    expect(await flush()).toBe(0);
    // restoring the deleted one publishes it again
    await c.call('POST', `${V}/tasks/${b.id}/restore`);
    await flush();
    expect(hits[0]?.body).toMatchObject({ type: 'task.upsert' });
    expect(hits[0]?.body.task.id).toBe(b.id);
  });
});

describe('delivery failures', () => {
  it('retries server errors with backoff and succeeds once CreatorOS recovers', async () => {
    const t = await mkTask('Flaky');
    await c.call('POST', `${CO}/publish`, { taskIds: [t.id] });
    respond = () => ({ status: 503 });
    expect(await flush()).toBe(0);
    expect(outbox()[0]).toMatchObject({ status: 'pending', attempts: 1 });
    // nothing is attempted again until the backoff has passed
    hits = [];
    expect(await flush()).toBe(0);
    expect(hits).toHaveLength(0);
    respond = () => ({ status: 200, body: { externalId: 'co_flaky' } });
    expect(await flush(new Date(Date.now() + 60_000))).toBe(1);
    expect(outbox()).toHaveLength(0);
  });

  it('stops on a permanent error, shows it, and "Sync now" retries', async () => {
    const t = await mkTask('Rejected');
    await c.call('POST', `${CO}/publish`, { taskIds: [t.id] });
    respond = () => ({ status: 404 });
    await flush();
    expect(outbox()[0]).toMatchObject({ status: 'failed', attempts: 1 });
    const st = (await c.call('GET', CO)).json.status;
    expect(st.counts.failed).toBe(1);
    expect(st.lastError).toContain('404');
    respond = () => ({ status: 200 });
    await c.call('POST', `${CO}/sync`);
    await flush();
    expect(outbox()).toHaveLength(0);
    expect((await c.call('GET', CO)).json.status.counts.failed).toBe(0);
  });

  it('does not follow redirects', async () => {
    const t = await mkTask('Redirected');
    await c.call('POST', `${CO}/publish`, { taskIds: [t.id] });
    respond = () => ({ status: 302 });
    await flush();
    expect(outbox()[0]).toMatchObject({ status: 'failed' });
    await c.call('POST', `${CO}/unpublish`, { taskIds: [t.id] });
    respond = () => ({ status: 200 });
    await c.call('POST', `${CO}/sync`);
    await flush();
  });

  it('pausing the link stops deliveries and drops the queue', async () => {
    const t = await mkTask('Paused');
    await c.call('POST', `${CO}/publish`, { taskIds: [t.id] });
    expect(outbox().length).toBeGreaterThan(0);
    await c.call('PUT', CO, { webhookUrl: url, enabled: false });
    expect(outbox()).toHaveLength(0);
    hits = [];
    expect(await flush()).toBe(0);
    expect((await c.call('POST', `${CO}/publish`, { taskIds: [t.id] })).status).toBe(409);
    await c.call('PUT', CO, { webhookUrl: url, enabled: true });
    await flush();
    expect(hits.some((x) => x.body.task?.id === t.id)).toBe(true);
  });
});

describe('inbound API for CreatorOS', () => {
  let published: { id: string; version: number };

  beforeAll(async () => {
    const r = await c.call('POST', `${V}/api-tokens`, { name: 'CreatorOS', scope: 'creatoros' });
    expect(r.status).toBe(201);
    expect(r.json.item.scope).toBe('creatoros');
    linkToken = r.json.token;
    published = await mkTask('From WOS');
    await c.call('POST', `${CO}/publish`, { taskIds: [published.id] });
    await flush();
    published = (await c.call('GET', `${V}/tasks/${published.id}`)).json.task;
  });

  it('keeps token scopes apart', async () => {
    const capture = (await c.call('POST', `${V}/api-tokens`, { name: 'Siri' })).json.token;
    expect((await bearer(capture, 'GET', `${CO}/tasks`)).status).toBe(401);
    expect((await bearer(linkToken, 'POST', `${V}/capture`, { text: 'nope' })).status).toBe(401);
    // a creatoros token reaches nothing else, not even the owner-only parts of its own family
    for (const p of [`${V}/tasks`, `${V}/api-tokens`, `${V}/export/workspace.json`, CO, `${CO}/links`]) expect((await bearer(linkToken, 'GET', p)).status, p).toBe(401);
    expect((await bearer(linkToken, 'POST', `${CO}/publish`, { taskIds: [published.id] })).status).toBe(401);
    expect((await bearer('wos_bogus', 'GET', `${CO}/tasks`)).status).toBe(401);
    const evil = await h.app.inject({ method: 'POST', url: `${CO}/tasks`, headers: { authorization: `Bearer ${linkToken}`, origin: 'https://evil.example', 'content-type': 'application/json' }, payload: JSON.stringify({ externalId: 'x', title: 'x' }) });
    expect(evil.statusCode).toBe(403);
  });

  it('lists published tasks with a cursor', async () => {
    const all = await bearer(linkToken, 'GET', `${CO}/tasks?limit=2`);
    expect(all.status).toBe(200);
    expect(all.json.items).toHaveLength(2);
    expect(all.json.tasks).toEqual(all.json.items);
    expect(all.json.nextCursor).toBeTruthy();
    const next = await bearer(linkToken, 'GET', `${CO}/tasks?limit=500&cursor=${encodeURIComponent(all.json.nextCursor)}`);
    const ids = new Set([...all.json.items, ...next.json.items].map((t: { id: string }) => t.id));
    expect(ids.size).toBe(all.json.items.length + next.json.items.length);
    expect((await bearer(linkToken, 'GET', `${CO}/tasks?cursor=garbage`)).status).toBe(400);
  });

  it('updates and completes a published task without echoing the change back', async () => {
    const r = await bearer(linkToken, 'PATCH', `${CO}/tasks/${published.id}`, { baseVersion: published.version, title: 'Renamed in CreatorOS', priority: 1, externalId: 'co_from_wos' });
    expect(r.status).toBe(200);
    expect(r.json.task).toMatchObject({ title: 'Renamed in CreatorOS', priority: 1, externalId: 'co_from_wos' });
    expect(outbox()).toHaveLength(0);
    expect((await c.call('GET', `${V}/tasks/${published.id}`)).json.task.title).toBe('Renamed in CreatorOS');
    const done = await bearer(linkToken, 'PATCH', `${CO}/tasks/${published.id}`, { status: 'completed' });
    expect(done.json.task.status).toBe('completed');
    const reopened = await bearer(linkToken, 'PATCH', `${CO}/tasks/${published.id}`, { status: 'open' });
    expect(reopened.json.task.status).toBe('open');
    expect(outbox()).toHaveLength(0);
    // the owner's own next edit still goes out
    const cur = (await c.call('GET', `${V}/tasks/${published.id}`)).json.task;
    await c.call('PATCH', `${V}/tasks/${published.id}`, { version: cur.version, title: 'Owner edit' });
    expect(outbox()).toHaveLength(1);
    await flush();
  });

  it('reports a version conflict and leaves the task alone', async () => {
    const r = await bearer(linkToken, 'PATCH', `${CO}/tasks/${published.id}`, { baseVersion: 1, title: 'Stale write' });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('VERSION_CONFLICT');
    expect(r.json.error.current.title).toBe('Owner edit');
    expect((await c.call('GET', `${V}/tasks/${published.id}`)).json.task.title).toBe('Owner edit');
  });

  it('creates tasks idempotently by externalId and publishes them', async () => {
    const body = { externalId: 'co_new_1', title: 'Plan the launch', priority: 2, dueDate: today() };
    const a = await bearer(linkToken, 'POST', `${CO}/tasks`, body);
    expect(a.status).toBe(201);
    const b = await bearer(linkToken, 'POST', `${CO}/tasks`, body);
    expect(b.status).toBe(200);
    expect(b.json.task.id).toBe(a.json.task.id);
    expect(a.json.task).toMatchObject({ externalId: 'co_new_1', title: 'Plan the launch', priority: 2 });
    expect(outbox()).toHaveLength(0);
    expect((await c.call('GET', `${V}/tasks/${a.json.task.id}`)).json.task.title).toBe('Plan the launch');
    expect((await bearer(linkToken, 'POST', `${CO}/tasks`, { externalId: 'x', title: '   ' })).status).toBe(400);
  });

  it('cannot touch tasks that are not published', async () => {
    const secretTask = await mkTask('Not published');
    expect((await bearer(linkToken, 'PATCH', `${CO}/tasks/${secretTask.id}`, { title: 'hijack' })).status).toBe(404);
    expect((await bearer(linkToken, 'GET', `${CO}/tasks/${secretTask.id}`)).status).toBe(404);
    expect((await bearer(linkToken, 'DELETE', `${CO}/tasks/${secretTask.id}`)).status).toBe(404);
    expect((await bearer(linkToken, 'PATCH', `${CO}/tasks/not-an-id`, { title: 'x' })).status).toBe(404);
    expect((await c.call('GET', `${V}/tasks/${secretTask.id}`)).json.task.title).toBe('Not published');
  });

  it('deletes softly and is auditable', async () => {
    const t = (await bearer(linkToken, 'POST', `${CO}/tasks`, { externalId: 'co_delete', title: 'Remove me' })).json.task;
    const d = await bearer(linkToken, 'DELETE', `${CO}/tasks/${t.id}`);
    expect(d.status).toBe(200);
    expect(d.json.task.deletedAt).toBeTruthy();
    expect(outbox()).toHaveLength(0);
    const listed = (await bearer(linkToken, 'GET', `${CO}/tasks?limit=500`)).json.items.find((x: { id: string }) => x.id === t.id);
    expect(listed.deletedAt).toBeTruthy();
    expect((await bearer(linkToken, 'PATCH', `${CO}/tasks/${t.id}`, { title: 'zombie' })).status).toBe(404);
    expect(JSON.stringify((await c.call('GET', `${V}/activity?limit=100`)).json)).toContain('creatoros.received');
  });

  it('stops working when the link is paused or the token is revoked', async () => {
    await c.call('PUT', CO, { webhookUrl: url, enabled: false });
    const paused = await bearer(linkToken, 'GET', `${CO}/tasks`);
    expect(paused.status).toBe(409);
    expect(paused.json.error.code).toBe('CREATOROS_DISABLED');
    await c.call('PUT', CO, { webhookUrl: url, enabled: true });
    expect((await bearer(linkToken, 'GET', `${CO}/tasks`)).status).toBe(200);
    const id = (await c.call('GET', `${V}/api-tokens`)).json.items.find((t: { scope: string }) => t.scope === 'creatoros').id;
    await c.call('DELETE', `${V}/api-tokens/${id}`);
    expect((await bearer(linkToken, 'GET', `${CO}/tasks`)).status).toBe(401);
  });
});

describe('rotating the secret and disconnecting', () => {
  it('rotates the secret so old signatures no longer verify, then disconnects cleanly', async () => {
    const old = secret;
    const r = await c.call('PUT', CO, { webhookUrl: url, rotateSecret: true });
    secret = r.json.secret;
    expect(secret).not.toBe(old);
    hits = [];
    await c.call('POST', `${CO}/test`);
    expect(verify(hits[0] as Hit)).toBe(true);
    expect(hits[0]?.headers['x-wos-signature']).not.toBe(`v1=${createHmac('sha256', old).update(`${hits[0]?.headers['x-wos-timestamp']}.${hits[0]?.raw}`).digest('hex')}`);
    expect((await c.call('DELETE', CO)).status).toBe(200);
    expect((await c.call('GET', CO)).json.status).toMatchObject({ configured: false, counts: { published: 0, pending: 0, failed: 0 } });
    expect(h.ctx.sqlite.prepare('SELECT count(*) AS n FROM creatoros_task_links').get()).toEqual({ n: 0 });
    const log = JSON.stringify((await c.call('GET', `${V}/activity?limit=200`)).json);
    expect(log).toContain('creatoros.configured');
    expect(log).toContain('creatoros.disconnected');
  });
});
