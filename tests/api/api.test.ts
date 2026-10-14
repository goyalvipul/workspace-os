import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, startHarness, today, type Client, type Harness } from './harness.js';

let h: Harness;
let c: Client;
const V = '/api/v1';

beforeAll(async () => {
  h = await startHarness();
  c = h.client();
});
afterAll(async () => {
  await h.close();
});

describe('authentication and request protection', () => {
  it('protects the API before login and reports first-run state', async () => {
    const anon = h.client();
    expect((await anon.call('GET', `${V}/tasks`)).status).toBe(401);
    const st = await anon.call('GET', `${V}/bootstrap/status`);
    expect(st.json).toMatchObject({ ownerConfigured: false, setupAllowed: true });
    expect((await anon.call('GET', '/api/health/live')).status).toBe(200);
  });

  it('rejects a wrong setup code and a weak password', async () => {
    const anon = h.client();
    const body = { setupCode: 'WRONG-CODE-XXXX', username: 'owner', displayName: 'Owner', password: PASSWORD, timezone: 'America/Vancouver', theme: 'dark' };
    expect((await anon.call('POST', `${V}/bootstrap/owner`, body)).status).toBeGreaterThanOrEqual(400);
    const weak = await anon.call('POST', `${V}/bootstrap/owner`, { ...body, password: 'short' });
    expect(weak.status).toBe(400);
  });

  it('creates the owner once, then closes setup', async () => {
    await c.signup();
    const s = await c.call('GET', `${V}/auth/session`);
    expect(s.json.authenticated).toBe(true);
    const again = await h.client().call('GET', `${V}/bootstrap/status`);
    expect(again.json.setupAllowed).toBe(false);
    const second = await h.client().call('POST', `${V}/bootstrap/owner`, { setupCode: 'AAAA-BBBB-CCCC', username: 'intruder', displayName: 'X', password: PASSWORD, timezone: 'UTC', theme: 'dark' });
    expect(second.status).toBeGreaterThanOrEqual(400);
  });

  it('enforces CSRF and Origin on mutations', async () => {
    const noCsrf = await c.call('POST', `${V}/projects`, { name: 'x' }, { 'x-csrf-token': 'bad' });
    expect(noCsrf.status).toBe(403);
    const badOrigin = await c.call('POST', `${V}/projects`, { name: 'x' }, { origin: 'https://evil.example' });
    expect(badOrigin.status).toBe(403);
  });

  it('logs in, rejects bad passwords, and logs out', async () => {
    const x = h.client();
    expect((await x.call('POST', `${V}/auth/login`, { username: 'owner', password: 'Wrong-Password-1' })).status).toBe(401);
    const ok = await x.call('POST', `${V}/auth/login`, { username: 'owner', password: PASSWORD });
    expect(ok.status).toBe(200);
    x.csrf = ok.json.csrfToken;
    expect((await x.call('GET', `${V}/auth/session`)).json.authenticated).toBe(true);
    expect((await x.call('POST', `${V}/auth/logout`)).status).toBe(200);
    expect((await x.call('GET', `${V}/tasks`)).status).toBe(401);
  });

  it('changes the password and revokes other sessions', async () => {
    const other = h.client();
    const l = await other.call('POST', `${V}/auth/login`, { username: 'owner', password: PASSWORD });
    other.csrf = l.json.csrfToken;
    const r = await c.call('POST', `${V}/auth/password`, { currentPassword: PASSWORD, newPassword: 'Another-Strong-Pass-7', logoutOthers: true });
    expect(r.status).toBe(200);
    expect((await other.call('GET', `${V}/tasks`)).status).toBe(401);
    const back = await c.call('POST', `${V}/auth/password`, { currentPassword: 'Another-Strong-Pass-7', newPassword: PASSWORD });
    expect(back.status).toBe(200);
  });
});

