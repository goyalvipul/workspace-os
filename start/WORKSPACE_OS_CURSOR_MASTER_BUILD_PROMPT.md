# WORKSPACE OS — CURSOR MASTER BUILD PROMPT

**Version:** 1.0 · **Date:** 2026-10-14 · **Target:** complete, self-hosted task manager and unified calendar PWA · **Primary deployment:** Windows 11 + Docker Desktop + Tailscale Serve

> **INSTRUCTIONS TO CURSOR / CODING AGENT — READ THIS ENTIRE DOCUMENT BEFORE CODING.** This is an executable engineering contract, not a discussion starter or wireframe request. Build a working, testable, documented application called **Workspace OS** in this repository. Do not merely generate a plan, boilerplate, static mockups, screenshots, TODO placeholders, or simulated production data. Deliver the source code, migrations, tests, Docker files, documentation, configuration wizard, and verified runnable application. Work autonomously within available permissions. Never fabricate test outcomes or claim calendar integration works without actual credentials and real-provider testing. If authorization or operating-system configuration requires the human owner, provide precise instructions and continue implementing and testing everything that can be tested with provider adapters and fixtures.

## A. Execution contract: how the agent must work

1. Inspect the repository, tools, OS, runtime versions, and available screenshot references first. Preserve useful existing work; ask before deleting any user data. Do not require a greenfield repo if source exists.
2. Record decisions in `docs/DECISIONS.md`; execution state in `docs/BUILD_STATUS.md`; unresolved owner-only actions in `docs/OWNER_ACTIONS.md`. Create those files on the first pass and **update them after every phase** so a new Cursor session can resume without relying on chat history.
3. Maintain a checklist with each milestone: `NOT_STARTED`, `IN_PROGRESS`, `IMPLEMENTED_UNVERIFIED`, `TESTED`, or `BLOCKED_EXTERNAL`. Never mark `TESTED` without executing the tests and documenting results.
4. Implement vertical slices: schema → API/service → UI → tests → docs → deploy check. Do not build every backend route before making any UI functional. Do not stop after wireframes.
5. After each milestone run typecheck, lint, unit tests, API integration tests, and the applicable Playwright tests. Fix failures before continuing. Use real HTTP/database tests and browser tests, not assertions against mock screenshots only.
6. Do not introduce SaaS subscriptions, paid proprietary APIs, accounts, Redis, Kafka, Kubernetes, or cloud servers without demonstrable necessity and explicit owner approval. Free libraries are preferred; verify license and pin dependency versions via lockfile.
7. No silent feature cuts. If a requirement is postponed, document why, risk, acceptance impact, and a precise follow-up. The highest-priority release gates listed in §V must pass.
8. Do not rewrite working code unnecessarily or substitute an entirely different architecture without a documented reason. Keep changes reviewable. Commit at each completed milestone **if git is initialized and committing is authorized**; otherwise summarize changed files.
9. Never modify host firewall, Tailscale settings, provider app registrations, saved credentials, or existing production data without explicit approval. Never print secrets, OAuth codes, tokens, or passwords to chat, logs, screenshots, or Git.
10. The instruction to “continue until complete” means complete all automatable build, test, and documentation tasks in the available environment. An AI run cannot guarantee unattended completion across context/time limits, external OAuth consent, unavailable Docker daemon, network restrictions, or manual iPhone testing. At a boundary, leave a complete, restartable status and exact next command/task; do not falsely report production readiness.
11. Before choosing third-party package versions or APIs, inspect their current official documentation and the installed package exports. Never invent endpoints, APIs, or flags. Record substantial provider constraints and references in `docs/PROVIDER_NOTES.md`.
12. No fake “Connect Google” or “Sync Now” buttons: a control must execute a real action or be clearly disabled with an explanation. All error/success messages must reflect backend status.

**Required final response from Cursor:** exact start URL and commands, completed features, test output, actual Docker health, what data is persisted, backup/restore demonstration, OAuth setup requirements, browser/PWA installation instructions, known issues, security caveats, and which acceptance gates passed/failed/not testable. An app is **not complete** merely because `npm run build` succeeds.

---

## B. Product definition and scope

**Goal:** Replace the day-to-day experience of Todoist for a single primary owner while adding a unified view of several external calendars, as a polished private self-hosted **progressive web app**. Prioritize quick capture, focus, low cognitive overhead, and reliability. Inspired by interaction patterns in the user's Todoist mobile screenshots: dark-theme surface, red/coral accent, bottom navigation (Inbox, Today, Upcoming, Browse), quick-add floating action button, empty states, day-grouped agenda, favorite projects, project/reporting screens, templates, display/filter settings. **Do not copy Todoist logos, art, text, proprietary illustrations, or pixel-identical branded UI.** Produce original icons/illustrations and Workspace OS branding.

**Deployment reality:** User owns a Windows desktop with Docker Desktop and already has Tailscale on their devices. Server runs continuously in Docker; owner accesses responsive PWA from Windows/browser and iPhone/Android over Tailscale HTTPS. SQLite database and uploaded data persist on named Docker volumes. Tailscale Serve runs on the Windows host, not inside the app container. The application is **private**, not publicly exposed. Zero mandatory subscription fees.

**Personas:** (1) primary owner managing multiple personal/business/content projects; (2) the same owner on phone quickly adding/completing tasks. Do not implement multi-tenant SaaS, social workspaces, or billing. Build data model with an `owner_user_id` and session boundaries for potential future multi-user support; enforce per-owner authorization now.

**Definition of shipped v1:**
- High-quality responsive desktop/mobile PWA with original visual identity; installed iOS/Android home-screen experience tested manually where devices are available.
- Secure account setup, login/logout, sessions, projects/sections, tasks/subtasks, list/board, labels, priorities, search, filters, favorites, templates, reporting/activity, settings.
- Inbox, Today, Upcoming, Calendar combined with external **read-only events**; calendar connection/settings/visibility; multiple Google/Microsoft accounts and multiple calendars per account.
- Smart capture, due dates, deadlines, recurring tasks, notifications/reminders, import/export, backup/restore, offline task queue, conflict handling, multiple-tab live updates.
- Working containerized deployment + healthchecks + setup wizard + reproducible tests + full docs.

**Explicitly out of scope for v1 (but keep extension points):** provider-calendar edit/delete writeback; synchronization of Google Tasks and Microsoft To Do tasks; general team collaboration/assignment invitations; paid AI, subscriptions, public Funnel/webhook ingress, file sharing outside tailnet, native App Store apps, zero-configuration cross-device offline database replication. Do not pretend these are built. Implement optional **future-stage specifications** in §T, not unrequested dangerous half-working functionality. A full-featured *task-management* v1 is expected, not a clone of every feature ever shipped by Todoist.

**Global product rules:** Title-only Quick Add; Inbox is the default for unsorted tasks; action on any task should require minimal clicks; show meaningful progress without overwhelming the user; deadlines vs scheduled work are distinct; a project goal explains *what outcome* tasks achieve. No mandatory tags, descriptions, or due dates. Support dark/light/system themes, responsive layouts, timezone selection, accessible keyboard navigation, and touch-friendly 44px+ targets.

---

## C. Technology stack — mandatory defaults

- **Repo:** `pnpm` monorepo with `apps/web`, `apps/server`, `packages/shared`; TypeScript strict mode throughout. Use stable maintained Node.js LTS and pin Docker base image to a supported LTS release (record chosen version). Commit `pnpm-lock.yaml`.
- **Frontend:** React + Vite + TypeScript; React Router; TanStack Query; lightweight Zustand only for UI state; Tailwind CSS + shadcn/ui (Radix); Lucide icons; accessible dialogs/menus/popovers; dnd-kit (keyboard fallback for drag-and-drop).
- **PWA:** `vite-plugin-pwa` / Workbox, manifest and custom service worker, IndexedDB via Dexie, precise asset version updates, offline mutation outbox. No service-worker caching of authenticated sensitive API responses by URL alone.
- **Backend:** Fastify, TypeScript, Zod schemas and OpenAPI documentation (generated where possible), structured Pino logs with secret redaction; sessions and CSRF defenses; SSE for live app updates; robust REST endpoints.
- **Data:** SQLite via `better-sqlite3` + Drizzle ORM and SQL migrations, WAL mode, `foreign_keys=ON`, busy timeout, transactional mutations; full-text search via SQLite FTS5 with appropriate indexes; database located on a *Linux Docker named volume*, not a Windows/SMB shared bind mount.
- **Scheduling:** a **single** idempotent job scheduler inside the server process for v1, persisted job and lease records; prevents overlapping runs; restart catch-up. Do not deploy multiple API replicas with a scheduler until distributed leasing is proven. Avoid introducing Redis for a one-host app.
- **Dates:** library with IANA timezone handling (`date-fns` and compatible timezone helpers or equivalent), RFC 5545 RRULE via a maintained tested recurrence library, and native `Intl` where appropriate. Do not use naive string-to-Date parsing for date-only tasks.
- **Calendar:** Google Calendar API v3; Microsoft Graph v1.0; secure backend OAuth Authorization Code (PKCE where supported/appropriate); keep access and refresh tokens server-side encrypted at rest.
- **Testing:** Vitest for unit tests, Fastify inject/supertest-style integration, Playwright for E2E and responsive device emulation, axe for accessibility checks; tests use an isolated temp SQLite database and fake time.
- **Deployment:** multi-stage Dockerfile; `compose.yaml` for app, named persistent data volume and backup volume; healthcheck; restart policy; host publication bound to `127.0.0.1` only; serve built SPA and `/api` from the *same origin* to simplify sessions and PWA.
- **Code quality:** ESLint, Prettier, TypeScript strict, validation at API boundaries, no unhandled promises, no circular imports, minimal dependencies, meaningful error types.

No frontend direct calls to Google/Microsoft. No refresh tokens in browser storage. No unreviewed AI calls.

---

## D. Repository layout and required deliverables

