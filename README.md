# Workspace OS

A self-hosted, single-owner task manager (Todoist-style) with a unified, read-only calendar (Google and Outlook). Lists, boards, recurring tasks, reminders, labels, filters and quick-add with natural language. It is an installable PWA that works offline, and it runs as a single small process with a SQLite file for data.

- **Stack:** pnpm monorepo. `packages/shared` (schemas, dates, recurrence), `apps/server` (Fastify, Drizzle, SQLite), `apps/web` (React, Vite, Tailwind, Dexie).
- **Your data stays with you:** one SQLite file plus backups. Calendar providers are read-only; nothing is ever written back to Google or Microsoft.

---

## Set it up on your own server (from scratch)

You need one machine that stays on: a Linux VPS or home server, a Windows PC, a Mac, or a Raspberry Pi. Pick **one** of the two ways to run it.

| | A. Docker (recommended on a server) | B. Plain Node |
| --- | --- | --- |
| Needs | Docker with Compose | Node 22+ and pnpm |
| Updates | rebuild the image | `git pull` + build |
| Data | Docker volumes | `./data` folder |

### Step 1. Get the code and create your config

```bash
git clone https://github.com/goyalvipul/workspace-os.git workspace-os
cd workspace-os
```

Create `.env` with freshly generated secrets (they are written to the file and never printed):

```bash
node scripts/gen-env.mjs            # for Docker (A)
node scripts/gen-env.mjs --native   # for plain Node (B): loopback only, data in ./data
```

> If `node` is not installed yet and you chose Docker, copy `.env.example` to `.env` by hand and fill in `SESSION_SECRET` (48+ random characters) and `DATA_ENCRYPTION_KEY` (32 random bytes, base64: `openssl rand -base64 32`).

Then open `.env` and set the address you will use to reach the app. This matters: it is used for the login origin check, cookies and OAuth redirects.

```ini
# What you type in the browser. Use https:// whenever the app is reached over the network.
PUBLIC_BASE_URL=https://todo.example.com
# Optional extra addresses that may use the app (comma separated), e.g. a second hostname.
TRUSTED_ORIGINS=
OWNER_TIMEZONE=America/Vancouver
```

For a first test on the same machine leave `PUBLIC_BASE_URL=http://localhost:4390`.

**Never commit `.env`.** It holds your secrets and is already in `.gitignore`.

### Step 2A. Run with Docker

```bash
docker compose up -d --build
docker compose exec app node dist/cli.js setup-code
```

- The container publishes port **4390 on 127.0.0.1 only**. Put a reverse proxy or Tailscale in front (Step 3), or change the `ports:` line in `compose.yaml` if the proxy is on another machine.
- Data lives in the `wos-data` volume and backups in `wos-backups`. `restart: unless-stopped` brings it back after reboots.

### Step 2B. Run with plain Node

```bash
corepack enable                      # provides the pinned pnpm version
pnpm install --frozen-lockfile
pnpm build                           # builds the web app and the server bundle
node --env-file=.env apps/server/dist/index.js
```

It listens on `http://127.0.0.1:4390`. The setup code is printed in the terminal; print a new one any time with:

```bash
node --env-file=.env apps/server/dist/cli.js setup-code
```

Keep it running after you close the terminal:

<details>
<summary>Linux (systemd)</summary>

Create `/etc/systemd/system/workspace-os.service` (adjust `User` and paths):

```ini
[Unit]
Description=Workspace OS
After=network-online.target

[Service]
User=workspace
WorkingDirectory=/opt/workspace-os
ExecStart=/usr/bin/node --env-file=.env apps/server/dist/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now workspace-os
journalctl -u workspace-os -f
```
</details>

<details>
<summary>Windows (scheduled task at logon)</summary>

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-startup.ps1     # register
powershell -ExecutionPolicy Bypass -File scripts/restart-server.ps1      # after rebuilds or .env edits
powershell -ExecutionPolicy Bypass -File scripts/install-startup.ps1 -Remove
```

The task runs `scripts/run-server.ps1` hidden, restarts it on failure and logs to `data/server.log`. See `docs/DEPLOY_WINDOWS_TAILSCALE.md`.
</details>

### Step 3. Make it reachable (pick one)

**Tailscale (private, easiest for a phone).** Install Tailscale on the server and your devices, enable HTTPS and Serve once in the Tailscale admin console, then:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:4390
```

Open `https://<machine>.<tailnet>.ts.net`. Set `PUBLIC_BASE_URL` to that address and restart. HTTPS is required for installing the app on a phone, offline mode and push notifications.

**Your own domain behind a reverse proxy (Caddy, Nginx, Nginx Proxy Manager, Traefik).** Point the proxy at the app and set `PUBLIC_BASE_URL=https://your.domain`.

Caddy:

```caddyfile
todo.example.com {
    reverse_proxy 127.0.0.1:4390
}
```

Nginx (inside your TLS `server` block):

```nginx
location / {
    proxy_pass http://127.0.0.1:4390;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;             # live updates use a streaming connection
    proxy_read_timeout 3600s;
}
```