describe('projects, tasks and views', () => {
  let projectId = '';
  it('creates a project with sections', async () => {
    const p = await c.call('POST', `${V}/projects`, { name: 'Home', color: '#3e63dd' });
    expect(p.status).toBe(201);
    projectId = p.json.project.id;
    const s = await c.call('POST', `${V}/projects/${projectId}/sections`, { name: 'Soon' });
    expect(s.status).toBe(201);
  });

  it('creates, patches and soft-deletes tasks with optimistic concurrency', async () => {
    const created = await c.call('POST', `${V}/tasks`, { title: 'Pay rent', projectId, dueDate: today(), priority: 1 });
    expect(created.status).toBe(201);
    const t = created.json.task;
    expect(t.version).toBe(1);
    const patched = await c.call('PATCH', `${V}/tasks/${t.id}`, { version: 1, title: 'Pay rent online' });
    expect(patched.json.task.version).toBe(2);
    const stale = await c.call('PATCH', `${V}/tasks/${t.id}`, { version: 1, title: 'Stale' });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe('VERSION_CONFLICT');
    expect(stale.json.error.current.title).toBe('Pay rent online');
    expect((await c.call('DELETE', `${V}/tasks/${t.id}`)).status).toBe(200);
    expect((await c.call('GET', `${V}/tasks/${t.id}`)).json.task.deletedAt).toBeTruthy();
    expect(JSON.stringify((await c.call('GET', `${V}/search?q=Pay%20rent`)).json)).not.toContain(t.id);
    expect((await c.call('POST', `${V}/tasks/${t.id}/restore`)).status).toBe(200);
    expect((await c.call('GET', `${V}/tasks/${t.id}`)).json.task.deletedAt).toBeNull();
  });

  it('replays idempotent creates instead of duplicating', async () => {
    const key = 'idem-test-key-0001';
    const a = await c.call('POST', `${V}/tasks`, { title: 'Once only' }, { 'idempotency-key': key });
    const b = await c.call('POST', `${V}/tasks`, { title: 'Once only' }, { 'idempotency-key': key });
    expect(a.status).toBe(201);
    expect(b.json.task.id).toBe(a.json.task.id);
    const list = await c.call('GET', `${V}/search?q=${encodeURIComponent('Once only')}`);
    expect(JSON.stringify(list.json).split('Once only').length - 1).toBeLessThanOrEqual(2);
  });

  it('rejects invalid input with field details', async () => {
    const r = await c.call('POST', `${V}/tasks`, { title: '' });
    expect(r.status).toBe(400);
    const bad = await c.call('POST', `${V}/tasks`, { title: 'x', dueDate: '2026-13-45' });
    expect(bad.status).toBe(400);
  });

  it('recurring tasks advance instead of closing, and completions are logged', async () => {
    const r = await c.call('POST', `${V}/tasks`, { title: 'Water plants', dueDate: today(), recurrence: { rule: 'FREQ=DAILY', mode: 'fixed' } });
    expect(r.status).toBe(201);
    const t = r.json.task;
    const done = await c.call('POST', `${V}/tasks/${t.id}/complete`, { version: t.version });
    expect(done.status).toBe(200);
    expect(done.json.task.status).toBe('open');
    expect(done.json.task.dueDate > t.dueDate).toBe(true);
    const log = await c.call('GET', `${V}/tasks/${t.id}/completions`);
    expect(log.json.items.length).toBe(1);
  });

  it('completing a parent can complete subtasks; reopen is idempotent', async () => {
    const parent = (await c.call('POST', `${V}/tasks`, { title: 'Parent' })).json.task;
    const sub = await c.call('POST', `${V}/tasks/${parent.id}/subtasks`, { title: 'Child' });
    expect(sub.status).toBe(201);
    const done = await c.call('POST', `${V}/tasks/${parent.id}/complete`, { version: parent.version, completeSubtasks: true });
    expect(done.json.task.status).toBe('completed');
    const child = await c.call('GET', `${V}/tasks/${sub.json.task.id}`);
    expect(child.json.task.status).toBe('completed');
    const r1 = await c.call('POST', `${V}/tasks/${parent.id}/reopen`, {});
    const r2 = await c.call('POST', `${V}/tasks/${parent.id}/reopen`, {});
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r2.json.task.status).toBe('open');
  });

  it('Today shows overdue and due-today; Upcoming shows later days; Inbox shows unfiled tasks', async () => {
    const d = today();
    const y = new Date(Date.parse(`${d}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const later = new Date(Date.parse(`${d}T12:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10);
    const over = (await c.call('POST', `${V}/tasks`, { title: 'Overdue one', dueDate: y })).json.task;
    const due = (await c.call('POST', `${V}/tasks`, { title: 'Due today one', dueDate: d })).json.task;
    const fut = (await c.call('POST', `${V}/tasks`, { title: 'Future one', dueDate: later })).json.task;
    const todayView = JSON.stringify((await c.call('GET', `${V}/views/today`)).json);
    expect(todayView).toContain(over.id);
    expect(todayView).toContain(due.id);
    expect(todayView).not.toContain(fut.id);
    const upcoming = JSON.stringify((await c.call('GET', `${V}/views/upcoming?start=${d}&end=${later}`)).json);
    expect(upcoming).toContain(fut.id);
    const inbox = JSON.stringify((await c.call('GET', `${V}/views/inbox`)).json);
    expect(inbox).toContain(over.id);
  });

  it('bulk actions are all-or-nothing', async () => {
    const a = (await c.call('POST', `${V}/tasks`, { title: 'Bulk A' })).json.task;
    const b = (await c.call('POST', `${V}/tasks`, { title: 'Bulk B' })).json.task;
    const ok = await c.call('POST', `${V}/tasks/bulk`, { ids: [a.id, b.id], action: 'priority', priority: 2 });
    expect(ok.status).toBe(200);
    const missing = await c.call('POST', `${V}/tasks/bulk`, { ids: [a.id, '01HZZZZZZZZZZZZZZZZZZZZZZZ'], action: 'priority', priority: 3 });
    expect(missing.status).toBeGreaterThanOrEqual(400);
    expect((await c.call('GET', `${V}/tasks/${a.id}`)).json.task.priority).toBe(2);
  });

  it('full-text search finds tasks by title and description', async () => {
    await c.call('POST', `${V}/tasks`, { title: 'Quarterly taxes', description: 'collect receipts from the accountant' });
    const r = await c.call('GET', `${V}/search?q=receipts`);
    expect(JSON.stringify(r.json)).toContain('Quarterly taxes');
  });

  it('deleting a project requires an explicit policy and confirmation', async () => {
    const p = (await c.call('POST', `${V}/projects`, { name: 'Temp' })).json.project;
    const t = (await c.call('POST', `${V}/tasks`, { title: 'In temp', projectId: p.id })).json.task;
    expect((await c.call('DELETE', `${V}/projects/${p.id}`)).status).toBe(400);
    expect((await c.call('DELETE', `${V}/projects/${p.id}?taskPolicy=move_to_inbox&confirm=true`)).status).toBe(200);
    const moved = (await c.call('GET', `${V}/tasks/${t.id}`)).json.task;
    expect(moved.projectId).toBeNull();
  });
});

