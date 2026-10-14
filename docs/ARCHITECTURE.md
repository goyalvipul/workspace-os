# Architecture

```
iPhone / PC browser  --HTTPS-->  Tailscale Serve  -->  127.0.0.1:4390  -->  Docker container (node:22, non-root, read-only fs)
                                                                                 |- Fastify API  (/api/v1/*)
                                                                                 |- built PWA (static, SPA fallback)
                                                                                 |- scheduler (sync jobs, reminders, backups)
                                                                                 `- SQLite (WAL) at /data, backups at /backups
```

## Packages
- `packages/shared`: zod schemas/DTOs, ULIDs, date-only + zoned-instant helpers, recurrence (rrule), quick-add parser, filter AST evaluator, view selectors, templates. Used by server and web so rules are identical.
- `apps/server`: Fastify 5. Layers: `routes/*` (declarative `api({...})` definitions that also generate OpenAPI) -> `services/*` (transactions) -> `db` (Drizzle + better-sqlite3, FK on, FTS5 for search). Bundled with esbuild into `dist/index.js` + `dist/cli.js`.
- `apps/web`: React 19, Vite 7, Tailwind 4, TanStack Query, Zustand store, Dexie (IndexedDB), dnd-kit, Radix, `vite-plugin-pwa` (injectManifest, `src/sw.ts`).

## Key mechanisms
- **Identity**: client-generated ULIDs, so offline creation needs no round-trip.
- **Concurrency**: every mutable row has `version`; a stale write returns 409 `VERSION_CONFLICT` with the current row.
- **Idempotency**: `Idempotency-Key` header; same key+same request replays the stored response (`idempotent-replay: true`), same key+different request returns 422. Rows kept 7 days.
- **Events**: each mutation writes a durable `app_events` row in the same transaction; `GET /api/v1/stream/events` (SSE) streams them with `Last-Event-ID` replay. The client refetches deltas via `/sync/snapshot?since=`.
- **Soft deletes** for tasks/projects so undo and sync tombstones work.
- **Calendar sync**: job queue (`sync_jobs`) processed by `workerTick`; provider adapters implement `discover`, `syncCalendar`, `refreshToken`. Cursors in `sync_cursors`.
- **Scheduler**: guarded by DB leases (`job_leases`) so a second process cannot double-run a job.
- **Offline client**: Dexie snapshot + outbox of HTTP requests replayed FIFO, version filled at send time, 3-way merge dialog on conflict.

## Docker
Multi-stage build; runtime installs production deps only, runs as `node`, `read_only: true`, `cap_drop: ALL`, volumes `/data` and `/backups`, healthcheck on `/api/health/live`, port bound to loopback.
