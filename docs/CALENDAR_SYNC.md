# Calendar sync

Read-only. The app never creates, edits or deletes events at Google or Microsoft.

## Connect flow
1. `POST /calendar/accounts/connect { provider }` creates a single-use `state` + PKCE verifier (stored server-side, short TTL) and returns the provider consent URL.
2. Provider redirects to `/api/v1/calendar/oauth/<provider>/callback?code&state`. The server validates and consumes `state`, exchanges the code (PKCE), encrypts tokens (AES-256-GCM), discovers calendars, queues a first sync, then redirects the browser to `/settings/accounts?connected=1` (or `?error=<reason>`).
3. Scopes are read-only: Google `calendar.readonly` (+ identity), Microsoft `Calendars.Read offline_access User.Read`.

## Sync
- Jobs live in `sync_jobs`; `workerTick` (every 3 s) runs queued jobs; a scheduler enqueues active-view syncs every `ACTIVE_SYNC_SECONDS` (60) and idle ones every `IDLE_SYNC_SECONDS` (300). Manual: "Sync now".
- Incremental via provider cursors (Google sync token, Microsoft delta link) kept in `sync_cursors`. An expired cursor triggers a full resync of that calendar.
- Deletions become tombstones, removed from the agenda but kept until pruned.
- Private/confidential events are masked to "Busy" before storage.
- All-day events are stored as date-only; timed events as UTC + original zone.
- Errors: token refresh failure sets the account to `reauth_required` (UI shows Reconnect); transient errors back off exponentially.
- Disconnect removes tokens and optionally the cached events.

## Testing
`tests/api/calendar.test.ts` drives the full flow against a fake provider (state single-use, discovery, incremental sync, tombstones, read-only guarantee, no token leakage, reauth, disconnect). Real providers: see `PROVIDER_NOTES.md`.
