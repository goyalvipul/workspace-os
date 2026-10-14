import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import {
  COLORS,
  addDays,
  endOfMonth,
  newId,
  startOfMonth,
  todayLocal,
  type CalendarAccountDTO,
  type CalendarProviderInfo,
  type ExternalCalendarDTO,
  type SyncJobDTO,
  type SyncStatusDTO,
} from '@wos/shared';
import type { AppContext } from '../context.js';
import { schema } from '../db/client.js';
import { AppError, badRequest, notFound } from '../errors.js';
import { decryptString, encryptString } from '../security/crypto.js';
import { emitEvent } from '../services/events.js';
import { nowIso, randomToken, sha256 } from '../util.js';
import { applySync, calendarIsStale, loadCursor, pruneOldEvents, readTokens, writeTokens, type TokenPayload } from './store.js';
import { ProviderError, type ProviderId, type RemoteCalendar } from './types.js';

type AccRow = typeof schema.connectedAccounts.$inferSelect;
type CalRow = typeof schema.externalCalendars.$inferSelect;
type JobRow = typeof schema.syncJobs.$inferSelect;

const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 6;
const WORKER_ID = `w-${randomToken(6)}`;

// ---------- provider info ----------
const GUIDANCE: Record<ProviderId, string> = {
  google: 'Create an OAuth client (Web application) in Google Cloud Console, enable the Google Calendar API, add the redirect URI shown here, and put the client id/secret in .env on the host. See docs/CALENDAR_SYNC.md.',
  microsoft: 'Register an app in Microsoft Entra, add a Web redirect URI shown here, grant delegated Calendars.Read, create a client secret and put the id/secret in .env on the host. Work/school tenants may require admin consent.',
};

export function providerInfos(ctx: AppContext): CalendarProviderInfo[] {
  return (['google', 'microsoft'] as ProviderId[]).map((p) => {
    const prov = ctx.providers[p];
    return { provider: p, label: p === 'google' ? 'Google Calendar' : 'Microsoft Outlook', configured: prov.isConfigured(), missingEnv: prov.missingConfig(), redirectUri: prov.redirectUri(), scopes: prov.scopes(), guidance: GUIDANCE[p] };
  });
}

// ---------- DTOs ----------
export function accountDTO(a: AccRow, calendarCount: number): CalendarAccountDTO {
  return {
    id: a.id,
    provider: a.provider as ProviderId,
    displayEmail: a.displayEmail,
    displayName: a.displayName,
    status: a.status as CalendarAccountDTO['status'],
    lastError: a.lastError,
    scopes: JSON.parse(a.scopesJson) as string[],
    connectedAt: a.createdAt,
    lastRefreshAt: a.lastRefreshAt,
    calendarCount,
  };
}

export function calendarDTO(ctx: AppContext, c: CalRow, a: AccRow): ExternalCalendarDTO {
  return {
    id: c.id,
    accountId: a.id,
    provider: a.provider as ProviderId,
    accountLabel: a.displayEmail ?? a.displayName ?? a.provider,
    providerCalendarId: c.providerCalendarId,
    name: c.name,
    displayName: c.displayName,
    color: c.color,
    timezone: c.timezone,
    isSelected: c.isSelected,
    isPrimary: c.isPrimary,
    readOnly: c.readOnly,
    syncHealth: c.syncHealth as ExternalCalendarDTO['syncHealth'],
    lastSuccessAt: c.lastSuccessAt,
    lastAttemptAt: c.lastAttemptAt,
    lastErrorCode: c.lastErrorCode,
    lastErrorMessage: c.lastErrorRedacted,
    coverageStart: c.coverageStart,
    coverageEnd: c.coverageEnd,
    isStale: calendarIsStale(ctx, c),
  };
}

export function listAccounts(ctx: AppContext, ownerId: string): CalendarAccountDTO[] {
  const accs = ctx.db.select().from(schema.connectedAccounts).where(eq(schema.connectedAccounts.ownerUserId, ownerId)).orderBy(asc(schema.connectedAccounts.createdAt)).all();
  return accs.map((a) => accountDTO(a, ctx.db.select({ c: sql<number>`count(*)` }).from(schema.externalCalendars).where(eq(schema.externalCalendars.connectedAccountId, a.id)).get()?.c ?? 0));
}