describe('labels, filters and templates', () => {
  it('saves a filter and evaluates it server side', async () => {
    const l = await c.call('POST', `${V}/labels`, { name: 'urgent', color: '#e5484d' });
    expect(l.status).toBe(201);
    const labelId = l.json.label.id;
    const t = (await c.call('POST', `${V}/tasks`, { title: 'Labeled task', labelIds: [labelId], priority: 1 })).json.task;
    const ast = { op: 'and', children: [{ field: 'label', cmp: 'is', value: [labelId] }, { field: 'priority', cmp: 'is', value: 1 }] };
    const ev = await c.call('POST', `${V}/filters/evaluate`, { ast });
    expect(JSON.stringify(ev.json)).toContain(t.id);
    const f = await c.call('POST', `${V}/saved-filters`, { name: 'Urgent P1', ast });
    expect(f.status).toBe(201);
    const res = await c.call('GET', `${V}/saved-filters/${f.json.filter.id}/tasks`);
    expect(JSON.stringify(res.json)).toContain(t.id);
  });

  it('rejects a malicious filter AST', async () => {
    const r = await c.call('POST', `${V}/filters/evaluate`, { ast: { field: 'title; DROP TABLE tasks', cmp: 'is', value: 1 } });
    expect(r.status).toBe(400);
  });

  it('previews and applies a template', async () => {
    const list = await c.call('GET', `${V}/templates`);
    const tpl = (list.json.items ?? list.json.templates).find((x: { isBuiltin: boolean; kind: string }) => x.isBuiltin && x.kind === 'project');
    expect(tpl).toBeTruthy();
    const dry = await c.call('POST', `${V}/templates/${tpl.id}/apply`, { dryRun: true, projectName: 'Preview only' });
    expect(dry.status).toBe(200);
    const before = JSON.stringify((await c.call('GET', `${V}/projects`)).json);
    expect(before).not.toContain('Preview only');
    const applied = await c.call('POST', `${V}/templates/${tpl.id}/apply`, { projectName: 'From template' });
    expect([200, 201]).toContain(applied.status);
    expect(applied.json.projectId).toBeTruthy();
    const tasks = await c.call('GET', `${V}/tasks?projectId=${applied.json.projectId}`);
    expect(JSON.stringify(tasks.json).length).toBeGreaterThan(50);
  });
});

