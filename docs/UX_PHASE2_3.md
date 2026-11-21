# Workspace OS — Nori-inspired UX refresh, Phases 1B–3

**Branch:** `feat/nori-inspired-ux-phase2-3`  
**Base:** `feat/nori-inspired-ux-phase1`  
**Scope:** preserve existing task, calendar, projects, notifications, offline, provider, and integration behavior. No new meal-planning, family-sharing, shopping, nutrition, rewards or AI features.

## Phase 1B — QA and finishing the shared design system

- Standardized buttons, inputs, settings rows, dialogs, cards and touch targets. Warm, neutral light/dark colors remain user-selectable.
- Added GitHub Actions checks for ESLint, TypeScript, unit/API tests, build and Playwright desktop/mobile regression runs. E2E tests use a **new throwaway database**, never the owner's data.
- Expanded Playwright mobile coverage to include the new Home, Tasks and navigation flows; coverage now includes dashboard customization, grouped task controls and calendar deep links.
- Kept `main` and the production configuration untouched. The preview compose config in Phase 1 still provides isolated named storage and port 4391.

## Phase 2 — Existing screen refresh

- Today, Inbox and Upcoming: calm cards for task/event lists, colored focus heading and cleaner week strip.
- Project detail: better description/outcome card, completed panel, section cards and rounded board columns **without removing drag-and-drop**.
- Browse, labels, templates and search: card navigation, improved project directory and form/search surfaces.
- Calendar: refined month/week cells and selected-day treatment. Existing read-only provider access remains unchanged.
- Settings, Activity & productivity, Quick Add, task-detail sheets, Login/Setup and Archived: cohesive controls, spacing and legibility.

## Phase 3 — Practical productivity improvements

- **Dashboard customization**: show/hide and reorder Progress, Focus, Your Week, Calendar and Spaces widgets. Changes sync through existing validated account preferences.
- **Seven-day overview**: daily counts of open, top-level tasks due on the seven calendar dates starting today; date cards open the corresponding day in Calendar.
- **All Tasks grouping**: group by schedule (Overdue/Today/Next 7 Days/Later/Anytime) or project, collapse and expand, sort by due date/priority/title and filter/search existing tasks.
- **Faster Quick Add**: Today, Tomorrow and Inbox presets on Home; Due today, Due tomorrow and No due date shortcuts in the existing Quick Add form.

## Intentionally not implemented

A Nori-like nutrition tracker, shopping lists, recipes, family multi-user authorization, rewards, AI chat or voice input are separate product/backend initiatives and are not part of this delivery.

## Testing/verification checklist

On GitHub, review the latest workflow run in **Actions → Workspace OS UX checks**. Require the following before merge:

1. `pnpm check`
2. `pnpm test`
3. `pnpm build`
4. `pnpm test:e2e` (desktop + mobile)
5. Manual browser walkthrough with real user data and a test account: Home show/hide/reorder, grouped tasks, calendar jump, Quick Add date shortcuts, TaskSheet, project board drag-and-drop, search, archived restore, settings, reminder/push, light/dark, iPhone safe area and offline sync.

No migration is required. New preferences are validated and defaulted by the shared schema.

## Safe isolated Ubuntu preview (recommended)

```bash
cd /home/vipul/workspace/workspace-os
git fetch origin
git worktree add ../workspace-os-ux-phase2-3 origin/feat/nori-inspired-ux-phase2-3
cd ../workspace-os-ux-phase2-3

node scripts/gen-env.mjs
mv .env .env.preview

# Set PUBLIC_BASE_URL=http://localhost:4391 in .env.preview.
docker compose -f compose.ux-preview.yaml up -d --build
docker compose -f compose.ux-preview.yaml ps
```

Open `http://localhost:4391` on the Ubuntu host or tunnel port 4391 to your laptop. This uses a separate database and does not access the production task data. Do **not** use `down -v` unless you intend to delete preview-only data.

## Only after a successful preview: update the existing instance

Back up and verify production data first. Then, if you intentionally choose to replace the deployed frontend:

```bash
cd /home/vipul/workspace/workspace-os
git fetch origin
git switch feat/nori-inspired-ux-phase2-3
git pull --ff-only origin feat/nori-inspired-ux-phase2-3
docker compose up -d --build --force-recreate
docker compose ps
```

The production bind mounts continue to point to the existing `data` and `backups` directories. They must **never** point at test volumes. If the old UI appears, check the `/home` page in Incognito, then compare the frontend asset filename served from Docker vs your public domain. Browser service worker caching or a stale reverse-proxy upstream can still serve older assets.

**Merge recommendation:** do not merge or deploy against production data until the latest CI run has passed and the preview has been visually inspected.