export function listCalendars(ctx: AppContext, ownerId: string, accountId?: string): ExternalCalendarDTO[] {
  return ctx.db
    .select({ c: schema.externalCalendars, a: schema.connectedAccounts })
    .from(schema.externalCalendars)
    .innerJoin(schema.connectedAccounts, eq(schema.connectedAccounts.id, schema.externalCalendars.connectedAccountId))
    .where(and(eq(schema.connectedAccounts.ownerUserId, ownerId), accountId ? eq(schema.connectedAccounts.id, accountId) : undefined))
    .orderBy(asc(schema.connectedAccounts.createdAt), desc(schema.externalCalendars.isPrimary), asc(schema.externalCalendars.name))
    .all()
    .map((r) => calendarDTO(ctx, r.c, r.a));
}

export function loadOwnedCalendar(ctx: AppContext, ownerId: string, calendarId: string) {
  const r = ctx.db
    .select({ c: schema.externalCalendars, a: schema.connectedAccounts })
    .from(schema.externalCalendars)
    .innerJoin(schema.connectedAccounts, eq(schema.connectedAccounts.id, schema.externalCalendars.connectedAccountId))
    .where(and(eq(schema.externalCalendars.id, calendarId), eq(schema.connectedAccounts.ownerUserId, ownerId)))
    .get();
  if (!r) throw notFound('Calendar');
  return r;
}

export function loadOwnedAccount(ctx: AppContext, ownerId: string, accountId: string): AccRow {
  const a = ctx.db.select().from(schema.connectedAccounts).where(and(eq(schema.connectedAccounts.id, accountId), eq(schema.connectedAccounts.ownerUserId, ownerId))).get();
  if (!a) throw notFound('Account');
  return a;
}

// ---------- OAuth (Authorization Code + PKCE, backend-owned) ----------
interface PendingAuth {
  provider: ProviderId;
  userId: string;
  sessionId: string;
  verifier: string;
  expiresAt: number;
  reconnectAccountId: string | null;
}
const pending = new Map<string, PendingAuth>();

export function startConnect(ctx: AppContext, userId: string, sessionId: string, provider: ProviderId, reconnectAccountId: string | null): { authorizationUrl: string } {
  const prov = ctx.providers[provider];
  if (!prov.isConfigured()) throw new AppError(503, 'PROVIDER_NOT_CONFIGURED', `${provider} is not configured. Missing: ${prov.missingConfig().join(', ')}`);
  for (const [k, v] of pending) if (v.expiresAt < Date.now()) pending.delete(k);
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  let loginHint: string | null = null;
  if (reconnectAccountId) loginHint = loadOwnedAccount(ctx, userId, reconnectAccountId).displayEmail;
  pending.set(state, { provider, userId, sessionId, verifier, expiresAt: Date.now() + 10 * 60_000, reconnectAccountId });
  return { authorizationUrl: prov.buildAuthUrl({ state, codeChallenge: challenge, loginHint }) };
}