describe('import, export and secrets', () => {
  it('exports tasks CSV with formula-injection protection', async () => {
    await c.call('POST', `${V}/tasks`, { title: '=HYPERLINK("http://evil","x")' });
    const r = await c.call('GET', `${V}/export/tasks.csv`);
    expect(r.status).toBe(200);
    expect(r.text).not.toMatch(/(^|,)"?=HYPERLINK/m);
    expect(r.text).toContain("'=HYPERLINK");
  });

  it('exports a full workspace JSON without secrets', async () => {
    const r = await c.call('GET', `${V}/export/workspace.json`);
    expect(r.status).toBe(200);
    expect(r.text).not.toMatch(/passwordHash|tokenCiphertext|refreshToken|argon2/i);
  });

  it('requires a preview before a CSV import is applied', async () => {
    const content = 'TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE\ntask,Imported thing,,4,1,,,,en,\n';
    const noPreview = await c.call('POST', `${V}/imports/apply`, { kind: 'todoist_csv', content });
    expect(noPreview.status).toBe(400);
    const prev = await c.call('POST', `${V}/imports/preview`, { kind: 'todoist_csv', content });
    expect(prev.status).toBe(200);
    expect(prev.json.previewToken).toBeTruthy();
    const applied = await c.call('POST', `${V}/imports/apply`, { kind: 'todoist_csv', content, previewToken: prev.json.previewToken });
    expect(applied.status).toBe(200);
    expect(JSON.stringify((await c.call('GET', `${V}/search?q=Imported`)).json)).toContain('Imported thing');
    const tampered = await c.call('POST', `${V}/imports/apply`, { kind: 'todoist_csv', content: content + 'task,Extra,,4,1,,,,en,\n', previewToken: prev.json.previewToken });
    expect(tampered.status).toBe(400);
  });
});

describe('sync, events and preferences', () => {
  it('serves a snapshot and typed preferences', async () => {
    const s = await c.call('GET', `${V}/sync/snapshot`);
    expect(s.status).toBe(200);
    expect(Array.isArray(s.json.tasks)).toBe(true);
    const p = await c.call('PATCH', `${V}/preferences`, { 'tasks.defaultPriority': 2 });
    expect(p.status).toBe(200);
    const bad = await c.call('PATCH', `${V}/preferences`, { 'tasks.defaultPriority': 99 });
    expect(bad.status).toBe(400);
  });

  it('records durable change events after mutations', async () => {
    const rows = h.ctx.sqlite.prepare('SELECT count(*) AS n FROM app_events').get() as { n: number };
    expect(rows.n).toBeGreaterThan(5);
  });

  it('security headers are present on the app shell', async () => {
    const r = await c.call('GET', '/api/health/live');
    expect(String(r.headers['content-security-policy'] ?? '')).toContain("default-src 'self'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });
});
