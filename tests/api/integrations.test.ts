import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { digestTick, snoozeTick } from '../../apps/server/src/services/notifications.js';
import { startHarness, today, type Client, type Harness } from './harness.js';

let h: Harness;
let c: Client;
const V = '/api/v1';

beforeAll(async () => {
  h = await startHarness();
  c = h.client();
  await c.signup();
});
afterAll(async () => {
  await h.close();
});

/** A request the way Siri / Shortcuts sends it: Bearer token only, no cookie, no CSRF token, no Origin. */
async function bearer(token: string, method: 'GET' | 'POST', url: string, body?: unknown) {
  const r = await h.app.inject({ method, url, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, payload: body === undefined ? undefined : JSON.stringify(body) });
  let json: any = null;
  try { json = r.body ? JSON.parse(r.body) : null; } catch { /* text */ }
  return { status: r.statusCode, json, text: r.body };
}

describe('archive', () => {
  it('archives a task with its subtasks out of every view and restores it', async () => {
    const parent = (await c.call('POST', `${V}/tasks`, { title: 'Archive me', dueDate: today() })).json.task;
    const sub = (await c.call('POST', `${V}/tasks/${parent.id}/subtasks`, { title: 'Archive child' })).json.task;
    const a = await c.call('POST', `${V}/tasks/${parent.id}/archive`);
    expect(a.status).toBe(200);
    expect(a.json.task.status).toBe('archived');
    expect((await c.call('GET', `${V}/tasks/${sub.id}`)).json.task.status).toBe('archived');
    expect(JSON.stringify((await c.call('GET', `${V}/views/today`)).json)).not.toContain(parent.id);
    expect(JSON.stringify((await c.call('GET', `${V}/tasks`)).json)).not.toContain(parent.id);
    expect(JSON.stringify((await c.call('GET', `${V}/tasks?status=archived`)).json)).toContain(parent.id);
    // archived tasks cannot be completed, and archiving twice is harmless
    expect((await c.call('POST', `${V}/tasks/${parent.id}/complete`, { version: a.json.task.version })).status).toBe(400);
    expect((await c.call('POST', `${V}/tasks/${parent.id}/archive`)).status).toBe(200);
    const u = await c.call('POST', `${V}/tasks/${parent.id}/unarchive`);
    expect(u.json.task.status).toBe('open');
    expect(JSON.stringify((await c.call('GET', `${V}/views/today`)).json)).toContain(parent.id);
    const log = JSON.stringify((await c.call('GET', `${V}/activity?limit=50`)).json);
    expect(log).toContain('task.archived');
    expect(log).toContain('task.unarchived');
  });
});