export async function completeConnect(ctx: AppContext, userId: string, sessionId: string, provider: ProviderId, code: string, state: string): Promise<AccRow> {
  const p = pending.get(state);
  pending.delete(state); // single use
  if (!p || p.expiresAt < Date.now() || p.provider !== provider || p.userId !== userId || p.sessionId !== sessionId) {
    throw new AppError(400, 'OAUTH_STATE_INVALID', 'The sign-in attempt expired or was not started from this session. Start again from Settings > Connected accounts.');
  }
  const prov = ctx.providers[provider];
  let result;
  try {
    result = await prov.exchangeCode({ code, codeVerifier: p.verifier });
  } catch (e) {
    throw new AppError(502, 'OAUTH_EXCHANGE_FAILED', e instanceof ProviderError ? e.message : 'Could not complete sign-in with the provider');
  }
  const { tokens, profile } = result;
  const A = schema.connectedAccounts;
  const existing = ctx.db.select().from(A).where(and(eq(A.ownerUserId, userId), eq(A.provider, provider), eq(A.providerSubject, profile.subject))).get();
  let refresh = tokens.refreshToken ?? null;
  if (!refresh && existing) {
    try {
      refresh = readTokens(ctx, existing).refreshToken;
    } catch {
      refresh = null;
    }
  }
  if (!refresh) throw new AppError(502, 'OAUTH_NO_REFRESH_TOKEN', 'The provider did not return a refresh token. Remove the app from your provider account permissions and connect again.');
  const payload: TokenPayload = { accessToken: tokens.accessToken, refreshToken: refresh, expiresAt: tokens.expiresAt };
  const now = nowIso();
  let id = existing?.id;
  if (!existing) {
    id = newId();
    const enc = encryptString(ctx.keyring, JSON.stringify(payload), `account:${id}`);
    ctx.db.insert(A).values({ id, ownerUserId: userId, provider, providerSubject: profile.subject, displayEmail: profile.email, displayName: profile.name, scopesJson: JSON.stringify(tokens.scopes), tokenCiphertext: enc.ciphertext, encryptionKeyVersion: enc.keyVersion, tokenExpiresAt: payload.expiresAt, status: 'connected', lastRefreshAt: now, createdAt: now, updatedAt: now }).run();
  } else {
    writeTokens(ctx, existing.id, payload, tokens.scopes);
    ctx.db.update(A).set({ status: 'connected', lastError: null, displayEmail: profile.email ?? existing.displayEmail, displayName: profile.name ?? existing.displayName, updatedAt: now }).where(eq(A.id, existing.id)).run();
  }
  enqueue(ctx, { kind: 'discover', accountId: id as string });
  ctx.nudgeSync?.();
  emitEvent(ctx, userId, 'calendar.changed', id as string, { accounts: true });
  return ctx.db.select().from(A).where(eq(A.id, id as string)).get() as AccRow;
}

export async function disconnectAccount(ctx: AppContext, ownerId: string, accountId: string, deleteCache: boolean): Promise<void> {
  const acc = loadOwnedAccount(ctx, ownerId, accountId);
  const prov = ctx.providers[acc.provider as ProviderId];
  try {
    const t = readTokens(ctx, acc);
    if (prov.revoke) await prov.revoke(t.refreshToken ?? t.accessToken);
  } catch {
    /* best effort; tokens are removed locally regardless */
  }
  ctx.db.delete(schema.syncJobs).where(and(eq(schema.syncJobs.accountId, accountId), inArray(schema.syncJobs.status, ['queued', 'running']))).run();
  if (deleteCache) {
    ctx.db.delete(schema.connectedAccounts).where(eq(schema.connectedAccounts.id, accountId)).run(); // cascades calendars/events/cursors
  } else {
    const wiped = encryptString(ctx.keyring, JSON.stringify({ accessToken: '', refreshToken: null, expiresAt: nowIso() }), `account:${accountId}`);
    ctx.db.delete(schema.syncCursors).where(inArray(schema.syncCursors.externalCalendarId, ctx.db.select({ id: schema.externalCalendars.id }).from(schema.externalCalendars).where(eq(schema.externalCalendars.connectedAccountId, accountId)))).run();
    ctx.db.update(schema.connectedAccounts).set({ status: 'disconnected', tokenCiphertext: wiped.ciphertext, encryptionKeyVersion: wiped.keyVersion, lastError: null, updatedAt: nowIso() }).where(eq(schema.connectedAccounts.id, accountId)).run();
    ctx.db.update(schema.externalCalendars).set({ syncHealth: 'stale', updatedAt: nowIso() }).where(eq(schema.externalCalendars.connectedAccountId, accountId)).run();
  }
  emitEvent(ctx, ownerId, 'calendar.changed', accountId, { accounts: true });
}

