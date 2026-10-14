# Deploy on Windows with Tailscale

## One-time prerequisites
1. Admin PowerShell: `wsl --install --no-distribution`, reboot.
2. Docker Desktop running (WSL2 backend). Tailscale signed in on the PC and iPhone.
3. `node scripts/gen-env.mjs` to create `.env` (fresh secrets). `node scripts/doctor.mjs` should show no FAIL.

## Run
```powershell
docker compose up -d --build
docker compose ps                        # app should be healthy
docker compose exec app node dist/cli.js setup-code
```
Open http://localhost:4390 and create the owner account.

## Phone access
```powershell
tailscale serve --bg 4390
tailscale serve status
```
Set `PUBLIC_BASE_URL=https://<pc>.<tailnet>.ts.net` in `.env` (used for CSRF/Origin checks, Secure cookies, OAuth redirects), then `docker compose up -d`. Add the same host to the Google/Microsoft redirect URIs when you connect calendars. **Never use `tailscale funnel`.**

## Start on boot
Docker Desktop: Settings, General, "Start Docker Desktop when you sign in". The compose service has `restart: unless-stopped`.

## Update
```powershell
git pull; docker compose up -d --build
```
A pre-migration safety copy of the database is made automatically if the schema changes.

## Run natively on Windows at logon (no Docker)

- `powershell -ExecutionPolicy Bypass -File scripts/install-startup.ps1` registers a per-user scheduled task, **WorkspaceOS Server**, that runs `scripts/run-server.ps1` at logon and restarts it if it crashes. No admin rights needed.
- The server listens on `127.0.0.1:4390` only; `tailscale serve --bg --https=443 http://127.0.0.1:4390` publishes it to the tailnet (Serve must be enabled once in the Tailscale admin console). Set `PUBLIC_BASE_URL` and `TRUSTED_ORIGINS` in `.env` to the `https://<machine>.<tailnet>.ts.net` address.
- Log: `data/server.log`. Start/stop: `Start-ScheduledTask` / `Stop-ScheduledTask -TaskName 'WorkspaceOS Server'`. Remove: `scripts/install-startup.ps1 -Remove`.
- After rebuilding (`pnpm build`) or editing `.env`, run `powershell -ExecutionPolicy Bypass -File scripts/restart-server.ps1`. Stopping the task alone leaves the node process running with the old settings.

