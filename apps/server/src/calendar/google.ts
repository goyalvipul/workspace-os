import { createHash } from 'node:crypto';
import { addDays } from '@wos/shared';
import type { Env } from '../config/env.js';
import {
  ProviderError,
  httpJson,
  safeHttpsUrl,
  stripHtml,
  type CalendarProvider,
  type NormalizedEvent,
  type RemoteCalendar,
  type SyncInput,
  type SyncResult,
  type TokenSet,
} from './types.js';

// Google Calendar API v3 adapter (read-only).
// Strategy (see docs/CALENDAR_SYNC.md):
//  * `syncToken` is incompatible with timeMin/timeMax filters, so the token (taken from an unexpanded,
//    unfiltered-per-window collection) is used purely as a cheap CHANGE DETECTOR.
//  * When the token reports changes (or on first sync / 410), the coverage window is re-fetched
//    authoritatively with singleEvents=true and reconciled by generation in the DB.
//  * Window fetches never use syncToken, so there is no incompatible parameter combination.

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
];

interface GEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}
interface GEvent {
  id: string;
  status?: string;
  etag?: string;
  iCalUID?: string;
  recurringEventId?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: GEventTime;
  end?: GEventTime;
  visibility?: string;
  transparency?: string;
  updated?: string;
}
interface GList {
  items?: GEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export function normalizeGoogleEvent(e: GEvent, calendarTz: string | null): NormalizedEvent | null {
  if (!e.id || !e.start || !e.end) return null;
  const isPrivate = e.visibility === 'private' || e.visibility === 'confidential';
  const allDay = !!e.start.date;
  const tz = e.start.timeZone ?? calendarTz ?? 'UTC';
  const base = {
    providerEventId: e.id,
    icalUid: e.iCalUID ?? null,
    seriesId: e.recurringEventId ?? null,
    occurrenceIdentity: 'single',
    subject: isPrivate ? 'Private event' : (e.summary ?? '(No title)').slice(0, 300),
    description: isPrivate ? '' : stripHtml(e.description ?? ''),
    location: isPrivate ? '' : (e.location ?? '').slice(0, 300),
    url: isPrivate ? null : safeHttpsUrl(e.htmlLink, ['google.com']),
    timezone: tz,
    isAllDay: allDay,
    isCancelled: e.status === 'cancelled',
    isPrivate,
    availability: (e.transparency === 'transparent' ? 'free' : 'busy') as NormalizedEvent['availability'],
    etag: e.etag ?? null,
    lastModifiedAt: e.updated ?? null,
  };
  if (allDay) {
    return { ...base, startUtc: null, endUtc: null, startDate: e.start.date as string, endDateExclusive: e.end.date ?? addDays(e.start.date as string, 1) };
  }
  if (!e.start.dateTime || !e.end.dateTime) return null;
  return {
    ...base,
    startUtc: new Date(e.start.dateTime).toISOString(),
    endUtc: new Date(e.end.dateTime).toISOString(),
    startDate: null,
    endDateExclusive: null,
  };
}

export function createGoogleProvider(env: Env): CalendarProvider {
  const api = `${env.GOOGLE_API_BASE}/calendar/v3`;
  // The fingerprint describes the QUERY SHAPE used to obtain the token (the token itself encodes timeMin).
  // It must not change as the rolling window moves, otherwise every day would force a full resync.
  const fp = (_window: { start: string; end: string }) => createHash('sha256').update('google:v1:singleEvents=false:fields=ids:timeMin-at-init').digest('hex').slice(0, 16);

  async function token(form: Record<string, string>): Promise<TokenSet & { idToken?: string }> {
    const { body } = await httpJson<{ access_token: string; refresh_token?: string; expires_in: number; scope?: string; id_token?: string }>(env.GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID ?? '', client_secret: env.GOOGLE_CLIENT_SECRET ?? '', ...form }),
    }).catch((e) => {
      if (e instanceof ProviderError && (e.status === 400 || e.status === 401)) throw new ProviderError('auth', 'Authorization was rejected or has been revoked', e.status, undefined, 'invalid_grant');
      throw e;
    });
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
      scopes: (body.scope ?? '').split(' ').filter(Boolean),
      idToken: body.id_token,
    };
  }

  async function listEvents(accessToken: string, calendarId: string, params: Record<string, string>): Promise<{ events: GEvent[]; nextSyncToken?: string }> {
    const events: GEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;
    for (let page = 0; page < 200; page++) {
      const qs = new URLSearchParams({ maxResults: '250', ...params, ...(pageToken ? { pageToken } : {}) });
      const { body } = await httpJson<GList>(`${api}/calendars/${encodeURIComponent(calendarId)}/events?${qs}`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      events.push(...(body.items ?? []));
      pageToken = body.nextPageToken;
      if (!pageToken) {
        nextSyncToken = body.nextSyncToken;
        break;
      }
    }
    return { events, nextSyncToken };
  }

  async function fetchWindow(accessToken: string, calendarId: string, tz: string | null, win: { start: string; end: string }): Promise<NormalizedEvent[]> {
    const { events } = await listEvents(accessToken, calendarId, {
      singleEvents: 'true',
      timeMin: `${addDays(win.start, -1)}T00:00:00Z`,
      timeMax: `${addDays(win.end, 2)}T00:00:00Z`,
    });
    return events.map((e) => normalizeGoogleEvent(e, tz)).filter((e): e is NormalizedEvent => !!e && !e.isCancelled);
  }

  return {
    id: 'google',
    isConfigured: () => !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET,
    missingConfig: () => [!env.GOOGLE_CLIENT_ID && 'GOOGLE_CLIENT_ID', !env.GOOGLE_CLIENT_SECRET && 'GOOGLE_CLIENT_SECRET'].filter((x): x is string => !!x),
    redirectUri: () => env.GOOGLE_REDIRECT_URI,
    scopes: () => SCOPES,
    buildAuthUrl({ state, codeChallenge, loginHint }) {
      const u = new URL(`${env.GOOGLE_AUTH_BASE}/o/oauth2/v2/auth`);
      u.searchParams.set('client_id', env.GOOGLE_CLIENT_ID ?? '');
      u.searchParams.set('redirect_uri', env.GOOGLE_REDIRECT_URI);
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('scope', SCOPES.join(' '));
      u.searchParams.set('access_type', 'offline');
      u.searchParams.set('prompt', 'consent select_account');
      u.searchParams.set('include_granted_scopes', 'true');
      u.searchParams.set('state', state);
      u.searchParams.set('code_challenge', codeChallenge);
      u.searchParams.set('code_challenge_method', 'S256');
      if (loginHint) u.searchParams.set('login_hint', loginHint);
      return u.toString();
    },
    async exchangeCode({ code, codeVerifier }) {
      const t = await token({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: env.GOOGLE_REDIRECT_URI });
      if (!t.idToken) throw new ProviderError('other', 'Google did not return an identity token');
      const claims = JSON.parse(Buffer.from(t.idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as { sub?: string; email?: string; name?: string };
      if (!claims.sub) throw new ProviderError('other', 'Google identity token had no subject');
      return { tokens: t, profile: { subject: claims.sub, email: claims.email ?? null, name: claims.name ?? null } };
    },
    refresh: (refreshToken) => token({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    async listCalendars(accessToken) {
      const out: RemoteCalendar[] = [];
      let pageToken: string | undefined;
      for (let i = 0; i < 20; i++) {
        const qs = new URLSearchParams({ maxResults: '250', ...(pageToken ? { pageToken } : {}) });
        const { body } = await httpJson<{
          items?: { id: string; summary?: string; summaryOverride?: string; backgroundColor?: string; timeZone?: string; primary?: boolean; accessRole?: string; selected?: boolean }[];
          nextPageToken?: string;
        }>(`${api}/users/me/calendarList?${qs}`, { headers: { authorization: `Bearer ${accessToken}` } });
        for (const c of body.items ?? []) {
          const writer = c.accessRole === 'owner' || c.accessRole === 'writer';
          out.push({
            providerCalendarId: c.id,
            name: c.summaryOverride ?? c.summary ?? c.id,
            color: c.backgroundColor ?? null,
            timezone: c.timeZone ?? null,
            isPrimary: !!c.primary,
            readOnly: !writer,
            selectByDefault: !!c.primary || writer,
          });
        }
        pageToken = body.nextPageToken;
        if (!pageToken) break;
      }
      return out;
    },
    async syncCalendar(accessToken, input: SyncInput): Promise<SyncResult> {
      const calId = input.calendar.providerCalendarId;
      const tz = input.calendar.timezone;
      const fingerprint = fp(input.window);
      const detectParams = { singleEvents: 'false', fields: 'nextPageToken,nextSyncToken,items(id)' };

      // 1) Incremental change detection
      if (input.cursor && !input.forceFull && input.cursor.fingerprint === fingerprint && input.cursor.kind === 'google_sync_token') {
        const { events, nextSyncToken } = await listEvents(accessToken, calId, { ...detectParams, syncToken: input.cursor.value });
        const cursor = { kind: 'google_sync_token', value: nextSyncToken ?? input.cursor.value, fingerprint, windowStart: null, windowEnd: null };
        if (events.length === 0) return { full: false, events: [], removed: [], window: input.window, cursor };
        const fetched = await fetchWindow(accessToken, calId, tz, input.window);
        return { full: true, events: fetched, removed: [], window: input.window, cursor };
      }

      // 2) Initial / forced full sync: obtain a token FIRST (so nothing is missed), then load the window
      let cursor: SyncResult['cursor'] = null;
      if (!input.forceFull || input.cursor) {
        const { nextSyncToken } = await listEvents(accessToken, calId, { ...detectParams, timeMin: `${input.window.start}T00:00:00Z` });
        if (nextSyncToken) cursor = { kind: 'google_sync_token', value: nextSyncToken, fingerprint, windowStart: null, windowEnd: null };
      }
      const fetched = await fetchWindow(accessToken, calId, tz, input.window);
      return { full: true, events: fetched, removed: [], window: input.window, cursor, clearCursor: !cursor && !!input.cursor };
    },
    async revoke(tokenValue) {
      await httpJson(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokenValue)}`, { method: 'POST' }).catch(() => undefined);
    },
  };
}
