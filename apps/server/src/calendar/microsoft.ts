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

// Microsoft Graph v1.0 adapter (read-only, delegated Calendars.Read).
// Documented endpoint for delta is /me/calendarView/delta (DEFAULT calendar only).
// Non-default calendars use the documented windowed endpoint /me/calendars/{id}/calendarView with a
// full authoritative window fetch each poll (reconciled by generation) -- see docs/PROVIDER_NOTES.md.

const SCOPES = ['openid', 'profile', 'email', 'offline_access', 'Calendars.Read'];

interface GEvent {
  id: string;
  '@removed'?: { reason?: string };
  iCalUId?: string;
  seriesMasterId?: string;
  subject?: string;
  bodyPreview?: string;
  location?: { displayName?: string };
  webLink?: string;
  start?: { dateTime: string; timeZone: string };
  end?: { dateTime: string; timeZone: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  sensitivity?: string;
  showAs?: string;
  lastModifiedDateTime?: string;
  '@odata.etag'?: string;
}

const AVAIL: Record<string, NormalizedEvent['availability']> = { free: 'free', tentative: 'tentative', busy: 'busy', oof: 'oof', workingElsewhere: 'busy', unknown: 'unknown' };

function utcIso(dt: string): string {
  // Graph returns "2026-10-20T17:00:00.0000000" in the requested timezone (we request UTC)
  return new Date(dt.endsWith('Z') ? dt : `${dt.slice(0, 23)}Z`).toISOString();
}

export function normalizeGraphEvent(e: GEvent): NormalizedEvent | null {
  if (!e.id || !e.start || !e.end) return null;
  const isPrivate = e.sensitivity === 'private' || e.sensitivity === 'confidential';
  const base = {
    providerEventId: e.id,
    icalUid: e.iCalUId ?? null,
    seriesId: e.seriesMasterId ?? null,
    occurrenceIdentity: 'single',
    subject: isPrivate ? 'Private event' : (e.subject ?? '(No title)').slice(0, 300),
    description: isPrivate ? '' : stripHtml(e.bodyPreview ?? '', 2000),
    location: isPrivate ? '' : (e.location?.displayName ?? '').slice(0, 300),
    url: isPrivate ? null : safeHttpsUrl(e.webLink, ['outlook.live.com', 'outlook.office.com', 'outlook.office365.com', 'office.com', 'microsoft.com']),
    timezone: 'UTC',
    isAllDay: !!e.isAllDay,
    isCancelled: !!e.isCancelled,
    isPrivate,
    availability: AVAIL[e.showAs ?? 'busy'] ?? 'busy',
    etag: e['@odata.etag'] ?? null,
    lastModifiedAt: e.lastModifiedDateTime ?? null,
  };
  if (e.isAllDay) {
    const s = e.start.dateTime.slice(0, 10);
    const en = e.end.dateTime.slice(0, 10);
    return { ...base, startUtc: null, endUtc: null, startDate: s, endDateExclusive: en > s ? en : addDays(s, 1) };
  }
  return { ...base, startUtc: utcIso(e.start.dateTime), endUtc: utcIso(e.end.dateTime), startDate: null, endDateExclusive: null };
}

export function createMicrosoftProvider(env: Env): CalendarProvider {
  const graph = new URL(env.MS_GRAPH_BASE);
  const tenantBase = `${env.MS_LOGIN_BASE}/${env.MS_TENANT}/oauth2/v2.0`;
  const PREFER = 'odata.maxpagesize=100, outlook.timezone="UTC"';

  /** SSRF guard: only follow links on the configured Graph host/path. */
  function trusted(link: string): string {
    const u = new URL(link);
    if (u.origin !== graph.origin || !u.pathname.startsWith(graph.pathname)) throw new ProviderError('other', 'Refusing to follow an untrusted pagination link');
    return u.toString();
  }

  async function token(form: Record<string, string>): Promise<TokenSet> {
    const { body } = await httpJson<{ access_token: string; refresh_token?: string; expires_in: number; scope?: string; id_token?: string }>(`${tenantBase}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.MS_CLIENT_ID ?? '', client_secret: env.MS_CLIENT_SECRET ?? '', scope: SCOPES.join(' '), ...form }),
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

  async function pageAll(accessToken: string, firstUrl: string): Promise<{ items: GEvent[]; deltaLink?: string }> {
    const items: GEvent[] = [];
    let url: string | undefined = trusted(firstUrl);
    let deltaLink: string | undefined;
    for (let i = 0; i < 300 && url; i++) {
      const res: { body: { value?: GEvent[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string } } = await httpJson(url, { headers: { authorization: `Bearer ${accessToken}`, prefer: PREFER } });
      items.push(...(res.body.value ?? []));
      if (res.body['@odata.nextLink']) url = trusted(res.body['@odata.nextLink']);
      else {
        deltaLink = res.body['@odata.deltaLink'] ? trusted(res.body['@odata.deltaLink']) : undefined;
        url = undefined;
      }
    }
    return { items, deltaLink };
  }

  const rangeQs = (w: { start: string; end: string }) => `startDateTime=${addDays(w.start, -1)}T00:00:00Z&endDateTime=${addDays(w.end, 2)}T00:00:00Z`;

  return {
    id: 'microsoft',
    isConfigured: () => !!env.MS_CLIENT_ID && !!env.MS_CLIENT_SECRET,
    missingConfig: () => [!env.MS_CLIENT_ID && 'MS_CLIENT_ID', !env.MS_CLIENT_SECRET && 'MS_CLIENT_SECRET'].filter((x): x is string => !!x),
    redirectUri: () => env.MS_REDIRECT_URI,
    scopes: () => SCOPES,
    buildAuthUrl({ state, codeChallenge, loginHint }) {
      const u = new URL(`${tenantBase}/authorize`);
      u.searchParams.set('client_id', env.MS_CLIENT_ID ?? '');
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('redirect_uri', env.MS_REDIRECT_URI);
      u.searchParams.set('response_mode', 'query');
      u.searchParams.set('scope', SCOPES.join(' '));
      u.searchParams.set('state', state);
      u.searchParams.set('code_challenge', codeChallenge);
      u.searchParams.set('code_challenge_method', 'S256');
      u.searchParams.set('prompt', 'select_account');
      if (loginHint) u.searchParams.set('login_hint', loginHint);
      return u.toString();
    },
    async exchangeCode({ code, codeVerifier }) {
      const t = await token({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: env.MS_REDIRECT_URI });
      if (!t.idToken) throw new ProviderError('other', 'Microsoft did not return an identity token');
      const c = JSON.parse(Buffer.from(t.idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as { oid?: string; sub?: string; tid?: string; email?: string; preferred_username?: string; name?: string };
      const id = c.oid ?? c.sub;
      if (!id) throw new ProviderError('other', 'Microsoft identity token had no subject');
      return { tokens: t, profile: { subject: `${c.tid ?? 'common'}.${id}`, email: c.email ?? c.preferred_username ?? null, name: c.name ?? null } };
    },
    refresh: (refreshToken) => token({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    async listCalendars(accessToken) {
      const out: RemoteCalendar[] = [];
      let url: string | undefined = `${env.MS_GRAPH_BASE}/me/calendars?$top=100`;
      for (let i = 0; i < 20 && url; i++) {
        const res: { body: { value?: { id: string; name?: string; hexColor?: string; isDefaultCalendar?: boolean; canEdit?: boolean }[]; '@odata.nextLink'?: string } } = await httpJson(trusted(url), { headers: { authorization: `Bearer ${accessToken}` } });
        for (const c of res.body.value ?? []) {
          out.push({ providerCalendarId: c.id, name: c.name ?? 'Calendar', color: c.hexColor && /^#[0-9a-f]{6}$/i.test(c.hexColor) ? c.hexColor : null, timezone: null, isPrimary: !!c.isDefaultCalendar, readOnly: !c.canEdit, selectByDefault: !!c.isDefaultCalendar || !!c.canEdit });
        }
        url = res.body['@odata.nextLink'];
      }
      return out;
    },
    async syncCalendar(accessToken, input: SyncInput): Promise<SyncResult> {
      const win = input.window;
      const toEvents = (items: GEvent[]) => items.filter((i) => !i['@removed']).map(normalizeGraphEvent).filter((e): e is NormalizedEvent => !!e && !e.isCancelled);

      // Non-default calendars: documented windowed list, authoritative each poll
      if (!input.calendar.isPrimary) {
        const { items } = await pageAll(accessToken, `${env.MS_GRAPH_BASE}/me/calendars/${encodeURIComponent(input.calendar.providerCalendarId)}/calendarView?${rangeQs(win)}&$top=100`);
        return { full: true, events: toEvents(items), removed: [], window: win, cursor: null, clearCursor: !!input.cursor };
      }

      const fingerprint = createHash('sha256').update(`ms:v1:default:${win.start}:${win.end}`).digest('hex').slice(0, 16);
      // Incremental: follow the opaque deltaLink (it encodes the window)
      if (input.cursor && !input.forceFull && input.cursor.kind === 'ms_delta_link' && input.cursor.windowStart === win.start && input.cursor.windowEnd === win.end) {
        const { items, deltaLink } = await pageAll(accessToken, input.cursor.value);
        const removed = items.filter((i) => i['@removed']).map((i) => i.id);
        return {
          full: false,
          events: toEvents(items),
          removed,
          window: win,
          cursor: deltaLink ? { kind: 'ms_delta_link', value: deltaLink, fingerprint, windowStart: win.start, windowEnd: win.end } : input.cursor,
        };
      }
      // Initial / rotated window: full delta round to obtain a deltaLink
      const { items, deltaLink } = await pageAll(accessToken, `${env.MS_GRAPH_BASE}/me/calendarView/delta?${rangeQs(win)}`);
      return {
        full: true,
        events: toEvents(items),
        removed: [],
        window: win,
        cursor: deltaLink ? { kind: 'ms_delta_link', value: deltaLink, fingerprint, windowStart: win.start, windowEnd: win.end } : null,
        clearCursor: !deltaLink && !!input.cursor,
      };
    },
  };
}
