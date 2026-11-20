# UX refresh phase 1 — Nori-inspired visual direction

This branch changes the presentation layer of Workspace OS. The Nori screenshots were used as a visual reference for spacious cards, warm off-white surfaces, clear category headings, horizontally scrollable pills, and a persistent capture control. No Nori artwork, branding, proprietary UI assets or simulated AI features have been copied.

## Scope

- New **Home** dashboard at `/home` using live existing tasks, completion status, inbox counts, projects and connected read-only calendar events.
- New **All tasks** view at `/tasks`: search by title/description, filter scheduled/unscheduled, keep all existing task actions and subtasks.
- Calendar: a new **Agenda** mode with spacious day cards, events, task checkboxes and add-task actions; Month and Week remain available.
- Responsive shell: mobile scrollable top tabs, complete navigation sheet, persistent Quick Add dock and search. Refreshed desktop sidebar.
- Warm, softly layered light and dark palettes, larger touch targets, rounded task/event cards and cleaner headers.
- Settings → General → Home view now allows Home or All tasks. **Existing users' startup preference stays as-is** unless changed.
- No tables, migrations, server mutations, new integrations or changes to calendar provider permissions.

## Important limitations

This phase deliberately does **not** add shopping lists, nutrition, recipes, rewards, family sharing or an AI voice assistant. Those are separate products/features in the supplied screenshot, not capabilities of Workspace OS. The bottom dock calls the existing Quick Add feature; it does not pretend to be an AI service.

## Local verification

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm test:e2e
```

The automated suites must be run in a safe, throwaway database environment, never the owner's running instance. Inspect both a 390px phone viewport and a desktop viewport. Regression paths: existing Inbox, Today, Upcoming, Calendar, Browse, projects/boards, Quick Add, recurring tasks, swipe to archive/delete, settings, account access and offline sync. Test light and dark appearances; check iPhone safe area and the keyboard in Quick Add.

## Isolated Docker preview on the Ubuntu server

The original `compose.yaml` has hard-coded production directories, container name and Tailscale port. **Do not run it for a side-by-side test.** Instead:

```bash
# From your existing workspace-os Git checkout:
git fetch origin
git worktree add ../workspace-os-ux-preview origin/feat/nori-inspired-ux-phase1
cd ../workspace-os-ux-preview

# Generate NEW test-only secrets in this new worktree:
node scripts/gen-env.mjs
mv .env .env.preview

# In .env.preview, change PUBLIC_BASE_URL to http://localhost:4391
# Leave Google/Microsoft credentials empty for this isolated visual preview.
# Use SSH port forwarding if browsing from another computer.

docker compose -f compose.ux-preview.yaml up -d --build
docker compose -f compose.ux-preview.yaml ps
docker compose -f compose.ux-preview.yaml logs --tail=80 app
```

Access from the Docker host at `http://localhost:4391`. On another device, use `ssh -L 4391:127.0.0.1:4391 USER@YOUR_UBUNTU_HOST` and open `http://localhost:4391` locally. Port forwarding is for development only; installable PWA and push testing require a separate HTTPS origin. Since the preview uses **separate named volumes**, it starts with a new empty database and must be set up separately. Never point its volume paths to production.

Stop the preview when finished:

```bash
docker compose -f compose.ux-preview.yaml down
```

Keep the volumes for repeat tests; only use `down -v` if you explicitly want to discard **preview-only** data.

## Decision before merge

Do not merge to `main` until `pnpm check`, unit and E2E tests pass and the mobile preview is accepted. On production, existing color and startup settings remain user-configurable. Change Settings → Appearance to Light for the cream/peach visual direction in the screenshots.

## Rebuilding your existing Workspace OS instance (uses your real database)

If you intentionally choose to deploy this feature branch into your existing production instance, **make a verified backup before rebuilding**. This is different from the isolated preview above.

The old `compose.yaml` mounted host `apps/web/dist` and `apps/server/dist` directories over the freshly built files in the image. As a result, `docker compose up -d --build --force-recreate` could report success but continue serving old compiled code. That issue is fixed on this feature branch by removing **only the two build-output mounts**. The existing `data:/data` and `backups:/backups` binds remain unchanged.

After bringing down the latest commit of this branch into the checkout that houses your `.env` and persistent database directories:

```bash
git branch --show-current
git pull --ff-only origin feat/nori-inspired-ux-phase1
docker compose config --services
docker compose up -d --build --force-recreate
docker compose ps
docker inspect workspace-os --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
```

The mount list should show only `/data` and `/backups` and no `/app/web` or `/app/dist` entries. The packaged frontend is then served from the new image.

If the old app still appears on an iPhone or PWA, fully close/reopen it, accept the in-app update prompt if shown, or refresh the browser cache. In Settings → General, choose **Home dashboard** as the startup view: existing preferences still default to their prior view until changed.

Prefer the isolated preview rather than testing unverified work against the production database.
