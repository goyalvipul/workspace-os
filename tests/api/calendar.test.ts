import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeGoogleEvent } from '../../apps/server/src/calendar/google.js';
import { normalizeGraphEvent } from '../../apps/server/src/calendar/microsoft.js';
import { workerTick } from '../../apps/server/src/calendar/service.js';
import { ProviderError, type CalendarProvider, type NormalizedEvent } from '../../apps/server/src/calendar/types.js';
import { startHarness, today, type Client, type Harness } from './harness.js';

const V = '/api/v1';

function ev(id: string, over: Partial<NormalizedEvent> = {}): NormalizedEvent {
  const d = today();
  return {
    providerEventId: id, icalUid: `${id}@fake`, seriesId: null, occurrenceIdentity: 'single', subject: `Event ${id}`, description: '', location: '', url: null,
    startUtc: `${d}T18:00:00.000Z`, endUtc: `${d}T19:00:00.000Z`, startDate: null, endDateExclusive: null, timezone: 'America/Vancouver',
    isAllDay: false, isCancelled: false, isPrivate: false, availability: 'busy', etag: id, lastModifiedAt: null, ...over,
  };
}

/** Fake provider: no network, deterministic data, switchable failure modes. */
function fakeProvider(state: { events: NormalizedEvent[]; failAuth: boolean; syncCalls: number }): CalendarProvider {
  return {
    id: 'google',
    isConfigured: () => true,
    missingConfig: () => [],
    redirectUri: () => 'http://localhost:4390/api/v1/calendar/oauth/google/callback',
    scopes: () => ['calendar.readonly'],
    buildAuthUrl: ({ state: s }) => `https://fake.example/auth?state=${s}`,
    exchangeCode: async () => ({ tokens: { accessToken: 'AT-1', refreshToken: 'RT-1', expiresAt: new Date(Date.now() + 3600_000).toISOString(), scopes: ['calendar.readonly'] }, profile: { subject: 'sub-1', email: 'me@example.com', name: 'Me' } }),
    refresh: async () => {
      if (state.failAuth) throw new ProviderError('auth', 'invalid_grant', 400, undefined, 'invalid_grant');
      return { accessToken: 'AT-2', expiresAt: new Date(Date.now() + 3600_000).toISOString(), scopes: ['calendar.readonly'] };
    },
    listCalendars: async () => [
      { providerCalendarId: 'primary', name: 'Main', color: null, timezone: 'America/Vancouver', isPrimary: true, readOnly: false, selectByDefault: true },
      { providerCalendarId: 'holidays', name: 'Holidays', color: null, timezone: 'UTC', isPrimary: false, readOnly: true, selectByDefault: false },
    ],
    syncCalendar: async (_t, input) => {
      state.syncCalls++;
      return { full: true, events: input.calendar.providerCalendarId === 'primary' ? state.events : [], removed: [], window: input.window, cursor: { kind: 'fake', value: String(state.syncCalls), fingerprint: 'fp', windowStart: input.window.start, windowEnd: input.window.end } };
    },
  };
}

describe('normalizers', () => {
  it('masks private Google events', () => {
    const e = normalizeGoogleEvent({ id: 'g1', status: 'confirmed', visibility: 'private', summary: 'Therapy with Dr. X', description: 'secret notes', location: 'Clinic', start: { dateTime: '2026-10-14T10:00:00-07:00' }, end: { dateTime: '2026-10-14T11:00:00-07:00' } } as never, 'America/Vancouver');
    expect(e).toBeTruthy();
    expect(e?.isPrivate).toBe(true);
    expect(JSON.stringify(e)).not.toContain('Therapy');
    expect(JSON.stringify(e)).not.toContain('secret notes');
    expect(JSON.stringify(e)).not.toContain('Clinic');
  });
  it('masks private Microsoft events and keeps all-day dates as dates', () => {
    const p = normalizeGraphEvent({ id: 'm1', subject: 'Private thing', sensitivity: 'private', isAllDay: false, start: { dateTime: '2026-10-14T17:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-14T18:00:00.0000000', timeZone: 'UTC' } } as never);
    expect(JSON.stringify(p)).not.toContain('Private thing');
    const a = normalizeGraphEvent({ id: 'm2', subject: 'Holiday', isAllDay: true, start: { dateTime: '2026-12-25T00:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-12-26T00:00:00.0000000', timeZone: 'UTC' } } as never);
    expect(a?.isAllDay).toBe(true);
    expect(a?.startDate).toBe('2026-12-25');
    expect(a?.endDateExclusive).toBe('2026-12-26');
  });
});

