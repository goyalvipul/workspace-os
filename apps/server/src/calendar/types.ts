export type ProviderId = 'google' | 'microsoft';

export type ProviderErrorKind = 'auth' | 'forbidden' | 'rate' | 'server' | 'gone' | 'notfound' | 'network' | 'other';

export class ProviderError extends Error {
  constructor(
    public kind: ProviderErrorKind,
    message: string,
    public status = 0,
    public retryAfterSeconds?: number,
    public code?: string,
  ) {
    super(message);
  }
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string; // ISO
  scopes: string[];
  idToken?: string;
}

export interface ProviderProfile {
  subject: string;
  email: string | null;
  name: string | null;
}

export interface RemoteCalendar {
  providerCalendarId: string;
  name: string;
  color: string | null;
  timezone: string | null;
  isPrimary: boolean;
  readOnly: boolean;
  /** true when this calendar should be shown by default */
  selectByDefault: boolean;
}

export interface NormalizedEvent {
  providerEventId: string;
  icalUid: string | null;
  seriesId: string | null;
  /** canonical, never empty. 'single' when the provider id is already unique per occurrence */
  occurrenceIdentity: string;
  subject: string;
  description: string;
  location: string;
  url: string | null;
  startUtc: string | null;
  endUtc: string | null;
  startDate: string | null;
  endDateExclusive: string | null;
  timezone: string;
  isAllDay: boolean;
  isCancelled: boolean;
  isPrivate: boolean;
  availability: 'busy' | 'free' | 'tentative' | 'oof' | 'unknown';
  etag: string | null;
  lastModifiedAt: string | null;
}

export interface StoredCursor {
  kind: string;
  value: string;
  fingerprint: string;
  windowStart: string | null;
  windowEnd: string | null;
}

export interface SyncInput {
  calendar: { providerCalendarId: string; timezone: string | null; isPrimary: boolean };
  cursor: StoredCursor | null;
  window: { start: string; end: string }; // local dates, inclusive
  /** ignore the cursor and fetch the window authoritatively (backfill / forced full) */
  forceFull: boolean;
}

export interface SyncResult {
  /** true: `events` is the complete set for `window` -> rows not seen are tombstoned */
  full: boolean;
  events: NormalizedEvent[];
  removed: string[];
  window: { start: string; end: string };
  /** cursor to persist after the transaction commits (null: keep/clear per `clearCursor`) */
  cursor: StoredCursor | null;
  clearCursor?: boolean;
}

export interface CalendarProvider {
  id: ProviderId;
  isConfigured(): boolean;
  missingConfig(): string[];
  redirectUri(): string;
  scopes(): string[];
  buildAuthUrl(args: { state: string; codeChallenge: string; loginHint?: string | null }): string;
  exchangeCode(args: { code: string; codeVerifier: string }): Promise<{ tokens: TokenSet; profile: ProviderProfile }>;
  refresh(refreshToken: string): Promise<TokenSet>;
  listCalendars(accessToken: string): Promise<RemoteCalendar[]>;
  syncCalendar(accessToken: string, input: SyncInput): Promise<SyncResult>;
  revoke?(token: string): Promise<void>;
}

export function stripHtml(input: string, max = 4000): string {
  return input
    .replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

export function safeHttpsUrl(url: unknown, allowedHostSuffixes: string[]): string | null {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    if (!allowedHostSuffixes.some((s) => u.hostname === s || u.hostname.endsWith(`.${s}`))) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export async function httpJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ status: number; body: T; headers: Headers }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 25_000) });
  } catch (e) {
    throw new ProviderError('network', e instanceof Error ? e.message : 'Network error');
  }
  const text = await res.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 500) };
    }
  }
  const retryAfter = Number(res.headers.get('retry-after'));
  const retry = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
  if (res.status >= 200 && res.status < 300) return { status: res.status, body: body as T, headers: res.headers };
  const msg = JSON.stringify((body as { error?: unknown })?.error ?? '').slice(0, 200);
  if (res.status === 401) throw new ProviderError('auth', 'Unauthorized', 401, retry, 'unauthorized');
  if (res.status === 410) throw new ProviderError('gone', 'Gone', 410);
  if (res.status === 404) throw new ProviderError('notfound', 'Not found', 404);
  if (res.status === 429) throw new ProviderError('rate', 'Rate limited', 429, retry ?? 60);
  if (res.status === 403) {
    const reason = JSON.stringify(body).toLowerCase();
    if (reason.includes('ratelimit') || reason.includes('quota') || reason.includes('userratelimitexceeded')) throw new ProviderError('rate', 'Rate limited', 403, retry ?? 60);
    throw new ProviderError('forbidden', 'Forbidden', 403, retry, 'forbidden');
  }
  if (res.status >= 500) throw new ProviderError('server', `Provider error ${res.status}`, res.status, retry);
  throw new ProviderError('other', `Provider returned ${res.status} ${msg}`, res.status, retry);
}
