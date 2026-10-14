# Workspace OS Build Status
Last updated: 2026-10-14 01:00 (UTC-7)
Build commit: uncommitted (git initialized, no commits yet)
Current stage: 0 (scaffolding) -> moving into Stages 1-2 (shared domain + server)
Overall status: IN_PROGRESS

Spec acknowledged: `start/WORKSPACE_OS_CURSOR_MASTER_BUILD_PROMPT.md` (read in full). Owner answers: install all tools, target = Docker + Tailscale Serve, full scope Stages 0-9, run the test suites only at the END (not repeatedly), git per milestone, build at repo root, no provider credentials yet (fake-provider tests), generate `.env` secrets locally, defaults America/Vancouver + dark/coral.

| Stage | Status | Files / evidence | Test command & result | Remaining issue |
| --- | --- | --- | --- | --- |
| 0 Scaffold | IN_PROGRESS | root configs, pnpm workspace, deps installed | not run | server/web skeleton, Dockerfile, compose |
| 1 Auth/persistence | NOT_STARTED | | | |
| 2 Task/project domain | IN_PROGRESS | packages/shared: ids, dates, recurrence done | not run | schemas, quickadd, filters, views, templates |
| 3 Responsive UI | NOT_STARTED | | | |
| 4 Calendar providers | NOT_STARTED | | | |
| 5 Unified agenda + SSE | NOT_STARTED | | | |
| 6 Offline PWA | NOT_STARTED | | | |
| 7 Notifications/templates/import-export | NOT_STARTED | | | |
| 8 Reliability/security/backups | NOT_STARTED | | | |
| 9 Final QA/handoff | NOT_STARTED | | | |

## Current blockers requiring owner action
- WSL2 is not installed -> Docker Desktop cannot start Linux containers. Needs admin `wsl --install --no-distribution` + reboot (see OWNER_ACTIONS.md).
- Google / Microsoft OAuth app registrations (not available yet; adapters are built against fakes).

## Environment facts
- Node v24.20.0, pnpm 12.11.2, Docker 29.8.2 (installed, daemon not usable yet), Tailscale 1.102.4, git 2.56.
- pnpm 12 uses `allowBuilds` in pnpm-workspace.yaml (better-sqlite3, esbuild approved).
- Pinned choices: TypeScript 5.9, Vite 7, vitest 3, Fastify 5, zod 4, drizzle-orm 0.44, better-sqlite3 12, @node-rs/argon2.

## Latest executed commands and actual results
- `winget install OpenJS.NodeJS.LTS` OK; `winget install Docker.DockerDesktop` OK; `pnpm install` OK (native builds approved).

## Next three concrete tasks
1. Finish packages/shared (schemas, quick-add parser, filter AST, view selectors, templates).
2. Server: env, Drizzle schema + migrations, auth/session/CSRF, task/project services, SSE.
3. Web: shell, Quick Add, Inbox/Today/Upcoming, projects list/board.

## Known limitations and mitigations
- Tests intentionally deferred to the end per owner request.
