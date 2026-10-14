# Troubleshooting

First run `node scripts/doctor.mjs`; it prints PASS/FAIL/WARN/BLOCKED per check without showing secrets.

| Symptom | Cause / fix |
| --- | --- |
| Docker says "WSL2 is not installed" / engine won't start | Admin PowerShell `wsl --install --no-distribution`, reboot, start Docker Desktop |
| Setup screen asks for a code | It is printed in the server terminal at startup; or `node --env-file=.env apps/server/dist/cli.js setup-code` / `docker compose exec app node dist/cli.js setup-code` |
| Login works but actions fail with 403 CSRF/Origin | `PUBLIC_BASE_URL` (or `TRUSTED_ORIGINS`) does not match the URL in the browser; fix `.env`, restart |
| Port 4390 already in use | Another copy is running (local node or container); stop it, or change `HOST_PUBLISHED_PORT` |
| Phone shows stale app | Tap the "Update available" banner; or close and reopen the installed app |
| No push notifications on iPhone | Must be installed to Home Screen, iOS 16.4+, over HTTPS, notifications enabled in Settings, and in iOS Settings |
| Calendar account shows "Reconnect" | Token revoked/expired (Google "Testing" apps expire after 7 days); click Reconnect |
| Calendar "not configured" | Provider env vars empty; see `PROVIDER_NOTES.md` |
| `.env` rejected at startup | Missing/placeholder secret; run `node scripts/gen-env.mjs` for a new file (this invalidates existing sessions and encrypted tokens) |
| Database locked / corrupt | Stop the app, restore the latest backup (`BACKUP_RESTORE.md`) |
| Time looks off by an hour | Check Settings, Date & time, time zone; due times are stored with their own zone |