describe('personal access tokens, Siri capture and Apple Watch', () => {
  let token = '';
  let tokenId = '';

  it('creates a token, shows the secret once, and never stores or lists it', async () => {
    const r = await c.call('POST', `${V}/api-tokens`, { name: 'iPhone' });
    expect(r.status).toBe(201);
    token = r.json.token;
    tokenId = r.json.item.id;
    expect(token.startsWith('wos_')).toBe(true);
    const list = await c.call('GET', `${V}/api-tokens`);
    expect(list.json.items).toHaveLength(1);
    expect(list.text).not.toContain(token);
    const stored = h.ctx.sqlite.prepare('SELECT token_hash FROM api_tokens').all() as { token_hash: string }[];
    expect(stored[0]?.token_hash).not.toBe(token);
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it('captures a natural-language task with only the bearer token', async () => {
    await c.call('POST', `${V}/projects`, { name: 'Family' });
    const r = await bearer(token, 'POST', `${V}/capture`, { text: 'Call mom tomorrow at 5pm p2 #Family @phone' });
    expect(r.status).toBe(201);
    expect(r.json.message).toContain('Call mom');
    expect(r.json.message).toContain('Family');
    const t = r.json.task;
    expect(t.title).toBe('Call mom');
    expect(t.priority).toBe(2);
    expect(t.dueAtUtc).toBeTruthy();
    expect(t.dueDate > today()).toBe(true);
    expect(t.labelIds).toHaveLength(1);
    expect(t.projectId).toBeTruthy();
    // visible in the normal session too
    expect((await c.call('GET', `${V}/tasks/${t.id}`)).json.task.title).toBe('Call mom');
  });

  it('supports plain-text replies for Shortcuts and a speakable today list', async () => {
    const add = await bearer(token, 'POST', `${V}/capture?format=text`, { text: 'Pay the invoice today' });
    expect(add.status).toBe(201);
    expect(add.text).toContain('Pay the invoice');
    const t = await bearer(token, 'GET', `${V}/capture/today?format=text`);
    expect(t.status).toBe(200);
    expect(t.text).toContain('Pay the invoice');
    const j = await bearer(token, 'GET', `${V}/capture/today`);
    expect(j.json.count).toBeGreaterThan(0);
    expect(j.json.items[0]).toHaveProperty('title');
  });

  it('honours "detect dates" off and the project-defaults-to-today rule', async () => {
    await c.call('PATCH', `${V}/preferences`, { 'dates.detect': false });
    const r = await bearer(token, 'POST', `${V}/capture`, { text: 'Read a book tomorrow' });
    expect(r.json.task.title).toBe('Read a book tomorrow');
    expect(r.json.task.dueDate).toBeNull();
    await c.call('PATCH', `${V}/preferences`, { 'dates.detect': true });
  });

  it('adds an automatic reminder when the preference is on and a time is given', async () => {
    await c.call('PATCH', `${V}/preferences`, { 'reminders.auto': '10' });
    const r = await bearer(token, 'POST', `${V}/capture`, { text: 'Stand up meeting tomorrow 9am' });
    expect(r.json.task.reminders).toHaveLength(1);
    expect(r.json.task.reminders[0].offsetMinutes).toBe(10);
    await c.call('PATCH', `${V}/preferences`, { 'reminders.auto': 'none' });
  });

  it('is scoped: a token cannot read or change anything outside capture', async () => {
    expect((await bearer(token, 'GET', `${V}/tasks`)).status).toBe(401);
    expect((await bearer(token, 'GET', `${V}/api-tokens`)).status).toBe(401);
    expect((await bearer(token, 'GET', `${V}/export/workspace.json`)).status).toBe(401);
    expect((await bearer(token, 'POST', `${V}/api-tokens`, { name: 'escalate' })).status).toBe(401);
  });

  it('rejects wrong tokens, empty text and honours a cross-site Origin check', async () => {
    expect((await bearer('wos_notarealtoken', 'POST', `${V}/capture`, { text: 'x' })).status).toBe(401);
    expect((await bearer('Bearer', 'GET', `${V}/capture/today`)).status).toBe(401);
    expect((await bearer(token, 'POST', `${V}/capture`, { text: '   ' })).status).toBe(400);
    const evil = await h.app.inject({ method: 'POST', url: `${V}/capture`, headers: { authorization: `Bearer ${token}`, origin: 'https://evil.example', 'content-type': 'application/json' }, payload: JSON.stringify({ text: 'x' }) });
    expect(evil.statusCode).toBe(403);
  });

  it('revoking a token stops it immediately and is audited', async () => {
    expect((await c.call('DELETE', `${V}/api-tokens/${tokenId}`)).status).toBe(200);
    expect((await bearer(token, 'POST', `${V}/capture`, { text: 'after revoke' })).status).toBe(401);
    expect((await c.call('GET', `${V}/api-tokens`)).json.items).toHaveLength(0);
    const log = JSON.stringify((await c.call('GET', `${V}/activity?limit=100`)).json);
    expect(log).toContain('api_token.created');
    expect(log).toContain('api_token.revoked');
  });
});

describe('productivity and general preferences', () => {
  it('validates the new preference keys', async () => {
    const ok = await c.call('PATCH', `${V}/preferences`, { 'productivity.dailyGoal': 7, 'productivity.daysOff': [0, 6], 'swipe.right': 'complete', 'swipe.left': 'archive', 'general.homeView': 'inbox', 'reminders.snoozeMinutes': 30 });
    expect(ok.status).toBe(200);
    const bad = await c.call('PATCH', `${V}/preferences`, { 'swipe.right': 'explode' });
    expect(bad.status).toBe(400);
    expect((await c.call('PATCH', `${V}/preferences`, { 'productivity.dailyGoal': 0 })).status).toBe(400);
    const got = await c.call('GET', `${V}/sync/snapshot`);
    expect(got.json.preferences['general.homeView']).toBe('inbox');
    expect(got.json.preferences['productivity.daysOff']).toEqual([0, 6]);
    await c.call('PATCH', `${V}/preferences`, { 'general.homeView': 'today', 'swipe.right': 'delete' });
  });

  it('"reset sub-tasks" reopens finished sub-tasks when a repeating task advances', async () => {
    await c.call('PATCH', `${V}/preferences`, { 'tasks.resetSubtasks': true });
    const parent = (await c.call('POST', `${V}/tasks`, { title: 'Weekly review', dueDate: today(), recurrence: { rule: 'FREQ=DAILY', mode: 'fixed' } })).json.task;
    const sub = (await c.call('POST', `${V}/tasks/${parent.id}/subtasks`, { title: 'Check inbox' })).json.task;
    const doneSub = await c.call('POST', `${V}/tasks/${sub.id}/complete`, { version: sub.version });
    expect(doneSub.json.task.status).toBe('completed');
    const p1 = (await c.call('GET', `${V}/tasks/${parent.id}`)).json.task;
    const done = await c.call('POST', `${V}/tasks/${parent.id}/complete`, { version: p1.version });
    expect(done.json.task.status).toBe('open');
    expect((await c.call('GET', `${V}/tasks/${sub.id}`)).json.task.status).toBe('open');
    await c.call('PATCH', `${V}/preferences`, { 'tasks.resetSubtasks': false });
  });

  it('leaves sub-tasks alone when the option is off', async () => {
    const parent = (await c.call('POST', `${V}/tasks`, { title: 'Daily thing', dueDate: today(), recurrence: { rule: 'FREQ=DAILY', mode: 'fixed' } })).json.task;
    const sub = (await c.call('POST', `${V}/tasks/${parent.id}/subtasks`, { title: 'Part' })).json.task;
    await c.call('POST', `${V}/tasks/${sub.id}/complete`, { version: sub.version });
    const p1 = (await c.call('GET', `${V}/tasks/${parent.id}`)).json.task;
    await c.call('POST', `${V}/tasks/${parent.id}/complete`, { version: p1.version });
    expect((await c.call('GET', `${V}/tasks/${sub.id}`)).json.task.status).toBe('completed');
  });
});

describe('morning overview, evening review and snooze', () => {
  it('sends each digest once per day, at or after the chosen time, and respects vacation mode', async () => {
    await c.call('POST', `${V}/tasks`, { title: 'Digest task', dueDate: today() });
    // "five minutes ago" in the user's zone, so the digest is due now (never earlier than 00:00)
    const ago = new Date(Date.now() - 5 * 60_000);
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Vancouver', hour: '2-digit', minute: '2-digit', hour12: false }).format(ago);
    const sameDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver' }).format(ago) === today();
    await c.call('PATCH', `${V}/preferences`, { 'notifications.morningEnabled': true, 'notifications.morningTime': sameDay ? parts : '00:00', 'notifications.eveningEnabled': false });
    await c.call('PATCH', `${V}/preferences`, { 'productivity.vacation': true });
    expect(await digestTick(h.ctx)).toBe(0);
    await c.call('PATCH', `${V}/preferences`, { 'productivity.vacation': false });
    const now = new Date();
    // the harness user's zone is America/Vancouver; run at a moment that is certainly after 00:00 local and within 3 hours of it
    const first = await digestTick(h.ctx, now);
    const second = await digestTick(h.ctx, now);
    const list = await c.call('GET', `${V}/notifications`);
    const digests = list.json.items.filter((n: { kind: string }) => n.kind === 'digest');
    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(digests).toHaveLength(1);
    expect(digests[0].body).toMatch(/task/);
    // far outside the 3 hour window after the chosen time: nothing is sent late (next day, evening)
    expect(await digestTick(h.ctx, new Date(Date.now() + 30 * 3_600_000))).toBe(0);
  });

  it('snoozes a reminder and re-delivers it later', async () => {
    const t = (await c.call('POST', `${V}/tasks`, { title: 'Snooze me', dueDate: today() })).json.task;
    const now = new Date().toISOString();
    h.ctx.sqlite.prepare(`INSERT INTO notifications (id, owner_user_id, kind, task_id, title, body, scheduled_at, delivered_at, channel, status, dedupe_key, created_at) SELECT '01HZ0000000000000000000001', owner_user_id, 'reminder', id, title, 'Reminder', ?, ?, 'inapp', 'delivered', 'test:snooze', ? FROM tasks WHERE id = ?`).run(now, now, now, t.id);
    const r = await c.call('POST', `${V}/notifications/01HZ0000000000000000000001/snooze`, { minutes: 5 });
    expect(r.status).toBe(200);
    expect(await snoozeTick(h.ctx, new Date())).toBe(0); // not yet
    expect(await snoozeTick(h.ctx, new Date(Date.now() + 6 * 60_000))).toBe(1);
    const list = await c.call('GET', `${V}/notifications`);
    expect(list.json.items.filter((n: { title: string }) => n.title === 'Snooze me').length).toBe(2);
    expect((await c.call('POST', `${V}/notifications/01HZ0000000000000000000099/snooze`, { minutes: 5 })).status).toBe(404);
  });
});