```text
workspace-os/
  apps/
    web/
      public/                    # icons, manifest assets, offline fallback
      src/
        app/                     # routes, providers, query client, auth
        components/              # shell, tasks, boards, dialogs, forms, common
        features/
          inbox/ today/ upcoming/ calendar/ projects/ tasks/
          search/ filters/ labels/ templates/ activity/ settings/
          offline/ notifications/ onboarding/
        lib/                     # typed API client, date/format/helpers
        styles/                  # global tokens, dark/light themes
        test/                    # web test fixtures
      vite.config.ts
    server/
      src/
        app.ts                   # Fastify composition
        index.ts                 # startup, migrations, graceful shutdown
        config/                 # strict env validation
        db/                     # schema, migrations, repositories, seed
        routes/                 # auth, user, tasks, projects, calendar, etc.
        services/               # domain logic and transactions
        calendar/               # adapters/google.ts, microsoft.ts, normalize.ts
        sync/                   # cursor management, leases, retry, jobs
        notifications/          # SSE, in-app, browser push
        security/               # password, session, OAuth crypto, CSRF
        backup/                 # backup/restore, integrity verification
        test/                   # API/provider fake fixtures
  packages/shared/src/           # Zod DTOs, enums, typed contracts
  tests/e2e/                     # desktop/mobile Playwright journeys
  docs/
    BUILD_STATUS.md             # living milestone matrix
    DECISIONS.md                # decision log
    OWNER_ACTIONS.md            # credentials/manual work
    PRODUCT.md                  # UX and features
    ARCHITECTURE.md             # diagrams and responsibilities
    DATA_MODEL.md               # tables/relationships/migration rules
    API.md                      # examples, errors, pagination
    CALENDAR_SYNC.md            # OAuth, algorithms, deletion/recovery
    DEPLOY_WINDOWS_TAILSCALE.md # exact Windows steps, Docker, Tailscale
    PWA_MOBILE.md               # iPhone/Android installation and limitations
    SECURITY.md                 # threat model and secure operations
    TESTING.md                  # test commands, matrix, recorded results
    BACKUP_RESTORE.md           # scheduled/manual & restore drill
    PROVIDER_NOTES.md           # official refs, verified version details
    TROUBLESHOOTING.md
    RELEASE_CHECKLIST.md
  scripts/                        # bootstrap, admin-create, backup, restore, smoke
  compose.yaml
  Dockerfile
  .env.example                    # no real secrets
  .gitignore                      # exclude .env, sqlite files, credentials
  .dockerignore
  README.md
  AGENTS.md                       # mirrors critical autonomous agent contract
  package.json
  pnpm-workspace.yaml
  pnpm-lock.yaml
```

Generate all listed documents; they must reflect actual implementation rather than aspiration. Add screenshots from running app to `docs/screenshots/` **only after** browser automation has rendered real pages, and never include private account/calendar details in screenshots.

---

## E. UX / navigation specification

### E1. Global responsive shell

**Desktop >=1024px:** left persistent sidebar (collapsible, ~240–280px); narrow topbar with global search, compact Quick Add, notifications, avatar/settings; main content width responsive; task detail in right drawer (optionally modal on narrow screens). Sidebar: Inbox with count; Today; Upcoming; Calendar; Filters & Labels; Templates; Activity/Reporting; Favorites; Projects (expand/collapse, add, reorder); Settings. Show online/offline and sync status unobtrusively. Breadcrumbs for deep project/section navigation.

**Phone <768px:** bottom pill nav with **Inbox / Today / Upcoming / Browse** inspired by provided references; fixed safe-area aware; floating coral `+` Quick Add above nav; Browse includes Projects, Favorites, Calendars, Filters & Labels, Templates, Activity, Settings. Navigation never overlaps gesture bar. Header has title and context-dependent actions; swipe gestures optional only with accessible alternatives. Task detail in full-height sheet; editing must be keyboard-safe when iOS on-screen keyboard opens. Respect `env(safe-area-inset-*)`, orientation changes, dark mode, dynamic text, zoom. Avoid wide tables/horizontal scrolling.

**Tablet:** adaptive sidebar/drawer; preserve bottom navigation if narrow.

**Global behaviors:** keyboard Quick Add `Q` when not typing (configurable), search `/`, Escape closes overlays, Enter saves, proper focus restoration, toast + Undo on reversible actions, skeletons, empty/error/loading states. For a **browser/PWA**, a system-wide keyboard shortcut from *other apps* is impossible without a native companion; explicitly document this limitation. Provide desktop in-app keyboard shortcut and mobile share-target/shortcut where supported, not a fake global hotkey.

**Brand/theme:** name **Workspace OS**, original icon set; default dark theme, neutral charcoal panels, restrained coral accent (not copied assets). Light and system themes, contrast AA, reduced-motion settings, meaningful empty states made from simple SVG/CSS originals. Use screenshots as **interaction references**, not copyrighted design assets.

### E2. Quick Add — highest usability priority

- Tap persistent `+` or keyboard shortcut → focused input immediately; title required, **every other field optional**.
- Enter saves to Inbox immediately, Escape cancels, Ctrl/Cmd+Enter optionally saves and stays open; server optimistic save online and local queued save offline.
- Optional chips (project, due, time, priority, labels, reminder, recurrence); remember last chosen project only when explicitly toggled, otherwise default Inbox.
- Parse unambiguous text patterns like `tomorrow 3pm`, `every Monday`, `#Project Name`, `@label`, `p1` with visible editable chips. **Never silently remove words** from title when parsing ambiguous phrases; show parsed interpretation and let user confirm. English first, structured picker always works. Handle local timezone and DST.
- Quick Add from Inbox, project, board column, day heading populates context; user can change it.
- Rich detail after capture: description (safe markdown subset), subtasks, comments/activity, start/scheduled date, due date, deadline, reminders, URL links, priority, status, labels, recurrence, project, section. Validate all server-side.

### E3. Inbox

- Unassigned/unorganized tasks only: **Inbox is a virtual view, not a required database project** (`project_id IS NULL`).
- Count, sorting, grouping, bulk selection, bulk categorize, move, priority, schedule, complete/delete; reorder manually. Empty-state with one clear add action.
- Capture should not force project assignment, due date, or label.

### E4. Today

- Default selected timezone (`America/Vancouver` initially configurable). Show overdue tasks separately, tasks due today, tasks explicitly planned for today, and external calendar events for today. Avoid counting events as tasks.
- Time-ordered agenda; all-day events shown above timed events; tasks without times in a separate priority section; provider/color badges; event click opens read-only details and optional provider source link.
- Completed tasks toggle; count completed today; informative empty state; set the owner’s Daily Focus list (up to 3 chosen focus tasks as a guidance setting, NOT a hard limit on due tasks).
- User-configurable hide/show completed, future recurring occurrences, priority sorting, project filter, label filter, calendar visibility, and type toggles (task/event).

### E5. Upcoming

- Mobile: horizontally scrollable date strip with selected date, month navigation, day-grouped **Agenda** default; each day shows external events + local tasks; `+` on day creates predated task; continuous scrolling with virtualized range.
- Desktop: switchable Agenda, Week grid and Month calendar; calendar events and task due dates distinctly rendered. Display overlapping events correctly and time zone DST correctly.
- Week/Month layouts use standard open-source functionality only; if premium features required, implement basic own layout instead of licensing paid features.
- Day strip should preserve selected day across view changes; jump to today; user can choose start-of-week Monday/Sunday. An empty day still allows task creation.
- Date navigation must fetch older/newer calendar windows as needed; cannot be limited to an initial 30-day cache.

### E6. Projects, sections, lists and boards

- Unlimited projects: name, description, goal/outcome statement, color, favorite flag, parent project (optional hierarchy max reasonable depth), archive, icon, manual sort order, default view, status, creation/completion timestamps.
- Sections in each project with user-defined names and ordering. Task belongs to one project and optionally one section; reorder tasks within and between sections.
- List view with sort/filter/group controls. Board view with section-based columns, draggable cards, keyboard move alternative, responsive horizontal swipe on phone, compact card details and checkboxes. Column reorder. Save per-project view preference.
- Board columns **represent sections**, not task completion status; separate task state must remain coherent when cards move between columns. If a project has no sections, show `No section` column and offer Add Section.
- Archive project preserves tasks/history; unarchive restores. Deleting a project requires explicit confirmation and policy: move surviving tasks to Inbox OR archive/delete with confirmation; never silently discard tasks.
- Favorited projects appear in separate sidebar/Browse list. Multi-select and bulk edit supported.

### E7. Task lifecycle and detail

- Task values: title, notes, project/section, parent task, ordered subtasks, P1–P4, labels, created/updated/completed, due date, deadline, optional start date/time, recurrence, reminders, manual order, estimated duration, status (`open`, `completed`, `archived`), version.
- Completion uses check circle; completed tasks remain available in activity/history, with Undo and reopen. Subtask completion does not auto-complete parent unless explicitly configured; completing parent prompts if unfinished subtasks.
- Relative scheduling (`Today`, `Tomorrow`, date picker), date-only vs date-time distinction; date-only tasks must not shift to previous day across timezones.
- Recurrence: daily, weekdays, weekly on chosen days, monthly by date/weekday, yearly, custom RRULE; `after completion` vs fixed calendar schedule as separate modes; next occurrence visible; no accidental duplicate completions; recurring history immutable.
- **Scheduled work vs deadline:** task scheduling (`scheduled_date`/`scheduled_at`) is the intended execution slot, `due_*` is due by, `deadline_date` is hard constraint; never conflate them. Explain visually without requiring users to fill all three.
- Priorities: P1 urgent/critical, P2 important, P3 normal, P4 none, with consistent colors and sorting.
- Support URLs, safe markdown in notes, optional comments, reminders, and activity view. Attachments are **not required for v1**; if implemented, local storage only with strict size/MIME validation, safe download and backup coverage.

### E8. Search, filters, labels, reporting, templates