// ---------- job queue ----------
export function enqueue(ctx: AppContext, a: { kind: 'discover' | 'sync' | 'backfill'; accountId?: string; calendarId?: string; payload?: Record<string, unknown>; delayMs?: number }): string {
  const J = schema.syncJobs;
  const dedupeKey = `${a.kind}:${a.calendarId ?? a.accountId ?? 'all'}:${a.payload ? sha256(JSON.stringify(a.payload)).slice(0, 8) : ''}`;
  const existing = ctx.db.select().from(J).where(and(eq(J.dedupeKey, dedupeKey), inArray(J.status, ['queued', 'running']))).get();
  if (existing) {
    // coalesce: pull a queued job forward if an immediate run was requested
    if (existing.status === 'queued' && !a.delayMs && Date.parse(existing.nextAttemptAt) > Date.now()) ctx.db.update(J).set({ nextAttemptAt: nowIso() }).where(eq(J.id, existing.id)).run();
    return existing.id;
  }
  const id = newId();
  const now = nowIso();
  ctx.db.insert(J).values({ id, jobKind: a.kind, accountId: a.accountId ?? null, calendarId: a.calendarId ?? null, requestedAt: now, nextAttemptAt: new Date(Date.now() + (a.delayMs ?? 0)).toISOString(), status: 'queued', dedupeKey, payloadJson: a.payload ? JSON.stringify(a.payload) : null }).run();
  return id;
}

function jobDTO(j: JobRow): SyncJobDTO {
  return { id: j.id, kind: j.jobKind, calendarId: j.calendarId, accountId: j.accountId, status: j.status as SyncJobDTO['status'], attemptCount: j.attemptCount, requestedAt: j.requestedAt, nextAttemptAt: j.nextAttemptAt, finishedAt: j.finishedAt, lastErrorCode: j.lastErrorCode };
}

export function getJob(ctx: AppContext, ownerId: string, jobId: string): SyncJobDTO {
  const j = ctx.db.select().from(schema.syncJobs).where(eq(schema.syncJobs.id, jobId)).get();
  if (!j) throw notFound('Job');
  if (j.accountId) loadOwnedAccount(ctx, ownerId, j.accountId);
  else if (j.calendarId) loadOwnedCalendar(ctx, ownerId, j.calendarId);
  return jobDTO(j);
}

export function syncStatus(ctx: AppContext, ownerId: string): SyncStatusDTO {
  const cals = listCalendars(ctx, ownerId).filter((c) => c.isSelected);
  const accIds = ctx.db.select({ id: schema.connectedAccounts.id }).from(schema.connectedAccounts).where(eq(schema.connectedAccounts.ownerUserId, ownerId)).all().map((r) => r.id);
  const J = schema.syncJobs;
  const jobs = accIds.length
    ? ctx.db
        .select()
        .from(J)
        .where(sql`${J.accountId} IN (${sql.join(accIds.map((i) => sql`${i}`), sql`, `)}) OR ${J.calendarId} IN (SELECT id FROM external_calendars WHERE connected_account_id IN (${sql.join(accIds.map((i) => sql`${i}`), sql`, `)}))`)
        .orderBy(desc(J.requestedAt))
        .limit(30)
        .all()
    : [];
  const successes = cals.map((c) => c.lastSuccessAt).filter((x): x is string => !!x).sort();
  const oldest = successes[0];
  return {
    anyConfigured: Object.values(ctx.providers).some((p) => p.isConfigured()),
    accounts: accIds.length,
    calendars: cals.length,
    queued: jobs.filter((j) => j.status === 'queued').length,
    running: jobs.filter((j) => j.status === 'running').length,
    lastSuccessAt: successes.length ? (successes[successes.length - 1] as string) : null,
    oldestStaleSeconds: oldest && cals.every((c) => c.lastSuccessAt) ? Math.round((Date.now() - Date.parse(oldest)) / 1000) : null,
    recentJobs: jobs.map(jobDTO),
  };
}

/** Request sync for every selected calendar of the owner (debounced via dedupe keys). */
export function requestSyncAll(ctx: AppContext, ownerId: string): string[] {
  const ids: string[] = [];
  for (const c of listCalendars(ctx, ownerId)) {
    if (!c.isSelected) continue;
    const acc = loadOwnedAccount(ctx, ownerId, c.accountId);
    if (acc.status === 'disconnected') continue;
    ids.push(enqueue(ctx, { kind: 'sync', calendarId: c.id }));
  }
  ctx.nudgeSync?.();
  return ids;
}

export function requestCalendarSync(ctx: AppContext, ownerId: string, calendarId: string): string {
  const { a } = loadOwnedCalendar(ctx, ownerId, calendarId);
  if (a.status === 'disconnected') throw badRequest('This account is disconnected. Reconnect it first.');
  const id = enqueue(ctx, { kind: 'sync', calendarId });
  ctx.nudgeSync?.();
  return id;
}

