import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { addDays, localToUtc, newId, type CalendarEventDTO } from '@wos/shared';
import type { AppContext } from '../context.js';
import { schema, type Tx } from '../db/client.js';
import { decryptString, encryptString } from '../security/crypto.js';
import { nowIso } from '../util.js';
import type { NormalizedEvent, ProviderId, StoredCursor, SyncResult } from './types.js';

type CalRow = typeof schema.externalCalendars.$inferSelect;
type AccRow = typeof schema.connectedAccounts.$inferSelect;

const STALE_FACTOR = 4;

export function calendarIsStale(ctx: AppContext, cal: Pick<CalRow, 'lastSuccessAt' | 'syncHealth'>): boolean {
  if (!cal.lastSuccessAt) return true;
  if (['error', 'reauth_required', 'rate_limited', 'stale'].includes(cal.syncHealth)) return true;
  return Date.now() - Date.parse(cal.lastSuccessAt) > ctx.env.IDLE_SYNC_SECONDS * 1000 * STALE_FACTOR;
}

export function queryEvents(
  ctx: AppContext,
  user: { id: string; timezone: string },
  startDate: string,
  endDate: string,
  opts: { calendarIds?: string[]; includeHidden?: boolean },
): CalendarEventDTO[] {
  const E = schema.calendarEvents;
  const C = schema.externalCalendars;
  const A = schema.connectedAccounts;
  const rangeStart = localToUtc(startDate, '00:00', user.timezone).toISOString();
  const rangeEnd = localToUtc(addDays(endDate, 1), '00:00', user.timezone).toISOString();
  const rows = ctx.db
    .select({ e: E, c: C, a: A })
    .from(E)
    .innerJoin(C, eq(C.id, E.externalCalendarId))
    .innerJoin(A, eq(A.id, C.connectedAccountId))
    .where(
      and(
        eq(A.ownerUserId, user.id),
        isNull(E.deletedAt),
        eq(E.isCancelled, false),
        opts.includeHidden ? undefined : eq(C.isSelected, true),
        opts.calendarIds?.length ? inArray(C.id, opts.calendarIds) : undefined,
        or(
          and(eq(E.isAllDay, false), sql`${E.startUtc} < ${rangeEnd}`, sql`${E.endUtc} > ${rangeStart}`),
          and(eq(E.isAllDay, true), sql`${E.startDateLocal} <= ${endDate}`, sql`${E.endDateLocalExclusive} > ${startDate}`),
        ),
      ),
    )
    .orderBy(E.isAllDay, E.startUtc)
    .limit(5000)
    .all();
  return rows.map(({ e, c, a }) => ({
    id: e.id,
    calendarId: c.id,
    accountId: a.id,
    provider: a.provider as ProviderId,
    providerEventId: e.providerEventId,
    subject: e.subject,
    description: e.descriptionPlain,
    location: e.locationText,
    url: e.url,
    isAllDay: e.isAllDay,
    startUtc: e.startUtc,
    endUtc: e.endUtc,
    startDate: e.isAllDay ? e.startDateLocal : null,
    endDateExclusive: e.isAllDay ? e.endDateLocalExclusive : null,
    timezone: e.timezone,
    isCancelled: e.isCancelled,
    isPrivate: e.isPrivate,
    availability: e.availability,
    color: c.color,
    calendarName: c.displayName ?? c.name,
    accountLabel: a.displayEmail ?? a.displayName ?? a.provider,
    isStale: calendarIsStale(ctx, c),
  }));
}

// ---------- token payload ----------
export interface TokenPayload {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
}

export function readTokens(ctx: AppContext, acc: AccRow): TokenPayload {
  return JSON.parse(decryptString(ctx.keyring, acc.tokenCiphertext, `account:${acc.id}`)) as TokenPayload;
}

export function writeTokens(ctx: AppContext, accountId: string, tokens: TokenPayload, scopes?: string[]): void {
  const enc = encryptString(ctx.keyring, JSON.stringify(tokens), `account:${accountId}`);
  ctx.db
    .update(schema.connectedAccounts)
    .set({ tokenCiphertext: enc.ciphertext, encryptionKeyVersion: enc.keyVersion, tokenExpiresAt: tokens.expiresAt, lastRefreshAt: nowIso(), updatedAt: nowIso(), ...(scopes ? { scopesJson: JSON.stringify(scopes) } : {}) })
    .where(eq(schema.connectedAccounts.id, accountId))
    .run();
}

// ---------- cursors ----------
export function loadCursor(ctx: AppContext, calendarId: string): StoredCursor | null {
  const row = ctx.db.select().from(schema.syncCursors).where(eq(schema.syncCursors.externalCalendarId, calendarId)).get();
  if (!row) return null;
  try {
    return {
      kind: row.cursorKind,
      value: decryptString(ctx.keyring, row.cursorValueCiphertext, `cursor:${calendarId}`),
      fingerprint: row.queryFingerprint,
      windowStart: row.windowStartDate,
      windowEnd: row.windowEndDate,
    };
  } catch {
    return null; // unreadable -> treat as missing and do a safe full resync
  }
}

