# Today — List and To Do / Done columns

This change is **only for Today**. It does not replace project boards, sections, Inbox or other workflows.

## How it works

- Today → **List** retains the original experience and existing task sorting, focus, overdue, calendar events and completion settings.
- Today → **Columns** shows **To Do** and **Done** side by side, including on mobile.
- The layout choice syncs as account preference `display.todayLayout` and defaults to `list` for existing accounts.
- `To Do` = open tasks in today's view (overdue, scheduled/due today, and focus tasks). `Done` = tasks marked completed **today**. Older completions belong in reports and projects.
- Drag from the grip handle to the other column. On phones press and hold the handle; don't drag from a text field. A dedicated **Move to Done / Move to To Do** button is available for accessibility and when drag/drop is inconvenient.
- Each card has a short **Status update** field (280 characters), visible and editable directly on the board. It is independent of Description and Comments, saved on blur or Enter, and uses the existing optimistic/offline sync outbox.
- The same Status update field is editable in task details.
- The pre-existing completed-parent/subtasks prompt remains active when completion occurs. Recurring tasks may advance to the next occurrence rather than remain completed in Done.
- Reopening a completed task that isn't due or scheduled today schedules it for Today; this prevents an unscheduled card from disappearing when moved back into To Do. Hard deadlines remain unchanged.
- A separate `status_update` field in `tasks` means no project statuses or sections are modified.

## Migration / production deployment warning

This branch includes **`apps/server/drizzle/0005_task_status_update.sql`** and updates the Drizzle migration journal. The migration adds a NOT NULL text column with an empty-string default and preserves existing tasks.

**Back up your real database and verify the backup before deploying.** On startup, the app runs pending migrations; do not switch back to an older server image after applying this migration without considering schema compatibility.

```bash
cd /home/vipul/workspace/workspace-os
git fetch origin
git switch feat/today-two-column-board
git pull --ff-only origin feat/today-two-column-board
docker compose up -d --build --force-recreate
docker compose ps
```

After deployment, open `/today`. Switch to Columns, enter a note, blur the field to save, move a card into Done, move it back, and switch to List. Refresh the app to confirm the layout choice and note persist.

## Verification

- GitHub Actions: lint/typecheck, unit/API, production build, Docker build and desktop/mobile Playwright.
- Regression coverage: List/Columns persistence, status note save after reload, complete/reopen, desktop pointer drag.
- Manually verify iPhone long-press drag, safe-area height, on-screen keyboard while editing a note, offline queued updates and an existing recurring task.

**Do not merge while CI is red or the iPhone behavior has not been checked.**