/** If [start,end] is not covered by cached data, queue a backfill and return true. */
export function ensureCoverage(ctx: AppContext, ownerId: string, start: string, end: string): boolean {
  let queued = false;
  for (const c of listCalendars(ctx, ownerId)) {
    if (!c.isSelected || !c.coverageStart || !c.coverageEnd) continue;
    if (start >= c.coverageStart && end <= c.coverageEnd) continue;
    const s = start < c.coverageStart ? startOfMonth(start) : c.coverageStart;
    const e = end > c.coverageEnd ? endOfMonth(end) : c.coverageEnd;
    const gaps: { start: string; end: string }[] = [];
    if (s < c.coverageStart) gaps.push({ start: s, end: addDays(c.coverageStart, 0) });
    if (e > c.coverageEnd) gaps.push({ start: addDays(c.coverageEnd, 0), end: e });
    for (const g of gaps) {
      enqueue(ctx, { kind: 'backfill', calendarId: c.id, payload: g });
      queued = true;
    }
  }
  if (queued) ctx.nudgeSync?.();
  return queued;
}

// ---------- token access ----------
const refreshing = new Map<string, Promise<string>>();

async function accessTokenFor(ctx: AppContext, acc: AccRow, force = false): Promise<string> {
  const tokens = readTokens(ctx, acc);
  if (!force && tokens.accessToken && Date.parse(tokens.expiresAt) - Date.now() > 120_000) return tokens.accessToken;
  const inflight = refreshing.get(acc.id);
  if (inflight) return inflight;
  const p = (async () => {
    if (!tokens.refreshToken) throw new ProviderError('auth', 'No refresh token stored', 401, undefined, 'invalid_grant');
    const t = await ctx.providers[acc.provider as ProviderId].refresh(tokens.refreshToken);
    writeTokens(ctx, acc.id, { accessToken: t.accessToken, refreshToken: t.refreshToken ?? tokens.refreshToken, expiresAt: t.expiresAt });
    return t.accessToken;
  })().finally(() => refreshing.delete(acc.id));
  refreshing.set(acc.id, p);
  return p;
}

// ---------- discovery ----------
export async function discoverCalendars(ctx: AppContext, accountId: string): Promise<number> {
  const acc = ctx.db.select().from(schema.connectedAccounts).where(eq(schema.connectedAccounts.id, accountId)).get();
  if (!acc) return 0;
  const prov = ctx.providers[acc.provider as ProviderId];
  const token = await accessTokenFor(ctx, acc);
  let remote: RemoteCalendar[];
  try {
    remote = await prov.listCalendars(token);
  } catch (e) {
    if (e instanceof ProviderError && e.kind === 'auth') remote = await prov.listCalendars(await accessTokenFor(ctx, acc, true));
    else throw e;
  }
  const C = schema.externalCalendars;
  const now = nowIso();
  const existing = ctx.db.select().from(C).where(eq(C.connectedAccountId, accountId)).all();
  let idx = existing.length;
  ctx.db.transaction((tx) => {
    for (const r of remote) {
      const ex = existing.find((x) => x.providerCalendarId === r.providerCalendarId);
      if (ex) {
        tx.update(C).set({ name: r.name, timezone: r.timezone ?? ex.timezone, isPrimary: r.isPrimary, readOnly: r.readOnly, updatedAt: now }).where(eq(C.id, ex.id)).run();
      } else {
        tx.insert(C).values({ id: newId(), connectedAccountId: accountId, providerCalendarId: r.providerCalendarId, name: r.name, color: r.color ?? (COLORS[idx % COLORS.length] as string), timezone: r.timezone, isSelected: r.selectByDefault, isPrimary: r.isPrimary, readOnly: r.readOnly, createdAt: now, updatedAt: now }).run();
        idx++;
      }
    }
  });
  // calendars that vanished upstream: keep the cache but flag them
  const remoteIds = new Set(remote.map((r) => r.providerCalendarId));
  for (const ex of existing) if (!remoteIds.has(ex.providerCalendarId)) ctx.db.update(C).set({ syncHealth: 'error', lastErrorCode: 'calendar_removed', lastErrorRedacted: 'This calendar is no longer available in the provider account', updatedAt: now }).where(eq(C.id, ex.id)).run();
  ctx.db.update(schema.connectedAccounts).set({ status: 'connected', lastError: null, updatedAt: now }).where(eq(schema.connectedAccounts.id, accountId)).run();
  for (const c of ctx.db.select().from(C).where(and(eq(C.connectedAccountId, accountId), eq(C.isSelected, true), ne(C.syncHealth, 'error'))).all()) enqueue(ctx, { kind: 'sync', calendarId: c.id });
  emitEvent(ctx, acc.ownerUserId, 'calendar.changed', accountId, { calendars: true });
  return remote.length;
}

