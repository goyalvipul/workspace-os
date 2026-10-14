# Data model

Source of truth: `apps/server/src/db/schema.ts` (Drizzle) with SQL migrations in `apps/server/drizzle/` (bundled to `dist/drizzle`). Migrations run at startup; a `VACUUM INTO` safety copy of the DB is taken first when a migration is pending.

| Area | Tables |
| --- | --- |
| Identity | `users`, `sessions`, `app_settings`, `user_preferences` |
| Planning | `projects`, `sections`, `tasks`, `task_completions`, `labels`, `task_labels`, `task_comments`, `task_reminders`, `saved_filters`, `templates` |
| History | `activity_events` (user-visible feed), `app_events` (durable SSE/sync log) |
| Calendar | `connected_accounts` (tokens encrypted), `external_calendars`, `calendar_events`, `sync_cursors`, `sync_jobs` |
| Reliability | `client_mutations` (idempotency), `job_leases`, `backups`, `import_runs` |
| Notifications | `push_subscriptions`, `notifications` |

## Conventions
- IDs: ULID text. Timestamps: ISO-8601 UTC. Due dates: `YYYY-MM-DD` (date-only) or UTC instant + IANA zone, so "9am" stays 9am across DST.
- `version` integer on mutable rows; `deleted_at` for soft delete; `created_at`/`updated_at` everywhere.
- `sections.is_done` marks the board column that holds completed tasks (at most one per project, enforced in the service). Board columns = the unsectioned "To Do" column + the project's sections ordered by `sort_order`.
- Task ordering uses a sortable position key per list (project/section/day).
- Search: FTS5 virtual table over task title/description/comments, maintained by triggers.
- Calendar events store normalised UTC start/end, `all_day` flag with date-only bounds, `is_private` (details masked before storage), provider ids and etag.
- Tokens: AES-256-GCM with `DATA_ENCRYPTION_KEY` (versioned; previous key accepted during rotation). Never returned by the API or logged.
