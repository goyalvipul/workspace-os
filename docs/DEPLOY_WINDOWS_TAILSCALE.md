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