- Global command-search by task/project/label/text, include completed toggle and full-text notes; query 150ms+ debounce; pagination.
- Labels CRUD, colors, task-label many-to-many, merges, favorites. Filter builder with AND/OR conditions (project, priority, due range, status, label, text, overdue, planned today); saved filters with names/favorites and controlled filter expression stored as JSON AST (never execute raw SQL from users).
- Reporting/Activity: append-only event journal of task created/edited/completed/reopened/moved, project create/rename/archive, sync events; activity feed grouped by day, filtering by project/action/date, meaningful change diff. Keep secrets and calendar event descriptions out of activity logs.
- Simple stats: tasks completed daily/weekly, by project, overdue, count of active projects, optional streak; no deceptive “productivity score”.
- Templates: reusable project/task templates with sections and task skeletons; add/edit/delete/import/export; seed **Weekly Review** and **Project Tracker** templates with original copy (no copied Todoist template art). Template application idempotent, preview before applying.
- Bulk operations: selection mode; complete, move, priority, labels, delete with safe confirmation and undo where possible.

### E9. Settings and onboarding

- First-run setup creates owner account; bootstrap restricted to first run and never available again after an owner exists. Require strong password; optional password change, active session logout, logout all devices, application preferences, privacy/backup actions.
- Settings pages: Profile, Appearance, Task Defaults, Date & Time (IANA, first day of week, 12/24-hour), Notifications, Connected Accounts & Calendars, Sync Diagnostics, Data Import/Export, Backup/Restore, Security, About/Version.
- Calendar settings show account name/provider, access status, per-calendar name/color/visibility/last successful sync, refresh button, reconnect/disconnect, source link, sync errors and history.
- Allow hide vs disconnect vs delete cache as **different actions** with explicit consequences. Account disconnect revokes token where supported and securely removes stored token, retains local tasks, allows choice to delete cached provider events.

---

## F. Relational data model (SQLite) — required design contract

Create explicit Drizzle tables, typed model validators, indexes, constraints, cascading/restrict behavior, migrations, and factories. Use ULID/UUIDv7 public IDs generated on client for offline creation; server validates IDs and owner scope. Every user-scoped record has `owner_user_id` (directly or through enforced relationship) and `created_at`, `updated_at` where relevant. Always use parameterized SQL; `PRAGMA foreign_keys=ON`, WAL + busy timeout.

**Core tables (suggested fields; add as necessary without weakening semantics):**

1. `users`: `id PK`, `email UNIQUE nullable` (local login need not require email), `display_name`, `password_hash` (Argon2id), `timezone` default `America/Vancouver`, `week_starts_on`, `theme`, `time_format`, `created_at`, `updated_at`, `disabled_at`.
2. `sessions`: `id`, `user_id FK`, **hash of opaque cookie session token** (never raw token), `csrf_secret_hash` or CSRF token binding, `user_agent`, `created_at`, `expires_at`, `revoked_at`, `last_seen_at`. Idle/absolute expiration policies; logout invalidates server-side. Optional throttled IP metadata, never required for access.
3. `projects`: `id`, `owner_user_id`, `parent_project_id NULL FK`, `name`, `description`, `outcome`, `color`, `icon`, `favorite`, `archived_at`, `sort_order`, `default_view ('list'|'board')`, `created_at`, `updated_at`, `version`. Enforce no hierarchy cycles in service layer; index `(owner_user_id, archived_at, sort_order)`.
4. `sections`: `id`, `project_id FK`, `name`, `sort_order`, `archived_at`, timestamps, version. Reordering transactional; cross-project section IDs invalid for tasks.
5. `tasks`: `id`, `owner_user_id`, `project_id NULL FK`, `section_id NULL FK`, `parent_task_id NULL FK`, `title NOT NULL`, `description`, `priority` integer 1–4, `status`, `position` (stable sortable key), `scheduled_date` TEXT NULL (YYYY-MM-DD local), `scheduled_at_utc` NULL, `due_date` TEXT NULL, `due_at_utc` NULL, `due_timezone` TEXT NULL, `deadline_date` TEXT NULL, `estimate_minutes` NULL, `recurrence_rule` TEXT NULL, `recurrence_mode ('fixed'|'after_completion')`, `recurrence_anchor` NULL, `recurrence_timezone` NULL, `next_occurrence_key` NULL, `created_at`, `updated_at`, `completed_at` NULL, `deleted_at` NULL (soft deletion), `version` integer ≥1. CHECK task is not its own parent, priority range, nonempty title, cross-project parent rules. Distinguish scheduled vs due vs deadline; normalize date-only values without converting to midnight UTC.
6. `task_completions`: `id`, `task_id`, `occurrence_key` (deterministic for recurring tasks), `completed_at`, `original_due_date`, `original_due_at_utc`, `completed_by`, `undone_at`; UNIQUE `(task_id, occurrence_key)` for active completion as enforced by service/partial index. For one-off tasks, a stable singleton occurrence key. Historical completions survive recurrence rescheduling; undo is idempotent and well-defined.
7. `labels`: `id`, `owner_user_id`, `name` (case-insensitive unique per owner), `color`, `sort_order`, `favorite`, `created_at`, `updated_at`.
8. `task_labels`: composite PK `(task_id, label_id)` plus indexes.
9. `task_comments`: `id`, `task_id`, `owner_user_id`, `body`, timestamps, `deleted_at`; sanitize rendering.
10. `task_reminders`: `id`, `task_id`, `relative_or_absolute`, `offset_minutes NULL`, `at_utc NULL`, `timezone`, `channel ('inapp'|'webpush')`, `enabled`, `last_sent_occurrence_key NULL`, timestamps. Handle rescheduling and duplicate delivery idempotently.
11. `favorite_items`: `id`, `owner_user_id`, `kind ('project'|'filter')`, `target_id`, `sort_order` or consistent favorite flags for projects/filters; avoid redundant inconsistent sources of truth.
12. `saved_filters`: `id`, `owner_user_id`, `name`, `description`, `filter_ast_json` validated Zod AST, `sort`, `favorite`, timestamps.
13. `templates`: `id`, `owner_user_id NULL for built-in`, `name`, `description`, `kind ('project'|'task')`, `schema_version`, `body_json` validated, `is_builtin`, timestamps.
14. `user_preferences`: `user_id`, `key`, `json_value` with per-key schemas, timestamps. Includes selected display settings, mobile navigation preferences, today focus IDs, calendar overlays.
15. `activity_events`: `id`, `owner_user_id`, `entity_type`, `entity_id`, `action`, `public_summary`, safe `delta_json` (redacted), `created_at`, `client_mutation_id`; index by owner/date/project. Activity append in same DB transaction as domain mutation.
16. `connected_accounts`: `id`, `owner_user_id`, `provider ('google'|'microsoft')`, `provider_subject` (stable external ID), `display_email`, `display_name`, `scopes_json`, encrypted token payload, token-expiry, `status ('connected'|'reauth_required'|'error'|'disconnected')`, last_refresh, timestamps; UNIQUE owner/provider/subject. Never print token. Record encrypt key version for rotation.
17. `external_calendars`: `id`, `connected_account_id FK`, `provider_calendar_id`, `name`, `color`, `timezone`, `is_selected`, `is_primary`, `read_only`, `provider_etag` nullable, `last_success_at`, `last_attempt_at`, `last_error_code`, `last_error_redacted`, `sync_health`, timestamps; UNIQUE `(connected_account_id, provider_calendar_id)`.
18. `calendar_events`: `id`, `external_calendar_id`, `provider_event_id`, `provider_ical_uid NULL`, `provider_series_id NULL`, `recurrence_instance_key NULL`, `subject`, `description_plain` (only if granted; sanitize), `location_text`, `url` (validated official source link), `start_utc NULL`, `end_utc NULL`, `start_date_local NULL`, `end_date_local_exclusive NULL`, `timezone`, `is_all_day`, `is_cancelled`, `is_private`, `availability`, `etag`, `last_modified_at`, `last_seen_generation`, `deleted_at`, raw-minimal provider metadata JSON (no tokens). UNIQUE `(external_calendar_id, provider_event_id, recurrence_instance_key normalized)` via a **non-null canonical occurrence identity column**; no accidental duplicates when NULL semantics apply. Some occurrences may use provider-specific IDs; adapter must supply canonical stable identity. Store canceled exceptions/tombstones appropriately.
19. `sync_cursors`: `id`, `external_calendar_id`, `provider`, `window_start_date NULL`, `window_end_date NULL`, `cursor_kind`, encrypted/opaque `cursor_value`, `query_fingerprint`, `generation`, `last_full_sync_at`, `last_incremental_at`, `status`, timestamps. UNIQUE calendar+window+kind. Microsoft cursors are range-specific; Google sync query fingerprint must match initialization parameters.
20. `sync_jobs`: `id`, `job_kind`, `account_id NULL`, `calendar_id NULL`, `requested_at`, `next_attempt_at`, `lease_owner NULL`, `lease_expires_at`, `attempt_count`, `status`, `last_error_code`, `last_success_at`, `dedupe_key`, payload JSON. Atomic claim and expiry for restart recovery; no two active workers for same calendar.
21. `app_events`: `seq INTEGER AUTOINCREMENT PK`, `owner_user_id`, `event_type`, `entity_id`, `payload_json`, `created_at`. This durable monotonic event stream backs SSE recovery and client catch-up; bounded retention with snapshot resync fallback.
22. `client_mutations`: `client_mutation_id` unique per user/device, `owner_user_id`, `device_id`, `request_hash`, `response_json` (safe), `applied_at`, allowing retry without duplication and request-hash mismatch rejection.
23. `push_subscriptions`: `id`, `owner_user_id`, `endpoint_hash UNIQUE`, encrypted endpoint/keys, `device_name`, `is_active`, timestamps, last_error; delete after permanent push gone errors.
24. `notifications`: `id`, `owner_user_id`, `kind`, `task_id NULL`, `occurrence_key`, `scheduled_at`, `delivered_at`, `read_at`, `channel`, `status`, `attempts`, `dedupe_key UNIQUE`.
25. `backups`: `id`, `started_at`, `finished_at`, `filename`, `size_bytes`, `sha256`, `status`, `schema_version`, `error` redacted.
26. `import_runs`: `id`, `owner_user_id`, `source_type`, `checksum`, `dry_run_summary_json`, `applied_count`, `status`, timestamps, supporting idempotent import and rollback plans.