describe('calendar integration with a fake provider', () => {
  const state = { events: [ev('e1'), ev('e2', { isCancelled: true })], failAuth: false, syncCalls: 0 };
  let h: Harness;
  let c: Client;
  let accountId = '';

  beforeAll(async () => {
    h = await startHarness({ providers: { google: fakeProvider(state) } });
    c = h.client();
    await c.signup();
  });
  afterAll(async () => {
    await h.close();
  });

  it('reports configured and unconfigured providers honestly', async () => {
    const r = await c.call('GET', `${V}/calendar/providers`);
    const g = r.json.items.find((p: { provider: string }) => p.provider === 'google');
    const m = r.json.items.find((p: { provider: string }) => p.provider === 'microsoft');
    expect(g.configured).toBe(true);
    expect(m.configured).toBe(false);
    expect(m.missingEnv.length).toBeGreaterThan(0);
    const blocked = await c.call('POST', `${V}/calendar/accounts/connect`, { provider: 'microsoft' });
    expect(blocked.status).toBe(503);
  });

  it('completes OAuth (PKCE, single-use state) and discovers calendars', async () => {
    const start = await c.call('POST', `${V}/calendar/accounts/connect`, { provider: 'google' });
    expect(start.status).toBe(200);
    const url = new URL(start.json.authorizationUrl);
    const st = url.searchParams.get('state') as string;
    const bad = await c.call('GET', `${V}/calendar/oauth/google/callback?code=abc&state=wrong`);
    expect(bad.status).toBe(302);
    expect(String(bad.headers.location)).toContain('error=');
    const ok = await c.call('GET', `${V}/calendar/oauth/google/callback?code=abc&state=${st}`);
    expect(String(ok.headers.location)).toContain('connected=1');
    const replay = await c.call('GET', `${V}/calendar/oauth/google/callback?code=abc&state=${st}`);
    expect(String(replay.headers.location)).toContain('error=');
    const accounts = await c.call('GET', `${V}/calendar/accounts`);
    expect(accounts.json.items).toHaveLength(1);
    accountId = accounts.json.items[0].id;
    await c.call('POST', `${V}/calendar/accounts/${accountId}/discover`);
    await workerTick(h.ctx, 10);
    const cals = await c.call('GET', `${V}/calendar/calendars`);
    expect(cals.json.items).toHaveLength(2);
    expect(cals.json.items.find((x: { name: string }) => x.name === 'Main').isSelected).toBe(true);
    expect(cals.json.items.find((x: { name: string }) => x.name === 'Holidays').isSelected).toBe(false);
  });

  it('syncs selected calendars and serves cached events without cancelled ones', async () => {
    await c.call('POST', `${V}/calendar/sync`);
    await workerTick(h.ctx, 10);
    expect(state.syncCalls).toBeGreaterThan(0);
    const d = today();
    const r = await c.call('GET', `${V}/calendar/events?start=${d}&end=${d}`);
    expect(r.status).toBe(200);
    const subjects = r.json.items.map((e: { subject: string }) => e.subject);
    expect(subjects).toContain('Event e1');
    expect(subjects).not.toContain('Event e2');
  });

  it('is read-only: no write endpoints exist for events', async () => {
    const d = today();
    const first = (await c.call('GET', `${V}/calendar/events?start=${d}&end=${d}`)).json.items[0];
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const r = await c.call(method, `${V}/calendar/events/${first.id}`, {});
      expect([404, 405]).toContain(r.status);
    }
  });

  it('tombstones events that disappear upstream', async () => {
    state.events = [];
    await c.call('POST', `${V}/calendar/sync`);
    await workerTick(h.ctx, 10);
    const d = today();
    const r = await c.call('GET', `${V}/calendar/events?start=${d}&end=${d}`);
    expect(r.json.items.map((e: { subject: string }) => e.subject)).not.toContain('Event e1');
  });

  it('never leaks tokens in exports, diagnostics or account DTOs', async () => {
    const texts = [
      (await c.call('GET', `${V}/export/workspace.json`)).text,
      (await c.call('GET', `${V}/calendar/status`)).text,
      (await c.call('GET', `${V}/calendar/accounts`)).text,
    ].join('\n');
    expect(texts).not.toMatch(/AT-1|RT-1|AT-2|tokenCiphertext/);
  });

  it('marks the account as needing reconnect when the refresh token is revoked, and keeps the cache', async () => {
    state.events = [ev('e3')];
    await c.call('POST', `${V}/calendar/sync`);
    await workerTick(h.ctx, 10);
    // expire the stored access token and revoke the refresh token upstream
    h.ctx.sqlite.prepare("UPDATE connected_accounts SET token_expires_at = '2000-01-01T00:00:00.000Z'").run();
    const { writeTokens, readTokens } = await import('../../apps/server/src/calendar/store.js');
    const { schema } = await import('../../apps/server/src/db/client.js');
    const acc = h.ctx.db.select().from(schema.connectedAccounts).get() as typeof schema.connectedAccounts.$inferSelect;
    const tok = readTokens(h.ctx, acc);
    writeTokens(h.ctx, acc.id, { ...tok, expiresAt: '2000-01-01T00:00:00.000Z' });
    state.failAuth = true;
    await c.call('POST', `${V}/calendar/sync`);
    for (let i = 0; i < 3; i++) await workerTick(h.ctx, 10);
    const accounts = await c.call('GET', `${V}/calendar/accounts`);
    expect(accounts.json.items[0].status).toBe('reauth_required');
    const d = today();
    const cached = await c.call('GET', `${V}/calendar/events?start=${d}&end=${d}`);
    expect(cached.json.items.map((e: { subject: string }) => e.subject)).toContain('Event e3');
  });

  it('disconnect removes tokens and (optionally) cached events', async () => {
    const r = await c.call('DELETE', `${V}/calendar/accounts/${accountId}?deleteCache=true`);
    expect(r.status).toBe(200);
    const d = today();
    expect((await c.call('GET', `${V}/calendar/events?start=${d}&end=${d}`)).json.items).toHaveLength(0);
    const row = h.ctx.sqlite.prepare('SELECT status FROM connected_accounts WHERE id = ?').get(accountId) as { status: string } | undefined;
    expect(!row || row.status === 'disconnected').toBe(true);
  });
});