// ---------- sync ----------
export function defaultWindow(tz: string): { start: string; end: string } {
  const today = todayLocal(tz);
  return { start: startOfMonth(addDays(today, -90)), end: endOfMonth(addDays(today, 365)) };
}

async function syncOne(ctx: AppContext, calendarId: string, backfill?: { start: string; end: string }): Promise<{ changed: number }> {
  const row = ctx.db
    .select({ c: schema.externalCalendars, a: schema.connectedAccounts, u: schema.users })
    .from(schema.externalCalendars)
    .innerJoin(schema.connectedAccounts, eq(schema.connectedAccounts.id, schema.externalCalendars.connectedAccountId))
    .innerJoin(schema.users, eq(schema.users.id, schema.connectedAccounts.ownerUserId))
    .where(eq(schema.externalCalendars.id, calendarId))
    .get();
  if (!row) return { changed: 0 };
  const { c: cal, a: acc, u: user } = row;
  if (acc.status === 'disconnected') return { changed: 0 };
  const prov = ctx.providers[acc.provider as ProviderId];
  ctx.db.update(schema.externalCalendars).set({ lastAttemptAt: nowIso() }).where(eq(schema.externalCalendars.id, cal.id)).run();

  const window = backfill ?? defaultWindow(user.timezone);
  const run = async (token: string, forceFull: boolean) => {
    const cursor = backfill || forceFull ? null : loadCursor(ctx, cal.id);
    return prov.syncCalendar(token, {
      calendar: { providerCalendarId: cal.providerCalendarId, timezone: cal.timezone, isPrimary: backfill ? false : cal.isPrimary },
      cursor,
      window,
      forceFull: !!backfill || forceFull,
    });
  };
  let token = await accessTokenFor(ctx, acc);
  let result;
  try {
    try {
      result = await run(token, false);
    } catch (e) {
      if (e instanceof ProviderError && e.kind === 'auth') {
        token = await accessTokenFor(ctx, acc, true); // one forced refresh, then re-try
        result = await run(token, false);
      } else throw e;
    }
  } catch (e) {
    if (e instanceof ProviderError && e.kind === 'gone') {
      // Google 410: sync token invalid -> safe staged full resync (no wipe; reconciled by generation)
      ctx.db.delete(schema.syncCursors).where(eq(schema.syncCursors.externalCalendarId, cal.id)).run();
      result = await run(token, true);
    } else throw e;
  }
  const { changed } = applySync(ctx, cal, acc.provider as ProviderId, result, { updateCursor: !backfill, coverage: backfill ?? undefined });
  if (changed > 0) emitEvent(ctx, acc.ownerUserId, 'calendar.changed', cal.id, { calendarId: cal.id, changed });
  emitEvent(ctx, acc.ownerUserId, 'sync.status', cal.id, { calendarId: cal.id, health: 'ok' });
  return { changed };
}

function backoffMs(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds) return retryAfterSeconds * 1000 + Math.random() * 3000;
  const base = Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 60 * 60_000);
  return base + Math.random() * base * 0.2;
}

function redact(msg: string): string {
  return msg.replace(/[A-Za-z0-9_\-.]{40,}/g, '[redacted]').slice(0, 200);
}

