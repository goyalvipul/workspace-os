# Owner actions

Things only you can do. In order of priority.

## 1. Run the app now (no Docker needed)
```powershell
cd <path-to-repo>
pnpm install
pnpm build
node --env-file=.env apps/server/dist/index.js
```
Open http://localhost:4390. The first-run setup screen asks for a **setup code**, which is printed in the terminal on startup. To print a new one: `pnpm --filter @wos/server cli setup-code`. Choose your username, password (12+ characters), and time zone.

## 2. Enable Docker (BLOCKED_EXTERNAL)
Docker Desktop is installed but Linux containers cannot start because WSL2 is missing.
1. Open PowerShell **as Administrator**: `wsl --install --no-distribution`
2. Reboot, then start Docker Desktop and accept its terms.
3. `docker compose up -d --build` in the repo root. Check with `node scripts/doctor.mjs`.
Stop the local `node` server first (both use port 4390).

## 3. Reach it from your iPhone (Tailscale Serve)
Requires step 2. I did not run this because it changes how your PC is exposed.
1. Make sure Tailscale is signed in on the PC and on the iPhone (same tailnet).
2. `tailscale serve --bg 4390` (HTTPS, tailnet only; do not use Funnel).
3. Put the resulting `https://<pc>.<tailnet>.ts.net` URL into `.env` as `PUBLIC_BASE_URL` and restart.
4. Open it in Safari, Share, **Add to Home Screen**. Enable notifications from Settings, Notifications (iOS 16.4+, only works from the installed app).

## 4. Connect real calendars (BLOCKED_EXTERNAL)
Follow `docs/PROVIDER_NOTES.md` to register a Google and/or Microsoft OAuth app, put the client id/secret into `.env`, restart, then Settings, Calendar accounts, Connect.

## 5. Backups
Backups run daily to `./backups`. Copy that folder somewhere off the PC regularly. See `docs/BACKUP_RESTORE.md`.
