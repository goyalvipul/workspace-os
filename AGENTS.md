# Agent guide

Workspace OS: pnpm monorepo. `packages/shared` (zod schemas, dates, recurrence, filters, quick-add), `apps/server` (Fastify 5, Drizzle, better-sqlite3), `apps/web` (React 19, Vite, Tailwind 4, Dexie, PWA).

## Rules
- Read `docs/ARCHITECTURE.md` and `docs/DECISIONS.md` before large changes. The engineering contract is `start/WORKSPACE_OS_CURSOR_MASTER_BUILD_PROMPT.md`.
- Never read, print, or commit `.env` or anything under `data/`, `backups/`. Scripts read `.env` internally and must not echo secret values.
- All mutations go through `apps/server/src/services/*` inside a transaction that also writes `activity_events` and `app_events`. Do not write SQL in route handlers.
- Tasks use optimistic concurrency (`version`); client-supplied ULIDs; soft delete. Preserve this.
- Calendar providers are read-only. Never add write-back to Google/Microsoft.
- Web store selectors must return stable references (select the map, then `useMemo`); returning `Object.values(...)` from a selector causes an infinite render loop.
- Keep WCAG AA contrast: use `text-accent-text` for accent-coloured text, `text-accent-fg` on `bg-accent`.
- Run `pnpm check` after edits. Run the whole test suites (`pnpm test`, `pnpm test:e2e`) once when done, not repeatedly.
- Use throwaway databases for tests; do not create accounts on the owner's real instance.