function recordFailure(ctx: AppContext, job: JobRow, err: unknown): { retryMs: number | null } {
  const pe = err instanceof ProviderError ? err : new ProviderError('other', err instanceof Error ? err.message : 'Unknown error');
  const calId = job.calendarId;
  const acc = job.accountId
    ? ctx.db.select().from(schema.connectedAccounts).where(eq(schema.connectedAccounts.id, job.accountId)).get()
    : calId
      ? ctx.db.select({ a: schema.connectedAccounts }).from(schema.externalCalendars).innerJoin(schema.connectedAccounts, eq(schema.connectedAccounts.id, schema.externalCalendars.connectedAccountId)).where(eq(schema.externalCalendars.id, calId)).get()?.a
      : undefined;
  const now = nowIso();
  const message = redact(pe.message);
  let health: ExternalCalendarDTO['syncHealth'] = 'stale';
  let retry: number | null = backoffMs(job.attemptCount + 1);
  switch (pe.kind) {
    case 'auth':
    case 'forbidden':
      health = 'reauth_required';
      retry = null;
      if (acc) {
        ctx.db.update(schema.connectedAccounts).set({ status: 'reauth_required', lastError: message, updatedAt: now }).where(eq(schema.connectedAccounts.id, acc.id)).run();
        notify(ctx, acc.ownerUserId, `sync-reauth:${acc.id}`, `Reconnect ${acc.displayEmail ?? acc.provider}`, 'The calendar account needs to be reconnected. Cached events are kept.');
      }
      break;
    case 'rate':
      health = 'rate_limited';
      retry = backoffMs(job.attemptCount + 1, pe.retryAfterSeconds);
      break;
    case 'notfound':
      health = 'error';
      retry = null;
      break;
    case 'server':
    case 'network':
      health = 'stale';
      break;
    default:
      health = 'error';
  }
  if (calId) ctx.db.update(schema.externalCalendars).set({ syncHealth: health, lastErrorCode: pe.code ?? pe.kind, lastErrorRedacted: message, lastAttemptAt: now, updatedAt: now }).where(eq(schema.externalCalendars.id, calId)).run();
  if (acc) emitEvent(ctx, acc.ownerUserId, 'sync.status', calId ?? acc.id, { calendarId: calId, health, code: pe.code ?? pe.kind });
  if (job.attemptCount + 1 >= MAX_ATTEMPTS) retry = null;
  return { retryMs: retry };
}

function notify(ctx: AppContext, ownerId: string, dedupeKey: string, title: string, body: string): void {
  const now = nowIso();
  const day = now.slice(0, 10);
  ctx.db.insert(schema.notifications).values({ id: newId(), ownerUserId: ownerId, kind: 'sync_error', title, body, scheduledAt: now, deliveredAt: now, channel: 'inapp', status: 'delivered', dedupeKey: `${dedupeKey}:${day}`, createdAt: now }).onConflictDoNothing().run();
  emitEvent(ctx, ownerId, 'notification', null, { kind: 'sync_error' });
}

function claimJob(ctx: AppContext): JobRow | null {
  const J = schema.syncJobs;
  const now = nowIso();
  // reclaim expired leases (crash recovery)
  ctx.db.update(J).set({ status: 'queued', leaseOwner: null, leaseExpiresAt: null }).where(and(eq(J.status, 'running'), lte(J.leaseExpiresAt, now))).run();
  const candidate = ctx.sqlite
    .prepare(`SELECT id FROM sync_jobs j WHERE j.status='queued' AND j.next_attempt_at <= ? AND NOT EXISTS (SELECT 1 FROM sync_jobs r WHERE r.status='running' AND r.calendar_id IS j.calendar_id AND r.account_id IS j.account_id) ORDER BY j.next_attempt_at LIMIT 1`)
    .get(now) as { id: string } | undefined;
  if (!candidate) return null;
  const claimed = ctx.db.update(J).set({ status: 'running', leaseOwner: WORKER_ID, leaseExpiresAt: new Date(Date.now() + LEASE_MS).toISOString() }).where(and(eq(J.id, candidate.id), eq(J.status, 'queued'))).run();
  if (claimed.changes === 0) return null;
  return ctx.db.select().from(J).where(eq(J.id, candidate.id)).get() ?? null;
}