Nginx Proxy Manager: scheme `http`, forward host/IP and port 4390, **Cache Assets off**, **Websockets on**, request a Let's Encrypt certificate and force SSL, and paste the `proxy_buffering off;` lines above into the Advanced tab.

Notes:
- The app trusts forwarding headers only from loopback and private-LAN proxies (and Tailscale Serve). A proxy on another private-LAN machine works. A proxy that reaches the app over a Tailscale address should forward to a Tailscale TCP forward: `tailscale serve --bg --tcp=4390 tcp://127.0.0.1:4390`.
- If the sign-in page says **Cross-origin request blocked**, the address in your browser does not match `PUBLIC_BASE_URL` / `TRUSTED_ORIGINS` (check `https` vs `http`). Fix `.env`, then restart (the process only reads `.env` at start).
- Putting it on the public internet is your call. It has its own login (Argon2id), CSRF protection and rate limits, but consider Cloudflare or an IP allow-list in front.

### Step 4. Create the owner account

Open your address in a browser. The first screen asks for the **setup code** (from Step 2) and lets you choose a username and password. This only works until an owner exists. After that you sign in normally. Sign-ups are closed.

On a phone: open the address in Safari (iOS) or Chrome (Android) and use **Add to Home Screen**.

### Step 5. Connect calendars (optional)

Calendars are optional and read-only. You need your own OAuth app because the app has no shared credentials.

**Google**
1. In Google Cloud Console create a project, enable the **Google Calendar API**, configure the OAuth consent screen (add yourself as a test user), then create an **OAuth client ID** of type *Web application*.
2. Under **Authorised redirect URIs** (not JavaScript origins) add `<PUBLIC_BASE_URL or http://localhost:4390>/api/v1/calendar/oauth/google/callback`.
3. Under **Data Access / Scopes** add the read-only Calendar scopes.
4. Put the id and secret in `.env`:
   ```ini
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=<exactly the redirect URI from step 2>
   ```
5. Restart, then **Settings → Calendar accounts → Connect Google**. Google may only allow `localhost` or `https://` redirect addresses, so connect from the server itself or over your HTTPS address.

**Microsoft (Outlook / 365):** register an app in Microsoft Entra, add a Web redirect URI ending in `/api/v1/calendar/oauth/microsoft/callback`, grant delegated `Calendars.Read`, and set `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT`, `MS_REDIRECT_URI`. Details: `docs/PROVIDER_NOTES.md` and `docs/CALENDAR_SYNC.md`.

### Step 6. Backups

Backups are made automatically (daily, weekly and monthly retention are configurable in `.env`). Manual commands:

```bash
node --env-file=.env apps/server/dist/cli.js backup
node --env-file=.env apps/server/dist/cli.js list-backups
node --env-file=.env apps/server/dist/cli.js verify <file>
node --env-file=.env apps/server/dist/cli.js restore <file> --yes   # stop the server first
# Docker: docker compose exec app node dist/cli.js backup
```

Copy the backup folder (and keep `.env`, especially `DATA_ENCRYPTION_KEY`) somewhere safe. Without that key the stored calendar tokens cannot be decrypted. Details: `docs/BACKUP_RESTORE.md`.

### Updating

```bash
git pull
# Docker:
docker compose up -d --build
# Plain Node:
pnpm install --frozen-lockfile && pnpm build   # then restart the service
```

Database migrations run automatically on start, and a safety copy of the database is written first if a migration is pending.

### Checking that it works

```bash
node scripts/doctor.mjs                          # tools, ports and config sanity check
curl http://127.0.0.1:4390/api/health/ready      # {"status":"ready","db":true,"migrations":true,"scheduler":true}
```

Common problems are in `docs/TROUBLESHOOTING.md`. Two worth knowing:
- Calendars connect but no events appear: the background scheduler is off (`DISABLE_SCHEDULER` set in your environment). Remove it and restart.
- The app used the wrong data folder: the paths in `.env` (`DATABASE_PATH`, `BACKUP_DIR`, `APP_PORT`) differ between Docker and plain Node. Use `node scripts/gen-env.mjs --native` for plain Node.

---

## Everyday commands (development)

| Task | Command |
| --- | --- |
| Dev servers (API + web) | `pnpm dev` |
| Lint + typecheck | `pnpm check` |
| Unit + API tests | `pnpm test` |
| Browser tests | `pnpm test:e2e` |
| Smoke test (throwaway instance) | `pnpm smoke` |
| Backup / restore (Windows) | `scripts/backup.ps1`, `scripts/restore.ps1 <file>` |

Tests use throwaway databases; they never touch your real data.

## Docs

`docs/BUILD_STATUS.md` (what works, what is blocked), `docs/OWNER_ACTIONS.md` (what only you can do), and PRODUCT, ARCHITECTURE, DATA_MODEL, API, CALENDAR_SYNC, DEPLOY_WINDOWS_TAILSCALE, PWA_MOBILE, SECURITY, TESTING, BACKUP_RESTORE, PROVIDER_NOTES, TROUBLESHOOTING, RELEASE_CHECKLIST, DECISIONS. The live API reference is `/api/v1/openapi.json` (when signed in).
