# API

Base: `/api/v1`. JSON. The generated OpenAPI document is at `GET /api/v1/openapi.json` (requires a session) and is built from the same route definitions that validate requests.

## Auth and safety
- Cookie `wos_session` (HttpOnly, SameSite=Lax, Secure when `PUBLIC_BASE_URL` is https). Mutating requests need `x-csrf-token` (from `GET /auth/session`) and an allowed `Origin`.
- Errors: `{ "error": { "code", "message", "details?" } }`. Notable codes: `VALIDATION`, `UNAUTHENTICATED`, `CSRF`, `VERSION_CONFLICT` (409, includes `current`), `IDEMPOTENCY_KEY_REUSED` (422), `RATE_LIMITED`.
- Send `Idempotency-Key` on creates and other non-repeatable POSTs.
- Updates send the row `version`: `PATCH /tasks/:id { "version": 3, ... }`.

## Endpoint groups
| Group | Endpoints |
| --- | --- |
| System | `GET /api/health/live`, `/api/health/ready`, `/version`, `/openapi.json`, `/stream/events` (SSE) |
| Auth | `/bootstrap/status`, `POST /bootstrap/owner`, `/auth/login`, `/auth/session`, `/auth/logout`, `/auth/logout-all`, `/auth/password`, `/auth/sessions`, `/auth/verify-password` |
| User | `PATCH /user/profile`, `GET/PATCH /preferences` |
| Tasks | `/tasks` (list/create), `/tasks/:id` (get/patch/delete), `/restore`, `/complete`, `/reopen`, `/completions`, `/subtasks`, `/tasks/bulk`, `/tasks/reorder`, comments, reminders |
| Projects | `/projects`, `/projects/reorder`, `/projects/:id/sections`, `/sections/:id`, `/sections/reorder` |
| Organise | `/labels`, `/saved-filters`, `/saved-filters/:id/tasks`, `/filters/evaluate`, `/templates`, `/templates/:id/apply` |
| Views | `/views/inbox`, `/views/today`, `/views/upcoming`, `/views/calendar`, `/search`, `/activity`, `/sync/snapshot` |
| Calendar | `/calendar/providers`, `/accounts`, `/accounts/connect`, `/oauth/:provider/callback`, `/calendars`, `/events`, `/sync`, `/status`, `/jobs/:id` |
| Data | `/export/workspace.json`, `/export/tasks.csv`, `/imports/preview`, `/imports/apply`, `/imports/workspace`, `/backups` (+ password-gated download) |
| Notifications | `/notifications`, `/push/config`, `/push/subscribe`, `/push/unsubscribe`, `/push/test` |

Pagination uses cursors (`limit`, `cursor`); list responses are `{ items, nextCursor? }`.

**Integrations (Siri, Shortcuts, Apple Watch).** `GET/POST /api-tokens`, `DELETE /api-tokens/:id` (browser session only), and `POST /capture`, `GET /capture/today` which also accept `Authorization: Bearer wos_...` (a personal access token). Bearer tokens are accepted on those two paths only; add `?format=text` for a plain-text reply. Other new endpoints: `POST /tasks/:id/archive`, `POST /tasks/:id/unarchive`, `POST /notifications/:id/snooze`.
