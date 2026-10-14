# Testing

| Layer | Command | What it covers |
| --- | --- | --- |
| Static | `pnpm check` | ESLint (typescript-eslint, react-hooks) + `tsc` for shared, server, web, service worker |
| Unit | `pnpm test` (`tests/unit`) | dates (DST round-trip property), quick add, recurrence, filters, views, templates |
| API | `pnpm test` (`tests/api`) | `app.inject` against a temp DB: auth, CSRF/Origin, CRUD, 409 conflicts, idempotency, recurring tasks, bulk, search, project delete policy, filters/templates, import/export, preferences, security headers, calendar sync with a fake provider, backup/verify/restore |
| Smoke | `pnpm smoke` | boots a throwaway server and exercises the main flow over HTTP |
| E2E | `pnpm test:e2e` | Playwright (desktop + Pixel 7): setup, login, quick add + undo, projects + search, axe WCAG A/AA on 12 pages, offline queue/replay, missing-credentials guide, manifest + service worker |

Notes
- Tests use throwaway DBs and secrets (`.test-data/`, gitignored). E2E starts its own server on port 4398 via `tests/e2e/server.mjs`.
- Run the suites once at the end of a change, not in a loop.
- Not covered: real Google/Microsoft APIs, Docker image, Tailscale, physical iPhone push.
