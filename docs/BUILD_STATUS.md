# Workspace OS Build Status

Last updated: 2026-10-14
Overall status: **CODE COMPLETE, VERIFIED LOCALLY. Docker + Tailscale + real OAuth are BLOCKED_EXTERNAL (owner action).**

Labels used below: `PASS` (executed, result observed), `FAIL`, `BLOCKED_EXTERNAL` (needs something only the owner can do), `UNVERIFIED` (written, never executed).

| Stage | Status | Evidence |
| --- | --- | --- |
| 0 Scaffold (monorepo, Dockerfile, compose, scripts) | PASS for code, Docker image UNVERIFIED | `pnpm check`, `pnpm build`; Docker engine cannot start (WSL2 missing) |
| 1 Auth / persistence | PASS | `tests/api/auth.test.ts`, `security.test.ts`, Playwright setup + login |
| 2 Task / project domain | PASS | `tests/unit/shared.test.ts`, `tests/api/tasks*.test.ts` |
| 3 Responsive UI | PASS | Playwright desktop (1280x800) + mobile (Pixel 7), axe WCAG A/AA on 12 pages |
| 4 Calendar providers | PASS against fakes, real providers BLOCKED_EXTERNAL | `tests/api/calendar.test.ts` |
| 5 Unified agenda + SSE | PASS | API tests + Playwright |
| 6 Offline PWA | PASS (queue + replay in Chromium; manifest + service worker registered) | `02-flows.spec.ts` |
| 7 Notifications / templates / import-export | PASS (web push delivery itself UNVERIFIED on a real phone) | API tests |
| 8 Reliability / security / backups | PASS (backup, verify, corrupt-backup rejection, restore, pre-migration copy) | `tests/api/backup.test.ts` |
| 9 Final QA / handoff | PASS with the blockers listed here | this file, `docs/RELEASE_CHECKLIST.md` |

## Test results (single end-of-build run, per owner request)

| Suite | Command | Result |
| --- | --- | --- |
| Lint + typecheck | `pnpm check` | PASS |
| Unit + API (Vitest) | `pnpm test` | PASS, 54/54 |
| Smoke against a throwaway instance | `pnpm smoke` | PASS |
| E2E (Playwright, desktop + mobile) | `pnpm test:e2e` | PASS, 14/14 |
| Docker build / `docker compose up` | `docker compose up -d --build` | BLOCKED_EXTERNAL (WSL2 not installed) |
| Tailscale Serve to the iPhone | `tailscale serve` | BLOCKED_EXTERNAL (needs owner approval, Docker app) |
| Real Google / Microsoft sync | connect an account | BLOCKED_EXTERNAL (no OAuth credentials) |

## Defects found by the tests and fixed
- `Idempotency-Key` header was accepted but not enforced; now replays the stored response (same body) or returns 422 `IDEMPOTENCY_KEY_REUSED`.
- OAuth callback route did not match the documented redirect URI; now `/api/v1/calendar/oauth/<provider>/callback`.
- `/labels` and `/templates` crashed with "Maximum update depth exceeded" (store selectors returned new arrays); fixed with memoised selectors.
- Calendar month grid had invalid ARIA structure and low-contrast out-of-month days; fixed. Accent colour darkened to `#c93b33` so white-on-accent text passes WCAG AA.
- Completing a task showed no Undo; added an Undo toast.

## Known limitations
- Real provider behaviour (Google sync tokens, Microsoft delta and all-day timezone handling) is implemented from the provider docs and tested only with fakes. See `docs/PROVIDER_NOTES.md`.
- Web push and iOS "Add to Home Screen" behaviour were not tested on a physical iPhone.
- The web bundle is a single ~1.36 MB chunk (377 kB gzip); acceptable for a single-user app, can be split later.
- Docker image is written to the design in `docs/ARCHITECTURE.md` but has never been built here.

## Next actions
See `docs/OWNER_ACTIONS.md`.
