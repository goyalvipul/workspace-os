# Workspace OS

A self-hosted, single-owner task manager (Todoist-style) with a unified, read-only calendar. Installable PWA, works offline, built for an iPhone plus a Windows PC reached over Tailscale.

## Quickstart (PowerShell, Windows)

Requirements: Node 22+, pnpm, and for the container path Docker Desktop with WSL2.

```powershell
git clone <this repo> ; cd todo
pnpm install
node scripts/gen-env.mjs          # creates .env with fresh secrets (never printed)
node scripts/doctor.mjs           # checks tools, ports, env; prints PASS/FAIL/BLOCKED
pnpm build
node --env-file=.env apps/server/dist/index.js     # http://localhost:4390
```

First run: open http://localhost:4390 and enter the setup code printed in the terminal (`pnpm --filter @wos/server cli setup-code` prints a new one).

### Docker
```powershell
docker compose up -d --build
docker compose exec app node dist/cli.js setup-code
```
Data lives in the `/data` volume, backups in `./backups`. Port is published on `127.0.0.1` only; use `tailscale serve` for phone access (`docs/DEPLOY_WINDOWS_TAILSCALE.md`).

## Everyday commands

| Task | Command |
| --- | --- |
| Dev servers | `pnpm dev` |
| Lint + typecheck | `pnpm check` |
| Unit + API tests | `pnpm test` |
| Browser tests | `pnpm test:e2e` |
| Smoke test (throwaway instance) | `pnpm smoke` |
| Backup / restore | `scripts/backup.ps1`, `scripts/restore.ps1 <file>` |

## Docs
`docs/BUILD_STATUS.md` (what works, what is blocked), `docs/OWNER_ACTIONS.md` (what you need to do), and PRODUCT, ARCHITECTURE, DATA_MODEL, API, CALENDAR_SYNC, DEPLOY_WINDOWS_TAILSCALE, PWA_MOBILE, SECURITY, TESTING, BACKUP_RESTORE, PROVIDER_NOTES, TROUBLESHOOTING, RELEASE_CHECKLIST, DECISIONS. The live API reference is `/api/v1/openapi.json` (when signed in).
