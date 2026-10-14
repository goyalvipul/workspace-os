# Product

Single-owner, self-hosted task manager modelled on Todoist's phone UX, plus a read-only unified calendar.

## Core features
- **Tasks**: title, description, priority 1-4, due date or due date+time (with IANA zone), deadline, duration, labels, project/section, subtasks, comments, reminders, completion history.
- **Quick Add**: natural language (`Pay rent tomorrow 9am p1 #Home @bills`), live preview chips, undo on completion.
- **Recurrence**: fixed ("every Monday") and after-completion ("every 3 days after I finish") rules; completing creates the next occurrence and is reversible.
- **Views**: Inbox, Today (overdue + today + events), Upcoming (week strip + agenda), Calendar (month/week), Project (list and board), Label, Saved filter, Search, Activity.
- **Organise**: projects with sections, labels, saved filters (visual builder over a JSON AST; never SQL), templates (built-in + custom) with dry-run preview.
- **Calendar**: Google and Microsoft calendars shown together with tasks. Read-only, private event details masked, per-calendar show/hide and colour.
- **Offline**: full local snapshot, queued changes replay when online, conflict dialog if the same task changed elsewhere.
- **Notifications**: in-app plus web push (VAPID). Reminders for tasks.
- **Data**: CSV import (preview + token), JSON workspace export/restore, daily backups.

## Out of scope
Multi-user/sharing, writing back to external calendars, email ingestion, public exposure (Tailscale only).

## Defaults
Time zone America/Vancouver, dark theme, coral accent, week starts Monday (configurable).