**Integrity/index requirements:** indexes for due date/due timestamp, `scheduled_date`, `(owner, project, section, position)`, tasks status, activity created_at, event time range, external provider IDs, sync due jobs. Task/project deletion referential integrity must be specified in `DATA_MODEL.md`; do not cascade-delete live tasks when removing external connections. Add a task FTS table/triggers or explicit maintained index for search. Date columns must have canonical validation, normalizing user timezone at API boundary.

**Migrations:** versioned migrations must be backward-compatible, run at startup only if schema compatible, fail safely and require backup for destructive migrations. Record migration version. Seed only built-in templates/default settings; **do not seed fake tasks/events** into a production install. Development/demo seed must be an explicit opt-in command.

---

## G. API design — implement real endpoints and an OpenAPI contract

All routes under `/api/v1`; use same-origin authentication. Paginate list responses with cursor or offset+limit (limit max 200), stable order; standard error shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "A meaningful human-readable message",
    "details": [{ "field": "title", "message": "Title is required" }],
    "requestId": "..."
  }
}
```

`409 VERSION_CONFLICT` includes current safe server entity and expected version; `401` unauthenticated, `403` unauthorized/CSRF, `404` intentionally non-disclosing for other-user resources, `429` rate limited, `503` provider unavailable with retry guidance. Mutation requests support `Idempotency-Key`/clientMutationId and `If-Match` or explicit `version` precondition. All return normalized DTOs (no secret fields). Generate/maintain `docs/API.md` + `/api/openapi.json`; optionally present interactive API docs only behind authentication.

### G1. Authentication / setup

- `GET /api/v1/bootstrap/status` → `{ownerConfigured, setupAllowed}`; no account enumeration or sensitive info.
- `POST /api/v1/bootstrap/owner` → create first owner once; setup token/first-run guard bound to loopback/initial admin-provisioning process; **never create unrestricted public registration**. If accessed over tailnet before setup, require a one-time provisioned setup code printed only to host console or obtained via CLI.
- `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `POST /api/v1/auth/logout-all`, `GET /api/v1/auth/session`, `POST /api/v1/auth/password`, `GET /api/v1/auth/sessions`, `DELETE /api/v1/auth/sessions/:id`.
- Strong password hashing, timing-safe comparisons, brute-force throttling, secure cookie, CSRF token on mutations, cookie rotation on login, remove expired sessions, never store auth tokens in localStorage.

### G2. Tasks / completions / organization

- `GET /tasks` filters `{projectId, sectionId, status, priority, labelIds, dueFrom, dueTo, scheduledFrom, scheduledTo, q, sort, cursor, limit, includeCompleted}`
- `POST /tasks`, `GET /tasks/:id`, `PATCH /tasks/:id`, `DELETE /tasks/:id` (soft delete), `POST /tasks/:id/restore`.
- `POST /tasks/:id/complete` `{occurrenceKey?, version, clientMutationId}`, `POST /tasks/:id/reopen` (define recurring undo semantics); `GET /tasks/:id/completions`.
- `POST /tasks/:id/subtasks` and parent-child changes via PATCH; enforce no cycles and correct project scope.
- `POST /tasks/bulk` validates each operation and transaction semantics, returns per-item successes/failures if partial mode configured; no partially applied moves by accident.
- `POST /tasks/reorder` with target project/section/position and version; transactional order normalization (avoid integer collision/gaps explosion).
- `GET /views/inbox`, `GET /views/today?date=YYYY-MM-DD`, `GET /views/upcoming?start=...&end=...`, `GET /views/calendar?start=...&end=...&calendarIds=...`; standard union DTO `{kind:'task'|'event', id, dateRange, ...}` with source distinction. Views must aggregate task/events without double counting.
- `GET/POST/PATCH/DELETE /projects`; `POST /projects/reorder`; `GET/POST/PATCH/DELETE /projects/:id/sections`, `POST /sections/reorder`.
- `GET/POST/PATCH/DELETE /labels`; `GET/POST/PATCH/DELETE /saved-filters`; `GET/POST/PATCH/DELETE /templates`; `POST /templates/:id/apply` preview/dry-run support.
- `GET /search?q=...`; `GET /activity`, `GET /reports/summary?from=...&to=...`; `GET/PATCH /preferences` with typed keys.
- `GET/POST/DELETE /tasks/:id/comments`; `GET/POST/PATCH/DELETE /tasks/:id/reminders`.

### G3. Calendar connections, sync and live events

- `GET /calendar/providers` → enablement, missing env, configured redirect URI (never secret), connection guidance.
- `GET /calendar/accounts` → safe provider accounts/status; `POST /calendar/accounts/:provider/connect` → return backend-owned authorization redirect; `GET /calendar/oauth/:provider/callback` → validate single-use state, PKCE, token exchange, accounts persisted. Route names may be adjusted to standard framework practices but document exact equivalents.
- `GET /calendar/accounts/:id/calendars` and `GET /calendar/calendars` → all selectable calendars.
- `PATCH /calendar/calendars/:id` → visibility/color; `POST /calendar/accounts/:id/reconnect`; `DELETE /calendar/accounts/:id` → account disconnect with option to keep/remove cached events, preserve local tasks.
- `POST /calendar/calendars/:id/sync` and `POST /calendar/sync-all` → enqueue/debounce real jobs and return job ID, not pretend sync completed.
- `GET /calendar/sync/status` and `GET /calendar/sync/jobs/:id` → current/last success/failure, retry ETA and provider rate status.
- `GET /calendar/events?start=...&end=...&calendarIds=...` → read-only cached events; honor per-calendar visibility as default; source provider and `isStale` flag.
- `GET /stream/events?after=<seq>` → authenticated SSE with heartbeat, reconnect and replay; send `task.changed`, `project.changed`, `calendar.changed`, `sync.status`, `notification`, `server.resync_required`; idempotent event IDs.

### G4. Import, export, backups, health

- `POST /imports/preview` upload small CSV/JSON/Todoist CSV (validate header/mapping); `POST /imports/apply` uses signed temporary import token, check duplicate rows and imports; `GET /exports/tasks.csv`, `GET /exports/workspace.json`, `POST /imports/workspace` safe version validation. Todoist CSV import should document supported metadata and unsupported items, preserve hierarchy when possible; never claim a complete lossless official migration if CSV cannot express it.
- `POST /backups/run`, `GET /backups`, `GET /backups/:id/download`; **restore must require host CLI or strong reauthentication and explicit destructive confirmation**, not a casually accessible web endpoint. `scripts/restore` verifies hash, schema compatibility, keeps rollback backup, restarts app safely, performs integrity check.
- `GET /api/health/live` → 200 on process alive; `GET /api/health/ready` → checks DB access, migrations, scheduler state; optional `/metrics` owner-only. Do not leak secrets/username/account data in health endpoint.
- `GET /api/v1/version` → git SHA/build timestamp/schema version (no secrets).

### G5. Contracts/DTO examples (implement schemas, not only examples)

```json
{
  "id": "01J...",
  "title": "Finish Mehak video",
  "projectId": null,
  "sectionId": null,
  "parentTaskId": null,
  "priority": 2,
  "status": "open",
  "scheduledDate": "2026-10-15",
  "dueDate": "2026-10-17",
  "dueAtUtc": null,
  "dueTimezone": "America/Vancouver",
  "deadlineDate": null,
  "recurrence": null,
  "labelIds": [],
  "position": "0000001",
  "version": 1,
  "createdAt": "2026-10-14T08:00:00.000Z",
  "updatedAt": "2026-10-14T08:00:00.000Z"
}
```

Use real field names consistently from DTO to DB mapper; do not accidentally treat calendar `event.id` and local `task.id` as interchangeable, and never let generated UI call undocumented routes.

---

## H. Multi-calendar integration — provider-specific correctness

### H1. Non-negotiable conceptual rules

- **Tasks created inside Workspace OS are local tasks**. **External calendar entries are provider-owned read-only events**. Display both in one UI, never silently push tasks to Google/Microsoft or modify an appointment.
- **Calendar events are not Google Tasks / Microsoft To Do tasks.** Those task APIs are separate and are explicitly out of v1 scope.
- Multiple accounts of same provider and multiple calendars per account; source labels and per-calendar colors; per-calendar hide/show without deleting cache. If two actual source calendars contain same meeting, keep them as distinct provider events unless user explicitly configures visual deduplication; do not drop real events merely because titles/times match.
- Calendar source data stored minimally; private events should respect provider privacy markers (show Busy/Private where appropriate; do not expose details to other clients/users). Never store attendees needlessly.
- Initial sync + durable incremental sync, throttling, invalid token recovery, deleted/moved recurring instances, and reauthorization. Show staleness and errors in UI.
- Upsert events inside DB transaction, commit cursor **only after all pages/changes committed**. On sync failure preserve old cursor and cached data; do not wipe everything on failure.

### H2. Google Calendar adapter

- Use Google Calendar API `calendarList.list` to discover calendars, with pagination.
- Per-calendar events: `events.list`, `singleEvents=true` if chosen for expanded instance storage. Determine the **correct query strategy** using current official restrictions: incremental `syncToken` cannot be combined with many filters (such as `timeMin`/`timeMax`); keep consistent query parameter fingerprint. For v1 either sync an unfiltered per-calendar collection with caps and render finite view windows locally, or adopt another documented safe partitioning strategy. **Do not combine incompatible incremental sync parameters.** Preserve recurring master/instance identity semantics and cancellations.
- Paginate and persist `nextSyncToken` only from final successful page. On 410 invalid cursor, stage safe full resync and reconcile within controlled transaction/generation; never delete task DB or expose half-synced empty view.
- Requests for date windows outside cached Google coverage must support provider fetch/backfill independent from incompatible sync token filters, then mark window coverage. Bound sync cost and time, cap historical data window for enormous calendars; give UI warning when deep history not yet fetched.
- Support OAuth scopes for **read-only calendar listing and events** using least privilege permitted by chosen endpoints; document exact scopes and consent screen configuration. Google OAuth external apps in **Testing** may issue 7-day refresh tokens when calendar scopes are requested; document publishing/verification/test-user path and handle repeat authorization cleanly.

