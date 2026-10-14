# Decisions

| # | Decision | Why |
| --- | --- | --- |
| 1 | pnpm monorepo, TypeScript strict, shared zod package | One definition of rules for server and web |
| 2 | SQLite (WAL) via better-sqlite3 + Drizzle | Single owner, trivial backups, no extra service |
| 3 | Fastify 5 + declarative routes that also generate OpenAPI | Validation and docs cannot drift |
| 4 | Client-generated ULIDs, `version` optimistic concurrency, soft deletes | Offline creation, safe merges, undo |
| 5 | Durable `app_events` table drives SSE and delta sync | Replay after reconnect, no lost updates |
| 6 | Server-side sessions with hashed opaque cookie, HMAC CSRF, Origin allow-list | Simple and safe for one owner behind Tailscale |
| 7 | OAuth Authorization Code + PKCE via backend, read-only scopes | Tokens never reach the browser; no write risk |
| 8 | Dexie outbox of HTTP requests, version filled at send time | Replay stays valid after earlier queued edits |
| 9 | Filters are a JSON AST, never SQL strings | No injection, shareable between client and server |
| 10 | Date-only strings vs UTC instant + IANA zone | Correct across DST and travel |
| 11 | Docker with loopback-only port + Tailscale Serve | No public exposure |
| 12 | Defaults: America/Vancouver, dark theme, coral accent (`#c93b33`, darkened for AA contrast) | Owner's answers |
| 13 | Calendar providers tested with fakes | No credentials available at build time |
| 14 | Test suites run once at the end | Owner's request to save time |
| 15 | Siri / Apple Watch via Apple Shortcuts + personal access tokens limited to `/api/v1/capture*` (hash-only storage, no CSRF because no cookie, Origin check kept) | A PWA cannot host native Siri intents or a watch app; a narrowly scoped bearer token keeps a leaked shortcut from reading or exporting data |
| 16 | `archived` task status (hidden from every view, restorable) separate from soft delete | Swipe-left archive needs a reversible state that is not Trash |
| 17 | Goals / karma computed on read from `task_completions` (no stored score) | Recurring completions count, undo stays consistent, nothing to migrate |