async function runJob(ctx: AppContext, job: JobRow): Promise<void> {
  const J = schema.syncJobs;
  try {
    if (job.jobKind === 'discover' && job.accountId) await discoverCalendars(ctx, job.accountId);
    else if (job.jobKind === 'sync' && job.calendarId) await syncOne(ctx, job.calendarId);
    else if (job.jobKind === 'backfill' && job.calendarId) {
      const p = JSON.parse(job.payloadJson ?? '{}') as { start?: string; end?: string };
      if (p.start && p.end) await syncOne(ctx, job.calendarId, { start: p.start, end: p.end });
    }
    const now = nowIso();
    ctx.db.update(J).set({ status: 'succeeded', finishedAt: now, lastSuccessAt: now, leaseOwner: null, leaseExpiresAt: null, lastErrorCode: null }).where(eq(J.id, job.id)).run();
  } catch (err) {
    const { retryMs } = recordFailure(ctx, job, err);
    const code = err instanceof ProviderError ? (err.code ?? err.kind) : 'internal';
    ctx.log.warn({ jobId: job.id, kind: job.jobKind, code }, 'calendar job failed');
    if (retryMs !== null) {
      ctx.db.update(J).set({ status: 'queued', attemptCount: job.attemptCount + 1, nextAttemptAt: new Date(Date.now() + retryMs).toISOString(), lastErrorCode: code, leaseOwner: null, leaseExpiresAt: null }).where(eq(J.id, job.id)).run();
    } else {
      ctx.db.update(J).set({ status: 'failed', attemptCount: job.attemptCount + 1, finishedAt: nowIso(), lastErrorCode: code, leaseOwner: null, leaseExpiresAt: null }).where(eq(J.id, job.id)).run();
    }
  }
}

let workerBusy = false;
/** Drain due jobs (one at a time: serialised per process, avoids quota bursts). */
export async function workerTick(ctx: AppContext, maxJobs = 5): Promise<number> {
  if (workerBusy) return 0;
  workerBusy = true;
  let n = 0;
  try {
    for (; n < maxJobs; n++) {
      const job = claimJob(ctx);
      if (!job) break;
      await runJob(ctx, job);
    }
  } finally {
    workerBusy = false;
  }
  return n;
}

/** Enqueue periodic polls. Cadence: active (a client is watching) vs idle. Skips everything when nothing is connected. */
export function scheduleTick(ctx: AppContext): number {
  const cals = ctx.db
    .select({ c: schema.externalCalendars, a: schema.connectedAccounts })
    .from(schema.externalCalendars)
    .innerJoin(schema.connectedAccounts, eq(schema.connectedAccounts.id, schema.externalCalendars.connectedAccountId))
    .where(and(eq(schema.externalCalendars.isSelected, true), eq(schema.connectedAccounts.status, 'connected')))
    .all();
  if (cals.length === 0) return 0;
  const active = ctx.presence.sseClients > 0 || Date.now() - ctx.presence.lastCalendarViewAt < 5 * 60_000;
  const base = (active ? ctx.env.ACTIVE_SYNC_SECONDS : ctx.env.IDLE_SYNC_SECONDS) * 1000;
  let queued = 0;
  for (const { c } of cals) {
    const failing = ['error', 'stale', 'rate_limited'].includes(c.syncHealth);
    const interval = failing ? Math.max(base, 5 * 60_000) : base;
    const last = c.lastAttemptAt ? Date.parse(c.lastAttemptAt) : 0;
    const jitter = 1 + Math.random() * 0.1;
    if (Date.now() - last >= interval * jitter) {
      const before = ctx.db.select({ c: sql<number>`count(*)` }).from(schema.syncJobs).where(and(eq(schema.syncJobs.calendarId, c.id), inArray(schema.syncJobs.status, ['queued', 'running']))).get()?.c ?? 0;
      if (before === 0) {
        enqueue(ctx, { kind: 'sync', calendarId: c.id });
        queued++;
      }
    }
  }
  return queued;
}

export function pruneJobs(ctx: AppContext): number {
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const n = ctx.db.delete(schema.syncJobs).where(and(inArray(schema.syncJobs.status, ['succeeded', 'failed']), lte(schema.syncJobs.finishedAt, cutoff))).run().changes;
  return n + pruneOldEvents(ctx);
}

export { decryptString, isNull };