### H3. Microsoft Graph adapter

- Discover using `/me/calendars` plus any supported collections required for user's actual account. Support delegated owner permissions `Calendars.Read` and relevant `offline_access`, openid/profile if needed.
- Initial and incremental **Graph v1.0 `calendarView/delta`** for a clearly specified start/end window; use default-calendar endpoint only for default calendar, confirm provider-supported endpoint for nondefault calendars before coding, and if unavailable choose a correct documented per-calendar polling fallback. Do not silently query only default calendar while displaying multiple connected calendars.
- Keep an opaque `@odata.nextLink`/`@odata.deltaLink` per calendar/date window; follow whole validated links only when host/path match trusted graph.microsoft.com endpoints (SSRF prevention). Do not add unsupported OData query params like `$select` on delta. Windows chosen by application coverage, e.g. rolling past 90 days / future 365 days with monthly/quarterly bounded buckets; window rotation creates/retires cursors safely, backfills when browsing outside coverage.
- Handle `@removed` tombstones and out-of-window changes safely, preserving cached event identity; provider may omit or vary recurrence identifiers; normalize and thoroughly test exceptional occurrences.
- A work/school Microsoft tenant can block third-party apps or require administrator approval. Distinguish provider admin consent denial from code defects. Microsoft personal account support depends on chosen app-registration account types and permissions; document and test.

### H4. Polling + instant UI updates (“live”)

- First production mode: **incremental provider polling**, target active sessions ~60 seconds; idle ~5 minutes; configurable adaptive schedule, jitter, rate limit/backoff, `Retry-After`, debouncing/coalescing, serialized jobs per calendar. Provider limits override target; **do not guarantee 60 seconds in every situation**.
- On visible Today/Upcoming/Calendar navigation, return cached events immediately, queue refresh for stale sources, update via SSE as new changes commit. Client should never require a hard refresh. SSE heartbeat/reconnect supports multi-tab/mobile.
- No clients or host sleep → background scheduler will run only while Windows/Docker awake; show last sync age after resume. Recovery job runs on app startup.
- Manual `Sync now` queues sync and displays progress and true result.
- Repeated provider 401/403 marks `reauth_required`; 429 uses retry/backoff; 5xx preserves cache with stale badge; 410 Google triggers safe full refresh; Graph expired delta link resets only affected window. No accidental data loss.

### H5. Optional future push/webhooks (NOT release blocker)

- Private `tailscale serve` address is not reachable by Google/Microsoft webhook senders. Public HTTPS webhooks require a separately hardened ingress such as a narrowly scoped relay/Funnel service; do **not expose app UI, database, or auth endpoints publicly**.
- If separately approved: isolated webhook receiver + channel/subscription registration, rotating secrets, `clientState`/channel token verification, provider-specific validation challenges, short acknowledgment, enqueue async refresh, renewal and cancellation, replay/idempotency controls, periodic reconciliation. Don't make public webhook setup a prerequisite for working near-real-time polling.

### H6. Provider sync acceptance tests

- Connect two Google accounts and one Microsoft account in an integration-test plan (human account consent), select/hide calendars, create/update/delete/move one event on provider website and observe automatic PWA change after poll; no manual refresh; time synchronization and staleness measured.
- Event all-day, multi-day, DST crossing, weekly recurrence, modified single occurrence, cancelled occurrence, dual provider overlap, change timezone, renamed calendar, revoked token, quota 429, invalid delta/sync cursor, calendar access removed. Build **fake adapter fixtures** for all scenarios so CI runs without OAuth; require real-provider verification as a separate recorded gate.

---

## I. Offline PWA architecture and conflict rules

**Service worker:** precache versioned app shell, icons, fonts, safe public assets; offline fallback screen; authenticated API responses should **not** be blindly cached globally in a shared Cache Storage key. For logged-in workspace tasks use Dexie/IndexedDB partitioned by owner identity / device. Clear cached workspace data on logout and account switch. UI must never show another user's tasks after logout, even offline. This browser cache is not encrypted against full-device access; document local-device security caveat.

**Offline-first task actions:** capture, edit, complete/reopen, reorder, label changes, project creation from offline mobile. Each action appends to durable outbox `{idempotencyKey, deviceId, entityId, entityVersion, operation, payload, createdAt, dependencyIds, status}`; optimistic local update; explicit unsynced marker/count. Replay in dependency order after connectivity/login restored with exponential backoff; survive page close and reinstall limitations (do not claim changes survive uninstall). Server deduplicates client IDs and enforces versions.

**Conflict strategy:** optimistic concurrency by version. On mismatch do not silently overwrite either version; show Conflict Resolution for title/notes/fields with `Keep mine / Keep server / Merge manually`, with a non-destructive copy of local draft. Automatic safe merge only for genuinely independent fields when unit tested; completing same occurrence twice is idempotent. Server timestamps authoritative after commit. Deleting a project while offline task references it requires a recover-to-Inbox path rather than losing task content. Account password changed while offline → queued actions wait for reauthentication.

**PWA installability:** `manifest.webmanifest` with app name, short name, start URL, scope, display standalone, background/theme colors, 192/512 maskable icons, Apple touch icon, shortcuts (Add Task/Today), responsive splash. Service worker uses supported cache/update lifecycle with unobtrusive “New version available — Reload” and never reloads while unsynced mutations exist without preserving queue. Test install criteria on HTTPS Tailscale URL, not only localhost.

**iOS:** Add to Home Screen manually; web push on iOS 16.4+ only for installed Home Screen web apps and permission requested on user gesture, device/browser support varies. Do not promise arbitrary background JS jobs on iOS. Server-side reminder scheduler + web push where subscriptions supported. When offline, notification timing/delivery is not guaranteed. Always retain in-app reminder list as fallback. Push requires owner permission, configured VAPID keys, and reachable push services.

**Mobile share/capture:** use Web Share Target API when supported; for iOS provide optional shortcut-friendly deep link `/quick-add?title=...` **only when authenticated** and ensure user confirms task (not a CSRF-prone GET write). Provide copy/share instructions and bookmark shortcut as fallback. Browser-only PWA cannot capture global OS shortcuts arbitrarily.

---

## J. Security, privacy, authentication and provider tokens

