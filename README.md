# Workspace OS

A self-hosted, single-owner task manager (Todoist-style) with a unified, read-only calendar (Google and Outlook). Lists, boards, recurring tasks, reminders, labels, filters and quick-add with natural language. It is an installable PWA that works offline, and it runs as a single small process with a SQLite file for data.

- **Stack:** pnpm monorepo. `packages/shared` (schemas, dates, recurrence), `apps/server` (Fastify, Drizzle, SQLite), `apps/web` (React, Vite, Tailwind, Dexie).
- **It is a PWA (Progressive Web App):** there is nothing to download from an app store. Open it in a browser over HTTPS and install it to your phone's home screen or your desktop; it then runs full-screen like a native app, caches itself for offline use, queues changes made offline, and can show reminder notifications. See [Install it as an app](#step-4b-install-it-as-an-app-pwa).
- **Your data stays with you:** one SQLite file plus backups. Calendar providers are read-only; nothing is ever written back to Google or Microsoft.

### Highlights

- **Hey Siri, add task.** Add tasks by voice on iPhone, iPad, Mac and **Apple Watch** with Apple Shortcuts. What you say goes through the same smart parser as Quick Add ("Call mom tomorrow 5pm p2 #Family"). See [Siri and Apple Watch](#siri-and-apple-watch).
- **Swipe gestures.** Swipe a task **right to delete** and **left to archive**, both with Undo. Pick different actions (complete, move to tomorrow, none) in Settings → General. See [Swipe gestures and Archive](#swipe-gestures-and-archive).
- **Productivity.** Daily and weekly goals, goal streaks, karma levels, days off, vacation mode and goal celebrations.
- **Smarter reminders.** Automatic reminders on new tasks, snooze with your own duration, choose push / in-app / both, plus an optional morning overview and evening review.
- **Make it yours.** Home view, "detect dates in task names" on/off, what "next week" and "weekend" mean, reset sub-tasks when a repeating task completes, and a task-complete sound. See [Settings reference](#settings-reference).

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

### Step 4b. Install it as an app (PWA)

Workspace OS is a PWA, so installing it is just a browser action. **It must be opened over HTTPS** (Tailscale Serve or your domain from Step 3, or `localhost`). Plain `http://` addresses cannot be installed, work offline or receive notifications.

**iPhone / iPad (use Safari, not Chrome or an in-app browser)**
1. Open your address (for example `https://todo.example.com`) in **Safari** and sign in.
2. Tap **Share** and then **Add to Home Screen**.
3. Make sure **"Open as Web App" is switched ON**, then tap **Add**. If that switch is off, the icon just opens a normal Safari tab with the address bar.
4. Open it from the new home-screen icon. It should be full-screen with no browser bars. You have to sign in once more inside it, because an installed app does not share Safari's login.
5. For notifications, open **Settings → Notifications** in the app and turn on push (iOS only delivers web push to apps installed this way, iOS 16.4 or newer).

If it still opens with browser bars: delete the icon and add it again from Safari, check the toggle in step 3, and make sure the address is the same HTTPS address you sign in with.

**Android (Chrome):** open the address, tap the menu (three dots), then **Install app** (or **Add to Home screen**).

**Desktop (Chrome or Edge):** click the install icon at the right end of the address bar, or menu → **Install Workspace OS**.

**Updating the installed app:** nothing to do. When a new version is deployed, the app shows an "update available" prompt; accept it to reload. If it ever looks stale, close the app completely and reopen it.

**Behind Cloudflare?** If your domain is proxied by Cloudflare, make sure these settings are in place or the app may load an old version, or the install may not behave:
- Add a **Cache Rule** that bypasses the cache for `/`, `/sw.js` and `/manifest.webmanifest`, and purge the cache after changing it.
- Turn off **Rocket Loader** and **Web Analytics auto-injection** for the hostname. (The app already opts out of Rocket Loader and sends `no-cache, no-transform` on these files, but the dashboard settings win.)
- In Nginx Proxy Manager keep **Cache Assets** off.

### Siri and Apple Watch

You can add tasks by voice, from an iPhone, iPad, Mac or **Apple Watch**, using the built-in Apple **Shortcuts** app. No extra app is needed. The shortcut sends your words to your own server, which understands them exactly like Quick Add: dates, times, repeats, `p1` to `p4`, `#Project` and `@label`.

> **Honest scope:** a web app cannot register native Siri intents or ship a native Apple Watch app (that needs Xcode and an Apple developer account). Shortcuts is Apple's supported way to do the same thing, and it works with "Hey Siri" and on the Watch.

**Set up (about 3 minutes)**
1. Open **Settings → Siri & Apple Watch** in Workspace OS and tap **Create token**. Copy the token; it is shown **once**. (It can only add tasks and read today's list. You can revoke it any time, and make one per device.)
2. On your iPhone open **Shortcuts**, tap **+**, and name it **Add task** (the name is what you say to Siri).
3. Add these actions in order:
   - **Dictate Text** (or **Ask for Input** if you prefer typing).
   - **Get Contents of URL**: URL `https://YOUR-ADDRESS/api/v1/capture`, Method `POST`, Header `Authorization` = `Bearer YOUR_TOKEN`, Request Body `JSON` with a **Text** field named `text` set to the **Dictated Text** variable.
   - **Get Dictionary Value** for key `message`, then **Speak Text**.
4. Say **"Hey Siri, Add task"** and then the task, for example "Pay the electricity bill tomorrow at 9am priority 1". Siri answers with what it added.

The same page in the app shows these steps with your exact address filled in, and a **Try it** box to test without a phone.

**Apple Watch**
- Shortcuts made on the iPhone appear on the Watch. In the shortcut's details (the **(i)** button) turn on **Show on Apple Watch**.
- Raise your wrist and say **"Hey Siri, Add task"**, or open **Shortcuts** on the Watch. You can also add the Shortcuts complication to a watch face, or map the shortcut to the **Action Button** on Apple Watch Ultra.
- The Watch calls your server directly over Wi-Fi or cellular, so use an address that works outside your home network (your public HTTPS name). A Tailscale-only address will not work from the Watch.

**Optional extras**
- **"What's on today?"** shortcut: **Get Contents of URL** with `https://YOUR-ADDRESS/api/v1/capture/today?format=text` (GET, same header), then **Speak Text**.
- **Open Quick Add pre-filled:** a shortcut that opens `https://YOUR-ADDRESS/?add=Buy%20milk%20tomorrow`. The installed app also has an **Add task** long-press shortcut on Android and desktop.
- Add `?format=text` to `/capture` to get a plain-text reply instead of JSON.

**Security.** Tokens are random, stored only as a hash, scoped to the two `capture` endpoints (they cannot read your tasks list, export data or create other tokens), rate limited, revocable, and never logged. Create and revoke events appear in Activity.

### Swipe gestures and Archive

On a touch screen, swipe a task row sideways:

| Gesture | Default | Notes |
| --- | --- | --- |
| Swipe **right** | **Delete** | Soft delete with an **Undo** toast |
| Swipe **left** | **Archive** | Hides the task from every view; **Undo** toast; find it under **Browse → Archived tasks** and restore it any time |

Change either gesture to **Complete**, **Move to tomorrow** or **Nothing** in **Settings → General → Swipe actions**. Vertical scrolling is not affected; the row only moves once the gesture is clearly horizontal. You can also archive from a task's **⋯** menu.

### Settings reference

Settings are saved to your account, so every device follows them.

| Section | What you can set |
| --- | --- |
| **Account** | Display name, email (username is fixed). Password and sessions are under **Security**. |
| **General** | Home view (Today, Inbox, Upcoming, Calendar, Browse); detect dates in task names; reset sub-tasks when a repeating task completes; what "next week" and "weekend" mean; task-complete sound; swipe actions; sync status and **Sync now**. |
| **Productivity** | Use Karma; daily goal; weekly goal; goal celebrations; days off; vacation mode. Progress is on **Activity → Goals & karma**. |
| **Reminders** | Remind me via (push, in-app, both); automatic reminders for tasks with a due time; snooze duration; default reminder time. |
| **Notifications** | Push on this device; **morning overview** and **evening review** at times you choose; recent notifications with a **Snooze** button on reminders. |
| **Siri & Apple Watch** | Access tokens and step-by-step Shortcuts setup (above). |
| **What's new / Help & feedback** | Recent changes, Quick Add cheat sheet, gestures and troubleshooting. |

How some of them behave:
- **Karma:** 1 point per completed task plus 10 for each day you reach your daily goal, over the last 90 days. Days off never break a streak, and vacation mode pauses goals, celebrations and digests.
- **Automatic reminders:** off by default. When on, a task you add with a due *time* gets a reminder at that offset (at the time, 10, 30 or 60 minutes before).
- **Snooze:** re-delivers the reminder after your chosen duration.
- **Not included:** things that only make sense for Todoist's hosted service or multiple users (subscription, shared-project invites, app icon choice) and two-factor sign-in / account deletion. Deleting your data is done by removing the SQLite file. Two-factor sign-in is not implemented yet; the login is protected by a strong-password rule, rate limiting and HTTPS-only cookies.

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

`docs/BUILD_STATUS.md` (what works, what is blocked), `docs/OWNER_ACTIONS.md` (what only you can do), and PRODUCT, ARCHITECTURE, DATA_MODEL, API, CALENDAR_SYNC, DEPLOY_WINDOWS_TAILSCALE, PWA_MOBILE, SECURITY, TESTING, BACKUP_RESTORE, `MIGRATE_WINDOWS_TO_UBUNTU` (move the app and its data to a Linux machine), PROVIDER_NOTES, TROUBLESHOOTING, RELEASE_CHECKLIST, DECISIONS. The live API reference is `/api/v1/openapi.json` (when signed in).
