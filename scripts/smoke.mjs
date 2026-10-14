#!/usr/bin/env node
/**
 * Smoke test against a running instance.
 *   node scripts/smoke.mjs                       -> health checks only (no credentials needed)
 *   SMOKE_SETUP_CODE=XXXX-XXXX-XXXX node scripts/smoke.mjs   -> first run: creates the owner, then runs the full API flow
 *   SMOKE_USERNAME=... SMOKE_PASSWORD=... node scripts/smoke.mjs -> logs in and runs the full API flow
 * The flow creates one project and one task, completes it, and deletes the project again.
 * BASE_URL defaults to http://localhost:4390
 */
const BASE = (process.env.BASE_URL ?? 'http://localhost:4390').replace(/\/$/, '');
let cookie = '';
let csrf = '';
let failures = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures++;
}

async function call(method, path, body, opts = {}) {
  const headers = { origin: BASE };
  if (cookie) headers.cookie = cookie;
  if (csrf && !opts.noCsrf) headers['x-csrf-token'] = csrf;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const set = res.headers.getSetCookie?.() ?? [];
  for (const c of set) {
    const pair = c.split(';')[0];
    if (pair.startsWith('wos_session=')) cookie = pair.endsWith('=') ? '' : pair;
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  return { status: res.status, json, text };
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.OWNER_TIMEZONE ?? 'America/Vancouver' }).format(new Date());

async function main() {
  console.log(`Smoke test against ${BASE}`);
  const live = await call('GET', '/api/health/live');
  check('GET /api/health/live', live.status === 200 && live.json?.status === 'ok');
  const ready = await call('GET', '/api/health/ready');
  check('GET /api/health/ready (db, migrations, scheduler)', ready.status === 200 && ready.json?.status === 'ready', JSON.stringify(ready.json));
  const ver = await call('GET', '/api/v1/version');
  check('GET /api/v1/version', ver.status === 200 && !!ver.json?.version);
  const page = await fetch(BASE + '/');
  check('GET / serves the web app', page.status === 200 && (await page.text()).includes('<div id="root"'), `status ${page.status}`);
  const unauth = await call('GET', '/api/v1/tasks');
  check('unauthenticated API call is rejected (401)', unauth.status === 401);

  const st = await call('GET', '/api/v1/bootstrap/status');
  const code = process.env.SMOKE_SETUP_CODE;
  const user = process.env.SMOKE_USERNAME;
  const pass = process.env.SMOKE_PASSWORD;
  if (st.json?.setupAllowed && code) {
    const username = user ?? 'owner';
    const password = pass ?? 'Smoke-Test-Passw0rd!';
    const r = await call('POST', '/api/v1/bootstrap/owner', { setupCode: code, username, displayName: 'Owner', password, timezone: process.env.OWNER_TIMEZONE ?? 'America/Vancouver', theme: 'dark' });
    check('first-run owner creation with setup code', r.status === 201, JSON.stringify(r.json));
    csrf = r.json?.csrfToken ?? '';
  } else if (user && pass) {
    const r = await call('POST', '/api/v1/auth/login', { username: user, password: pass });
    check('login', r.status === 200, JSON.stringify(r.json));
    csrf = r.json?.csrfToken ?? '';
  } else {
    console.log('SKIP  authenticated flow (set SMOKE_SETUP_CODE or SMOKE_USERNAME + SMOKE_PASSWORD)');
    return;
  }
  if (!csrf) return check('session established', false);

  const sess = await call('GET', '/api/v1/auth/session');
  check('session endpoint reports authenticated', sess.json?.authenticated === true);
  const noCsrf = await call('POST', '/api/v1/projects', { name: 'x' }, { noCsrf: true });
  check('mutation without CSRF token is rejected (403)', noCsrf.status === 403, String(noCsrf.status));
  const badOrigin = await fetch(BASE + '/api/v1/projects', { method: 'POST', headers: { origin: 'https://evil.example', cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' }, body: '{"name":"x"}' });
  check('cross-origin mutation is rejected (403)', badOrigin.status === 403, String(badOrigin.status));

  const proj = await call('POST', '/api/v1/projects', { name: `Smoke ${Date.now()}` });
  check('create project', proj.status === 201, JSON.stringify(proj.json));
  const projectId = proj.json?.project?.id;
  const task = await call('POST', '/api/v1/tasks', { title: 'Smoke task', projectId, dueDate: today(), priority: 2 });
  check('create task due today', task.status === 201, JSON.stringify(task.json));
  const t = task.json?.task;
  const todayView = await call('GET', '/api/v1/views/today');
  check('task appears in Today view', JSON.stringify(todayView.json).includes(t?.id ?? 'none'), String(todayView.status));
  const found = await call('GET', '/api/v1/search?q=Smoke');
  check('full-text search finds the task', JSON.stringify(found.json).includes(t?.id ?? 'none'), String(found.status));
  const stale = await call('PATCH', `/api/v1/tasks/${t?.id}`, { version: 999, title: 'stale write' });
  check('stale version is rejected with 409 VERSION_CONFLICT', stale.status === 409 && stale.json?.error?.code === 'VERSION_CONFLICT', String(stale.status));
  const done = await call('POST', `/api/v1/tasks/${t?.id}/complete`, { version: t?.version ?? 1 });
  check('complete task', done.status === 200 && done.json?.task?.status === 'completed', JSON.stringify(done.json));
  const snap = await call('GET', '/api/v1/sync/snapshot');
  check('sync snapshot returns workspace data', snap.status === 200 && Array.isArray(snap.json?.tasks), String(snap.status));
  const exp = await call('GET', '/api/v1/export/workspace.json');
  check('workspace export works and contains no secrets', exp.status === 200 && !/tokenCiphertext|passwordHash|refreshToken/i.test(exp.text));

  const ctrl = new AbortController();
  const sse = await fetch(BASE + '/api/v1/stream/events?after=0', { headers: { cookie }, signal: ctrl.signal });
  const reader = sse.body.getReader();
  const chunk = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r(null), 4000))]);
  const text = chunk?.value ? new TextDecoder().decode(chunk.value) : '';
  check('SSE stream opens and sends events', sse.status === 200 && text.length > 0, `status ${sse.status}`);
  ctrl.abort();

  const del = await call('DELETE', `/api/v1/projects/${projectId}?taskPolicy=delete&confirm=true`);
  check('cleanup: delete smoke project', del.status === 200, JSON.stringify(del.json));
}

main()
  .catch((e) => {
    console.error('FAIL  smoke crashed:', e instanceof Error ? e.message : e);
    failures++;
  })
  .finally(() => {
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll smoke checks passed');
    process.exit(failures ? 1 : 0);
  });