function saveCursor(ctx: AppContext, tx: Tx, provider: string, calendarId: string, c: StoredCursor, generation: number, full: boolean) {
  const enc = encryptString(ctx.keyring, c.value, `cursor:${calendarId}`).ciphertext;
  const now = nowIso();
  tx.delete(schema.syncCursors).where(eq(schema.syncCursors.externalCalendarId, calendarId)).run();
  tx.insert(schema.syncCursors)
    .values({
      id: newId(),
      externalCalendarId: calendarId,
      provider,
      windowStartDate: c.windowStart,
      windowEndDate: c.windowEnd,
      cursorKind: c.kind,
      cursorValueCiphertext: enc,
      queryFingerprint: c.fingerprint,
      generation,
      lastFullSyncAt: full ? now : null,
      lastIncrementalAt: now,
      status: 'ok',
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

// ---------- applying a sync result (single transaction; cursor committed LAST and only on success) ----------
function eventRow(calendarId: string, e: NormalizedEvent, generation: number) {
  return {
    externalCalendarId: calendarId,
    providerEventId: e.providerEventId,
    providerIcalUid: e.icalUid,
    providerSeriesId: e.seriesId,
    occurrenceIdentity: e.occurrenceIdentity || 'single',
    subject: e.subject,
    descriptionPlain: e.description,
    locationText: e.location,
    url: e.url,
    startUtc: e.startUtc,
    endUtc: e.endUtc,
    startDateLocal: e.startDate,
    endDateLocalExclusive: e.endDateExclusive,
    timezone: e.timezone,
    isAllDay: e.isAllDay,
    isCancelled: e.isCancelled,
    isPrivate: e.isPrivate,
    availability: e.availability,
    etag: e.etag,
    lastModifiedAt: e.lastModifiedAt,
    lastSeenGeneration: generation,
    deletedAt: null as string | null,
  };
}

const SIGNIFICANT = ['subject', 'startUtc', 'endUtc', 'startDateLocal', 'endDateLocalExclusive', 'isAllDay', 'isCancelled', 'locationText', 'descriptionPlain', 'etag', 'lastModifiedAt'] as const;

export function applySync(ctx: AppContext, calendar: CalRow, provider: ProviderId, result: SyncResult, opts: { updateCursor: boolean; coverage?: { start: string; end: string } }): { changed: number } {
  const E = schema.calendarEvents;
  const generation = Date.now();
  let changed = 0;
  ctx.db.transaction((tx) => {
    for (const ev of result.events) {
      const row = eventRow(calendar.id, ev, generation);
      const existing = tx
        .select()
        .from(E)
        .where(and(eq(E.externalCalendarId, calendar.id), eq(E.providerEventId, row.providerEventId), eq(E.occurrenceIdentity, row.occurrenceIdentity)))
        .get();
      if (!existing) {
        tx.insert(E).values({ id: newId(), ...row }).run();
        changed++;
      } else {
        const differs = existing.deletedAt !== null || SIGNIFICANT.some((k) => existing[k] !== row[k]);
        tx.update(E).set(row).where(eq(E.id, existing.id)).run();
        if (differs) changed++;
      }
    }
    const now = nowIso();
    if (result.removed.length) {
      for (let i = 0; i < result.removed.length; i += 200) {
        const part = result.removed.slice(i, i + 200);
        changed += tx.update(E).set({ deletedAt: now }).where(and(eq(E.externalCalendarId, calendar.id), inArray(E.providerEventId, part), isNull(E.deletedAt))).run().changes;
      }
    }
    if (result.full) {
      // Tombstone rows inside the window that this authoritative fetch did not return
      const startUtc = localToUtc(addDays(result.window.start, -1), '00:00', 'UTC').toISOString();
      const endUtc = localToUtc(addDays(result.window.end, 2), '00:00', 'UTC').toISOString();
      const stale = and(
        eq(E.externalCalendarId, calendar.id),
        isNull(E.deletedAt),
        lt(E.lastSeenGeneration, generation),
        or(
          and(eq(E.isAllDay, false), sql`${E.startUtc} >= ${startUtc}`, sql`${E.startUtc} <= ${endUtc}`),
          and(eq(E.isAllDay, true), sql`${E.startDateLocal} >= ${result.window.start}`, sql`${E.startDateLocal} <= ${result.window.end}`),
        ),
      );
      changed += tx.update(E).set({ deletedAt: now }).where(stale).run().changes;
    }
    if (opts.updateCursor) {
      if (result.cursor) saveCursor(ctx, tx, provider, calendar.id, result.cursor, generation, result.full);
      else if (result.clearCursor) tx.delete(schema.syncCursors).where(eq(schema.syncCursors.externalCalendarId, calendar.id)).run();
    }
    const cov = opts.coverage ?? result.window;
    const newStart = !calendar.coverageStart || cov.start < calendar.coverageStart ? cov.start : calendar.coverageStart;
    const newEnd = !calendar.coverageEnd || cov.end > calendar.coverageEnd ? cov.end : calendar.coverageEnd;
    tx.update(schema.externalCalendars)
      .set({ lastSuccessAt: now, lastAttemptAt: now, syncHealth: 'ok', lastErrorCode: null, lastErrorRedacted: null, coverageStart: newStart, coverageEnd: newEnd, updatedAt: now })
      .where(eq(schema.externalCalendars.id, calendar.id))
      .run();
  });
  return { changed };
}

export function pruneOldEvents(ctx: AppContext): number {
  const E = schema.calendarEvents;
  const cutoff = new Date(Date.now() - 400 * 86_400_000).toISOString();
  const tomb = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const a = ctx.db.delete(E).where(and(sql`${E.deletedAt} IS NOT NULL`, lt(E.deletedAt, tomb))).run().changes;
  const b = ctx.db.delete(E).where(and(eq(E.isAllDay, false), lt(E.endUtc, cutoff))).run().changes;
  return a + b;
}