- Default bind Docker host port **only to 127.0.0.1**. Tailscale Serve terminates private HTTPS, forwards to loopback. Don't depend solely on tailnet authorization—require application login.
- Configure trusted origin/proxy carefully: use an exact `PUBLIC_BASE_URL` allowlist, secure SameSite=Lax/Strict HttpOnly cookies, correct forwarded proto handling only from trusted proxy, session rotation/expiry, login throttling, CSRF tokens with header+cookie or synchronizer mechanism and Origin verification for unsafe requests, strict CORS (same origin), reasonable CSP and security headers. Avoid bypassing CSRF because “it's only local”.
- First-run setup must be protected from unauthenticated tailnet guests as described in API design. Disable registration after owner created.
- OAuth: backend BFF architecture, Authorization Code flow, PKCE if supported, signed state tied to session and one-time nonce; exact redirect URL verification; least-privilege read-only calendar permissions; encrypt refresh tokens **AES-256-GCM** (random nonce per record, associated data contains account and version); encryption master key supplied in env file with restricted file ACL/volume or Docker secret and kept out of DB/backups unless encrypted separately. Offer key rotation procedure and a startup preflight error if key is lost/missing while encrypted accounts exist.
- OAuth redirect URLs: **do not assume a private `*.ts.net` hostname is accepted by either provider app-registration policy**. Provide desktop loopback callback configuration (`http://localhost:<published-port>/api/v1/calendar/oauth/...`) where provider permits, and an exact alternative publicly verifiable HTTPS URL if required. Explain that a callback opened on iPhone to `localhost` would refer to the **phone**, so OAuth setup should occur on Windows host with same server or approved redirect method. Confirm exact provider rule in official docs and via actual OAuth test; no guessed config.
- Never print OAuth client secret, refresh/access tokens, encryption keys, private calendar descriptions, session secrets, password material in logs, telemetry, browser, activity feed, health endpoint, repo, screenshots or status reports. Structured redaction and tests asserting absence in logs.
- Validate webhook destinations, provider URLs, and imported files to avoid SSRF/path traversal/CSV injection/XSS. Restrict imported data size and reject formula-like CSV cells on spreadsheet export or escape them. Markdown sanitized with safe renderer (no raw HTML); CSP. Use rate limits on login, imports, sync, and search.
- Prepared statements and Drizzle query methods exclusively; ownership check on EVERY entity endpoint and cross-entity reference (project ID must belong to owner; cannot attach another owner's label/section). Don't expose raw stack traces in production.
- Docker image runs as nonroot with read-only root FS where feasible, writable only app DB/backup/temp dirs, pinned images, minimal ports; use dependency audit + lockfile. `.env` not committed.
- Backups containing calendar data and encrypted provider tokens are sensitive; local restricted volume, rotate backups, protect download with reauth; restore requires original master encryption key or separate export strategy. Support deleting all app-owned data via confirmed admin CLI.
- Service worker must not leak cached tasks after logout. Tailscale ACLs should limit devices; document “Tailscale is not a substitute for application authentication.”

---

## K. Reminders, background jobs, SSE and activity

- Provide in-app reminders for scheduled tasks and **opt-in Web Push** for supported browsers; no invasive automatic permission prompt. Task reminder can be `at fixed datetime` or `N minutes before scheduled/due timestamp`; for date-only tasks, require a user-configurable default reminder time and timezone (do not trigger at 00:00 by accident).
- Scheduler scans indexed due jobs, claims with DB lease, delivers once per `(user,task,occurrence,channel,reminder)` with unique idempotency key. Retry temporary provider/push failures and distinguish permanent subscription failures. If Windows slept through reminder time, send only within configured late-delivery grace; record missed/expired otherwise, avoiding dozens of outdated pushes after wake.
- Server-sent events are authorized and emitted after successful DB transaction. `app_events.seq` provides resumption; every event carries monotonic `id`, event type, safe payload. Event-stream 30s heartbeat; 15s reconnect backoff with jitter; on event-log retention gap send `resync_required` and requery. SSE does not equal Google/Microsoft push; it only pushes *locally committed changes* to the browser. Multiple windows should immediately reflect task edits. Provide fallback periodic HTTP refresh if SSE disconnected.
- Optional notification center for reminders, sync errors and import results, grouped by date. Activity feed is authoritative for changes, not a separate duplicated task list.

---

## L. Data backup, durability and migration strategy

1. Named Docker volumes: `/app/data` (SQLite, app state), `/app/backups` (backup archives), optionally `/app/uploads` if attachments implemented. No `docker compose down -v` in docs or destructive scripts. Configure retention, disk space checks and storage location.
2. SQLite WAL mode: do **not simply copy an open `.db` file**. Use SQLite online backup API (`better-sqlite3` backup), consistent snapshot or `VACUUM INTO` with safe constraints, then `PRAGMA integrity_check`, SHA-256, manifest `{appVersion,schemaVersion,timestamp,dbHash,filesIncluded}` and atomic rename. Include uploaded assets and encryption-key *recovery guidance*, not necessarily key itself. Daily automated backup, retain configurable 7 daily + 4 weekly + 3 monthly or reasonable equivalent; allow manual backup/download.
3. Offer encrypted off-machine backup as documented **optional** user-configured destination; single-disk backup is not disaster recovery. Do not presume Google Drive or another cloud connector is installed.
4. Restore CLI must: verify hash, stop app writes, take rollback backup, check schema, restore atomically, validate database, restart and health-check; if failed, rollback. Test using generated real task/project/calendar fixture data and verify counts/content after restore.
5. Export all local user-created tasks/projects/sections/labels/templates/activity to JSON with explicit schema version; CSV for tasks. Calendar provider data may be re-synced instead of exported by default; make selection explicit. Preserve IDs on full workspace import when safe; report mapping and conflicts on partial import.
6. Migration roll-forward test: install previous schema → start new image → backup → migration → verify live tasks and views retained. Never initialize an empty DB when old DB path missing due to accidental mount change without a prominent warning and checks.
7. Log rotation and storage: bounded logs, cleanup of expired sessions/job records, controlled full-text index maintenance and cursor pruning.

---

## M. Windows 11 / Docker Desktop / Tailscale deployment — exact target

**Assume**: Windows 11 host, Docker Desktop with Linux containers / WSL2 enabled, Tailscale already connected on Windows and phone. Cursor must test actual installed versions and output tailored commands (PowerShell, and optionally GUI path) rather than blindly pasting obsolete commands.

### M1. Container design

- Single runtime image runs the backend server + embedded durable scheduler; serves prebuilt frontend static assets and API on internal port **3000** under the same origin. Use multi-stage Node LTS image; nonroot user, healthcheck, `NODE_ENV=production`, production dependencies only, graceful SIGTERM shutdown (flush leases/DB).
- Compose service `app` with `restart: unless-stopped`, `healthcheck` URL `http://127.0.0.1:3000/api/health/ready`, environment from `.env`, Linux volumes for `/app/data` and `/app/backups`, explicit port `"127.0.0.1:4390:3000"` for Windows-loopback **only**. Include `init: true`/graceful process handling if appropriate. Validate on Docker Desktop; never inadvertently bind 0.0.0.0.
- Startup path: validate env -> migration (backup before destructive operation) -> ensure encryption key strategy and owner bootstrap -> run server -> start scheduler -> ready. Fail with actionable logs, never quietly reset DB.
- Dev workflow: `pnpm install`, `pnpm dev`, `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm build`; Docker `docker compose up -d --build`, `docker compose ps`, `docker compose logs -f app`, `docker compose down` (no `-v`). Add `scripts/doctor` that checks Docker, port, configured URLs, database, OAuth settings, Tailscale HTTPS reachability via nonsecret status.

### M2. Tailscale Serve

- Proxy Windows host loopback service to tailnet HTTPS: demonstrate the **currently supported installed** CLI form, e.g. `tailscale serve --bg 4390` if supported; **verify using `tailscale serve --help` and `tailscale serve status` first**. Alternative `tailscale serve --bg http://127.0.0.1:4390` if current CLI accepts it. Do not make up syntax.
- Enable tailnet HTTPS/MagicDNS in Tailscale control console as required. App accessible on returned private `https://<machine>.<tailnet>.ts.net/`; mobile Tailscale VPN must be connected. Confirm actual hostname rather than hardcoding example.
- Configure `PUBLIC_BASE_URL` to the actual Serve HTTPS URL and `TRUSTED_ORIGINS` to this URL and optionally development loopback origin. Because browser cookies and OAuth redirects are host-specific, test login/session persistence at final HTTPS origin.
- No port-forwarding, public DNS, Tailscale Funnel, or public webhooks for v1.
- Document Docker Desktop option **Start Docker Desktop when you sign in**, Windows sleep/hibernate policy, restart after reboot and user login dependency. **Docker Desktop is not automatically a guaranteed unattended 24/7 server just because `restart: unless-stopped` is configured.** Recommend dedicated Linux host later if true always-on uptime is required.
- Test a Windows restart scenario when feasible: Docker starts, container healthy, Tailscale Serve still configured, iPhone PWA accesses over VPN; if cannot automate, mark manual owner step.

### M3. Environment variables and provisioner

Provide validated `.env.example` containing documentation and defaults but no real secrets:

```dotenv
NODE_ENV=production
APP_PORT=3000
HOST_PUBLISHED_PORT=4390
PUBLIC_BASE_URL=https://REPLACE_WITH_ACTUAL_PRIVATE_TS_NET_HOST
TRUSTED_ORIGINS=https://REPLACE_WITH_ACTUAL_PRIVATE_TS_NET_HOST
DATABASE_PATH=/app/data/workspace.sqlite
BACKUP_DIR=/app/backups
OWNER_TIMEZONE=America/Vancouver
SESSION_SECRET=GENERATE_RANDOM_LONG_SECRET
DATA_ENCRYPTION_KEY=GENERATE_RANDOM_32_BYTE_KEY_BASE64
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:4390/api/v1/calendar/oauth/google/callback
MS_CLIENT_ID=
MS_CLIENT_SECRET=
MS_TENANT=common
MS_REDIRECT_URI=http://localhost:4390/api/v1/calendar/oauth/microsoft/callback
ACTIVE_SYNC_SECONDS=60
IDLE_SYNC_SECONDS=300
BACKUP_RETENTION_DAILY=7
BACKUP_RETENTION_WEEKLY=4
BACKUP_RETENTION_MONTHLY=3
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_CONTACT_EMAIL=
```

**Important:** These are proposed variable names and redirect URI examples, not proof providers accept them. Cursor must implement exactly documented mapping and verify matching provider app-registration restrictions. Prefer generating secrets securely with a local CLI command and writing `.env` with explicit user approval; never commit secrets. Do not use insecure placeholder values in production. If OAuth secrets missing, core task app remains fully functional with a clear **Not configured** calendar setup page.

### M4. Setup UI walkthrough

1. `docker compose up -d --build` and open local app.
2. Create owner with one-time setup code, choose timezone, password, theme.
3. Optional `Connect Google`: detailed wizard links to official Google Cloud Console, enable Calendar API, configure consent/test users or publishing, app credentials, redirect URI, permission scopes; paste secrets into restricted `.env`/secret store **on host**, restart; sign in via host desktop browser. Result lists all visible calendars to choose.
4. Optional `Connect Outlook`: register Microsoft Entra app with permitted personal/organizational account types, delegated scope, secret, redirect URI; inform user when tenant admin consent is required; sign in via host browser; select calendars.
5. Mobile: connect Tailscale, open exact HTTPS hostname in Safari, Add to Home Screen; Android Chrome `Install app`; sign in; optionally enable notifications via user gesture; test new offline task and sync.
6. Backup verification and app version details in Settings; leave `docs/OWNER_ACTIONS.md` with any unperformed setup step.

---

## N. Implementation stages and stop/go gates

Each stage must be a runnable increment; build through **Stage 9** before claiming shipped, unless blocked by external owner actions. A stage gate is not passed if UI uses dummy data or API returns success without persistence. Cursor should continue sequentially without asking for approval for normal engineering decisions; ask only when external account credentials or destructive actions are required.

### Stage 0 — Repository discovery and architecture

- Inspect existing repository; document choices; scaffold monorepo, strict lint/typecheck, baseline unit and Playwright runner, branded blank responsive app, working Fastify app and SQLite schema migration runner, Dockerfile and Compose. Write `AGENTS.md`, status ledger.
- **Gate:** developer can run web/server; Docker build succeeds; `/health/ready` responds; initial page loads in desktop and mobile Playwright.

### Stage 1 — Authentication, persistence, setup

- Implement secure owner initialization, login/session/logout, trusted proxy, CSRF, password management, encrypted credentials storage, database schema/migrations, backups CLI minimal path; record account and settings.
- **Gate:** owner setup once only, login survives refresh, unauthorized API fails, logout invalidates session, no secrets logged, SQLite persists across Docker restart.

### Stage 2 — Full task/project domain

- Implement project/section CRUD, nested projects/favorites, task CRUD, Inbox, subtasks, priorities, labels, scheduling vs due vs deadline, comments, bulk edit, soft deletion/restore, manual position/order, activity journal, recurring rules and completion history.
- **Gate:** API CRUD integration tests, recurring DST/undo tests, version conflict tests, persistence after restart; no fake seeded production records.

### Stage 3 — Polished responsive productivity UI

- Desktop sidebar, phone bottom nav, Quick Add, Inbox, Today, Upcoming agenda, projects List+Board drag/drop, task detail sheet, search, filters, labels, favorites, empty/loading/error states, templates, activity/reporting, keyboard/assistive accessibility. Exactly align behavior with §E.
- **Gate:** all core end-to-end journeys pass on desktop and emulated iPhone/Android sizes; 375px width without overflow; 44px targets; realistic manual navigation.

### Stage 4 — Calendar providers and caching

- Google OAuth + calendar discovery + initial/incremental sync + full-resync recovery; Microsoft OAuth + per-calendar windowed delta/fallback + cursors; external event normalization/recurrences, color/visibility, status, sync worker and retry/backoff. Unit-test fake providers; implement real buttons and connections, no public webhooks.
- **Gate:** fixture-based full/repeated sync and deletion/cursor cases; live external accounts clearly `NOT VERIFIED (owner configuration required)` until real sign-in; app remains functional without accounts.

### Stage 5 — Unified day/week/month agenda + live streams

- Today and Upcoming union display, calendar overlay UI, standard FullCalendar view or equivalent, filters and days beyond initial range, SSE multiple clients, automatic refresh, status/staleness badge, manual Sync now progress.
- **Gate:** new fake external event appears without hard browser refresh, overlapping/calendars-all-day tests, changed provider event doesn't erase task or duplicate.

### Stage 6 — Installable offline PWA, mobile polish

- Manifest/icons, service worker, IndexedDB cached workspace and outbox, online/offline indicator, background retry when open, conflict resolver, mobile shares where supported, iOS/Android install docs, version updates, bottom safe area, local device privacy.
- **Gate:** emulated offline create/edit/complete; close/reopen; reconnect and drain queue exactly once; logout clears cache; Playwright mobile tests. Human-installed iPhone/Android gate only if devices accessible.

### Stage 7 — Notifications, templates, reporting, import/export

- In-app reminders, optional VAPID push opt-in, all filter operators, template previews, weekly review, project tracker, full activity feed, stats, CSV/JSON import/export with preview/dedupe.
- **Gate:** time-controlled reminder dedupe, template clone without duplicates, import/export roundtrip, safe CSV, reporting correctness, no shared data leaks.

### Stage 8 — Reliability/security/backups and production deployment

- Auth threat model; CSRF, header/origin tests; backup scheduling, downloadable export and tested restore, startup migrations/backward compatibility, Docker health and restart persistence, proper logging; tailnet HTTPS docs and verification; stale calendar conditions, hostile input tests, accessibility/performance.
- **Gate:** `pnpm check` green, full E2E green, Docker integration and restore test green, no unresolved critical security gaps, production manual smoke checklist complete or accurately `BLOCKED_EXTERNAL`.

### Stage 9 — Final release QA and handoff

- Conduct end-to-end owner workflow on deployed app; run integrated smoke script; produce user-friendly README, exact deployment steps, `.env.example`, OAuth registration guide, docs, screenshots (from app), release checklist with honest PASS/FAIL/BLOCKED markings; update BUILD_STATUS and OWNER_ACTIONS with explicit remaining human actions.
- **Gate:** core task app works with zero calendar accounts; when owner provides provider credentials, calendar connection/sync workflows are functional and tested with real accounts as far as practical. No residual `TODO implement`, fake buttons, dummy calendar events on production screens, or unhandled app crashes. No claim “all integrations tested” without actual authenticated test.

### Cursor continuation rule

At the start of each subsequent session, read `AGENTS.md`, `docs/BUILD_STATUS.md`, `docs/OWNER_ACTIONS.md`, and last test logs; determine highest-priority incomplete milestone; run existing tests first; continue. When token/context limit approaches, save status with exact commands/results and next steps. This allows **multi-session completion** without losing project history. Do not repeatedly redesign, rescope, or recreate files in each session.

---

## O. Test matrix — required automation

Create tests in separate layers; critical tests are not optional. Use a fake clock/timezone, fake providers that simulate pagination, mutations, failures, and OAuth expiry; ephemeral DB. All tests run without private Google/Microsoft accounts, with a separate human real-provider checklist.

### O1. Domain unit tests

- Title trim/validation, task saved to Inbox when no project selected, priority range, case-insensitive labels, project hierarchy cycle rejection.
- Task/subtask completion, undo, recurring fixed schedule vs completion-based recurrence; monthly Jan 31, leap day, DST spring/fall, multiple timezones, date-only stability, undo duplicate avoidance, overdue classification, scheduled vs due date.
- Section move validates target owner/project; deletion/archive moves/preserves tasks per explicit policy.
- Saved-filter AST validation and correct AND/OR grouping; search exact and fuzzy tokens; template cloning; stable reorder positions.

### O2. API/security integration tests

- Fresh bootstrap only once with setup secret, login/logout/sessions/CSRF, rate limiting, password change invalidates old sessions per policy, no enumeration.
- All CRUD/status errors; bad/missing project IDs; idempotent creation/completion; `409` on stale version; simultaneous writes; pagination and ordering.
- FTS synchronization; XSS injection in title/comment/description, path traversal/unsafe URL, CSV injection, import oversized file, cross-owner access using fixture second owner (even if signup disabled).
- OAuth state invalid/reused, encryption/decryption key rotation test, missing keys startup error, provider token redaction in logs, callback CSRF rejection.
- Backup integrity and restore roundtrip with dirty WAL, interrupted backup, simulated low disk or permission failure, old-to-new migration.

### O3. Calendar adapter tests

- Two providers/two accounts, multi-calendar discovery, initial incremental full pages, expired Google 410, Graph nextLink/deltaLink/range rotation, provider throttle `Retry-After`, access revoked, transient 5xx, calendar renamed/hidden/disconnected.
- Recurring master+instances, moved occurrence, canceled exception, private/busy event, all-day exclusive end date, change timezone, duplicate display prevention, deleted event tombstones, account removed. Event cache preserved on failed sync, cursor not advanced prematurely.
- Poll loop serialized under concurrent requests; active vs idle cadence; provider errors set visible stale status; SSE emits only after successful DB commit.

### O4. Browser E2E routes

1. Install/start dev server → login → Inbox empty → quick-add title only → item visible.
2. Create project with sections → move Inbox item to project → switch list and board → drag to column → reload persists.
3. Add subtasks, label, priority, due date/time, recurring rule → edit detail → complete and undo → activity history correct.
4. Today shows overdue and today's tasks only (plus selected calendar events); toggle completed and sort; empty state.
5. Upcoming date strip → seven days → month boundary → date `+` creates task on chosen day; multiple overlapping fake events.
6. Favorites, Search, saved filters, project template apply, Activity report all functional.
7. Offline simulated → quick-add task → reload → queued item visible → reconnect → exactly one remote creation, no duplicates.
8. Two browser contexts/session windows → mutation in one → other updates over SSE; interrupted SSE recovers.
9. Mobile iPhone emulation: 375x812 and 390x844; bottom nav, FAB not blocked, task sheet on keyboard, month swipe, scroll, browser zoom accessibility.
10. Logout clears sensitive offline storage and cookie; back button does not reveal cached prior user's task detail.
11. Docker stop/start retains DB, tasks, external cached events, app sessions as appropriate; healthchecks and schema stable.
12. Backup → reset isolated test deployment → restore → compare checksums/records/history, validate UI.

### O5. Nonfunctional targets (on ordinary local Windows hardware)

- Quick Add UI opens <250ms after click/key for warm app; local optimistic task shown <150ms; server create p95 <500ms without calendar API work on local network under normal load. These are **measured targets**, not claims.
- List rendering smoothly supports 1,000+ tasks per project with virtualization as needed, calendar month 500 visible events without freezing, search 10,000 tasks with indexed query (record benchmark method/results).
- No horizontal overflow at 320px/375px/768px/desktop widths; WCAG 2.2 AA-minded color/keyboard/focus semantics; automated axe checks on representative screens; no axe serious/critical violations.
- Offline idempotency survives 100 queued operations and reconnect; no task loss on app process termination after successful server commit; backups verify checksum and restore.
- Avoid running active external-calendar polls when no accounts configured; respect backoff, avoid provider quota bursts after restart.

---

## P. Manual acceptance checklist (owner/device/provider gates)

Cursor must present this checklist in `docs/RELEASE_CHECKLIST.md` and mark honestly:

- [ ] Windows Docker Desktop runs Linux image; `docker compose up -d --build` healthy; Tasks persist after full Docker restart.
- [ ] Tailscale Serve HTTPS private hostname opens on Windows; logged in across refresh.
- [ ] iPhone with Tailscale connected opens app; Safari → Share → Add to Home Screen → standalone launches and authenticates.
- [ ] Phone Quick Add creates task in under a few seconds; Inbox → project move; board/list and Today/Upcoming work with real stored tasks.
- [ ] Disconnect phone network; create/complete task offline; restore connectivity; only one server write per mutation.
- [ ] Add Google Account A; select two calendars; external appointment appears in correct local time; modify appointment in Google UI; Workspace OS refreshes without page reload after polling.
- [ ] Add Google Account B; verify calendar sources not conflated.
- [ ] Add personal Microsoft account or authorized Microsoft 365 tenant; same end-to-end external event test; if tenant forbids consent, record BLOCKED_BY_TENANT and continue all other gates.
- [ ] Create all-day and recurring appointments, edit/cancel an occurrence, remove an appointment; ensure view updated correctly and no duplicate ghost.
- [ ] Simulate provider unauthorized/expired token, reconnect and resume with cache retained.
- [ ] Test desktop/mobile reminders and opt-in push for available supported device/platform; no push permission prompt without tap.
- [ ] Create downloaded backup, perform **restore on separate disposable test deployment**, verify task/project history unchanged, and report backup encryption/key requirements.
- [ ] Host restart/sleep scenario understood; app recovery and last-sync staleness displayed.

Do not mark all checked from mocked tests alone. Distinguish **Automated verified**, **Manually verified**, **Blocked external**, **Not verified**.

---

## Q. Cursor agent's requested behavior on UI/screenshot fidelity

The user provided mobile screenshots from Todoist showing:

1. Inbox empty state with floating + and bottom tabs.
2. Today agenda / completion state with calendar event tiles.
3. Upcoming weekly horizontal date strip and day-grouped agenda.
4. Browse with Search, Filters & Labels, Reporting, Favorites and Projects.
5. Display settings: agenda/week layout, completed tasks, sorting and filter fields.
6. Templates browser, popular templates (weekly review, tracker).
7. Activity feed / project event history.

**Implement the functional equivalents, not the Todoist artwork or wording.** Use a similar degree of clarity, predictable navigation, compact priorities, original empty-state illustrations, and a consistent coral accent. Desktop styling should be deliberately optimized rather than stretched phone UI. If screenshots are available as attachments in Cursor, inspect them for layout reference; **do not assume the Cursor process can read images in this ChatGPT conversation unless user attaches them there**.

UI quality bar: polished typography and spacing, clear focus, usable gestures, native-feeling pull interactions where possible, accessible keyboard alternatives, smooth transitions respecting reduced motion, functional context menus, no gratuitous dashboards or complex forms. Use genuinely functional data from API with loading/error states, not screenshot replicas.

---

## R. Release-critical failure modes to prevent

| Failure | Required prevention / detection |
|---|---|
| Docker restarts and tasks disappear | Named persistent volume, integration restart test, DB sanity check |
| App works only from localhost | Tailscale Serve HTTPS check on a different device |
| PWA appears installed but no offline capture | IndexedDB outbox, offline E2E, conflict/reconnect proof |
| OAuth works on Windows but iPhone callback loops to localhost | Host-based account connection + provider-compliant redirect strategy; documented UX |
| Google sync breaks after a week | Testing-mode token expiry warning and reauth state; production consent guidance |
| Graph shows only default calendar | Correct discovery and nondefault per-calendar sync/fallback tests |
| Completed repeating task disappears or duplicates | Stable occurrence IDs and transactional next recurrence generation |
| Date-only item shifts calendar day | Store local `YYYY-MM-DD` separately from UTC timestamp |
| One failed provider sync wipes events | Atomic sync cursor/rows, generation reconciliation, stale cache indication |
| Two tabs overwrite edits | Optimistic version and SSE refresh/conflict feedback |
| Offline mutations duplicate after retry | Unique clientMutationId and exactly-once server idempotency |
| App leaks through host port | Bind to 127.0.0.1; Tailscale private HTTPS; login & CSRF |
| Saved calendar token in browser/leaked logs | Backend-only encrypted token store, redaction tests |
| Backup of open SQLite database corrupts | SQLite backup API + integrity check + restore drill |
| Owner assumes task is due when only planned | Distinct scheduled vs due vs deadline data and UI |
| Provider quota exceeded from 1-minute sync for many calendars | Adaptive coalesced polling, per-account throttling/backoff and diagnostics |
| Notification undelivered on sleeping iPhone | Document OS/permission constraints; server queue and in-app fallback |
| Mobile footer hides controls | Safe-area padding and real-device emulation |
| Cursor claims done on template UI | No `implemented` without server persistence/browser E2E |

---

## S. Documentation and command requirements

`README.md` must open with quickstart for **Windows PowerShell** (assume Docker Desktop already installed) and exact prerequisites, then detailed sections for development, production/private network, OAuth setup, mobile installation, backup/restore, updating app, uninstalling without data loss, troubleshooting. Include safe command snippets for actual scripts implemented, and expected output. Never instruct `docker compose down -v` as standard cleanup.

`docs/OWNER_ACTIONS.md` must have a dated table: step, why a human must do it, screenshot/page/console navigation, exact config key, validation test, blocker status. Credential example values must be placeholders clearly never meant for production. All provider registration steps must refer to current official Google/Microsoft docs and link them. Tell user to keep Google/Microsoft app secrets and server encryption key backed up privately.

`docs/BUILD_STATUS.md` starts with this structure and is updated each milestone:

```md
# Workspace OS Build Status
Last updated: <timestamp>
Build commit: <sha or uncommitted>
Current stage: <0..9>
Overall status: IN_PROGRESS | CODE_COMPLETE_UNVERIFIED | VERIFIED_CORE | VERIFIED_WITH_PROVIDERS

| Stage | Status | Files / evidence | Test command & result | Remaining issue |
| --- | --- | --- | --- | --- |
...

## Current blockers requiring owner action
...
## Latest executed commands and actual results
...
## Next three concrete tasks
...
## Known limitations and mitigations
...
```

Provide a single smoke command that checks HTTP readiness, owner auth, CRUD in a disposable **test database**, task query, and provider fixture sync; ensure it cannot modify live owner data accidentally.

---

## T. Optional phase 2 / extensions (design interfaces, do not delay v1)

- Two-way calendar event create/edit/deletion with explicit selection of provider/calendar, read/write OAuth scope upgrade, optimistic ETag/If-Match support, conflict resolution, audit and undo where supported.
- Sync Google Tasks and Microsoft To Do via dedicated APIs, allowing selected list/task mappings without double-counting tasks imported as events.
- Time blocking: place a local task as proposed slot alongside free/busy calendars (no writeback until owner chooses); allow scheduled work vs hard deadline.
- AI optional, preferably local provider: clean Inbox suggestions, summary of weekly outcomes, prioritization explanation; never automatically delete/reschedule/publish without approval.
- CalDAV/ICS subscriptions and ICS import/export with refresh policies (ICS usually cannot push).
- Desktop native companion (Tauri) only if user demands genuine global keyboard shortcut across apps.
- Multiple independent users, shared projects/roles, delegated access, audit permissions, database migration to PostgreSQL only if necessary.
- Webhook push receiver isolated from private app after explicit owner approval and network/security review.
- Platform-dependent phone widgets; no promise of identical functionality on all browsers.

---

## U. Mandatory final acceptance gates before the word “COMPLETE”

**CORE APPLICATION (must pass automatically and be demonstrable)**

- `pnpm install --frozen-lockfile`, `pnpm check` (lint + typecheck), `pnpm test`, `pnpm test:e2e`, `pnpm build`, `docker compose up -d --build` all succeed in the available build environment. If OS/runtime denies one, document it and mark gate not verified, never fabricate.
- Database migrations tested; owner bootstrap/login secured; Quick Add is one-step; tasks CRUD + subsections/subtasks/reminders/recurrence; Inbox/Today/Upcoming; projects list/board drag-drop; search/filters/labels; templates; reporting/activity; settings all functional and backed by DB.
- Offline PWA task create/update/completion persists across reload, pushes after reconnect, handles stale versions; service worker/cache isolation tested. Tailscale HTTPS docs and mobile setup complete. Real iPhone installation marked manual unless physically tested.
- Google/Microsoft adapters implemented, fake integration suite passing, connection wizard and live UI status real, both read-only events selectable. **Real accounts not auto-connected** if credentials/consent absent; integration release state must explicitly name that limitation.
- Backups/restores verified on disposable test database, Docker volume persistence, readiness checks, auth/CSRF/secrets/owner-scope regression tests.
- No TypeScript errors, dead nav routes, inert buttons, fake synchronized calendars, fake tasks in production, placeholder `TODO` in required features, destructive ops without confirmation, missing deployment docs, or default insecure production secrets.

**FINAL OUTPUT FORMAT FROM CURSOR:**

```
Workspace OS delivery report
1. Application URL locally / over Tailscale
2. Docker health and exact command/output
3. Implemented feature checklist by stage
4. Automated test commands, totals, actual pass/fail details
5. OAuth integration state: Google / Microsoft (real tested or not)
6. Mobile PWA/offline installation verification (real tested or not)
7. Backup/restore drill result
8. Security/configuration status
9. Owner-only actions with precise instructions
10. Known risks or remaining failures
11. Honest verdict: VERIFIED_CORE / VERIFIED_WITH_PROVIDERS / NOT_YET_COMPLETE
```

**Do not state VERIFIED_WITH_PROVIDERS until actual OAuth connections and real calendar provider create/update/delete checks have been performed, or explicitly mark them unverified.**

---

## V. Current authoritative references (check for updates before coding)

- Google Calendar incremental synchronization: https://developers.google.com/workspace/calendar/api/guides/sync
- Google Events list and sync token constraints: https://developers.google.com/workspace/calendar/api/v3/reference/events/list
- Google Calendar API quotas: https://developers.google.com/workspace/calendar/api/guides/quota
- Google Calendar push notification behavior: https://developers.google.com/workspace/calendar/api/guides/push
- Google OAuth refresh token and testing limitations: https://developers.google.com/identity/protocols/oauth2/
- Google web-server OAuth redirect rules: https://developers.google.com/identity/protocols/oauth2/web-server
- Microsoft Graph v1.0 calendarView delta: https://learn.microsoft.com/en-us/graph/delta-query-events
- Microsoft Graph calendars listing: https://learn.microsoft.com/en-us/graph/api/user-list-calendars?view=graph-rest-1.0
- Microsoft identity application registration/redirect URI: https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri
- Microsoft Graph webhook network requirement: https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks
- Tailscale Serve private HTTPS: https://tailscale.com/docs/features/tailscale-serve
- Tailscale Serve CLI options: https://tailscale.com/docs/reference/tailscale-cli/serve
- Docker Desktop Windows startup behavior: https://docs.docker.com/desktop/settings-and-maintenance/settings/
- Apple installed PWA web push: https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers

The presence of a reference does not guarantee OAuth setup or platform features are available without owner action. Verify current provider behavior, quotas, and third-party package versions during implementation.

---

## W. FIRST INSTRUCTION TO EXECUTE NOW

1. Read this entire master spec and acknowledge its scope briefly inside `docs/BUILD_STATUS.md` **without asking the owner to restate requirements**.
2. Inspect the existing repository and build tools. Create the implementation task ledger mapped to Stages 0–9, list missing provider secrets as external actions, and start Stage 0 immediately.
3. Continue to the next stage after each verified gate. Fix problems as you go. Keep the app runnable at every milestone.
4. If a Google/Microsoft credential or Tailscale host action is missing, **do not halt the whole build**: implement provider adapters with test fixtures, mark external validation blocked, and continue every other stage.
5. Stop to ask for human intervention only on genuinely owner-only external authorizations, financial/licensing commitments, potentially destructive host/data changes, or decisions impossible to resolve safely from this contract.
6. When your execution budget/context is exhausted, update `docs/BUILD_STATUS.md`/`docs/OWNER_ACTIONS.md` and give the exact next instructions. Resume on next agent turn from those files. Do not call the application complete until §U is honestly satisfied.

**BUILD THE APPLICATION NOW.**
