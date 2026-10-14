// Plain DTO types for calendar connection management (no runtime schema needed on the client).
export type AccountStatus = 'connected' | 'reauth_required' | 'error' | 'disconnected';
export type SyncHealth = 'pending' | 'ok' | 'stale' | 'error' | 'reauth_required' | 'rate_limited';

export interface CalendarProviderInfo {
  provider: 'google' | 'microsoft';
  label: string;
  configured: boolean;
  missingEnv: string[];
  redirectUri: string;
  scopes: string[];
  guidance: string;
}

export interface CalendarAccountDTO {
  id: string;
  provider: 'google' | 'microsoft';
  displayEmail: string | null;
  displayName: string | null;
  status: AccountStatus;
  lastError: string | null;
  scopes: string[];
  connectedAt: string;
  lastRefreshAt: string | null;
  calendarCount: number;
}

export interface ExternalCalendarDTO {
  id: string;
  accountId: string;
  provider: 'google' | 'microsoft';
  accountLabel: string;
  providerCalendarId: string;
  name: string;
  displayName: string | null;
  color: string;
  timezone: string | null;
  isSelected: boolean;
  isPrimary: boolean;
  readOnly: boolean;
  syncHealth: SyncHealth;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  isStale: boolean;
}

export interface SyncJobDTO {
  id: string;
  kind: string;
  calendarId: string | null;
  accountId: string | null;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  attemptCount: number;
  requestedAt: string;
  nextAttemptAt: string;
  finishedAt: string | null;
  lastErrorCode: string | null;
}

export interface SyncStatusDTO {
  anyConfigured: boolean;
  accounts: number;
  calendars: number;
  queued: number;
  running: number;
  lastSuccessAt: string | null;
  oldestStaleSeconds: number | null;
  recentJobs: SyncJobDTO[];
}
