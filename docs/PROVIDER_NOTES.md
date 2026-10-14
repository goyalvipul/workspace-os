# Provider notes (Google and Microsoft)

None of this has been exercised against the live providers yet (BLOCKED_EXTERNAL: no credentials). Adapters are tested against fakes.

## Google Calendar
1. Google Cloud Console: create a project, enable **Google Calendar API**.
2. OAuth consent screen: External, add yourself as a test user (stays in "Testing"; refresh tokens expire after 7 days in that mode, so publish to "In production" for personal use or expect Reconnect prompts).
3. Credentials: OAuth client ID, type **Web application**. Authorised redirect URI: `<PUBLIC_BASE_URL>/api/v1/calendar/oauth/google/callback` (also add `http://localhost:4390/...` for local use).
4. `.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (must match exactly). Scope used: `calendar.readonly`.
Behaviour: incremental sync with `syncToken`; HTTP 410 means full resync.

## Microsoft (Outlook / 365)
1. Entra admin center: App registrations, New registration, supported accounts "Accounts in any organizational directory and personal Microsoft accounts" (`MS_TENANT=common`).
2. Redirect URI (Web): `<PUBLIC_BASE_URL>/api/v1/calendar/oauth/microsoft/callback`.
3. Certificates & secrets: new client secret, copy the **value**.
4. API permissions (delegated): `Calendars.Read`, `offline_access`, `User.Read`.
5. `.env`: `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT`, `MS_REDIRECT_URI`.
Behaviour: `calendarView/delta`; all-day events carry a zone that must be ignored for date-only bounds (implemented, but verify with a real account).

## After configuring
Restart the app, Settings, Calendar accounts: the "not configured" guide disappears and Connect works. Report anything odd in `docs/TROUBLESHOOTING.md` terms (account shows `reauth_required`, sync status in Settings, Diagnostics).
