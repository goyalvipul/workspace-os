# Migrate Workspace OS from Windows to Ubuntu (with all your data)

This guide moves a running Workspace OS from the Windows PC (plain Node + a scheduled task) to an Ubuntu machine, **keeping every task, project, label, setting, calendar connection, push subscription, login session and Siri/Shortcuts token**. It is written for Ubuntu 22.04 or 24.04.

Plan in one line: **stop the Windows server → take one verified backup → copy the backup and your `.env` secrets → install the app on Ubuntu → restore the backup → start it → point your address at the new machine → retire the old one.**

Estimated time: 45 to 60 minutes, plus a few minutes of downtime at cutover.

---

## 0. What moves and what does not

| Item | Moves? | How |
| --- | --- | --- |
| Database (tasks, projects, labels, filters, templates, preferences, activity, notifications, sessions, API tokens, calendar cache) | **Yes** | One verified backup file (`*.sqlite.gz`), restored on Ubuntu |
| **`.env` secrets** (`SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, `VAPID_*`, Google/Microsoft client credentials) | **Yes, must keep the same values** | Copied securely, then edited for Linux paths (section 3) |
| Old backups in `backups/` | Optional | Copy the folder if you want history |
| Source code | No | Cloned fresh from GitHub on Ubuntu |
| `node_modules`, `apps/*/dist`, `data/server.log` | No | Rebuilt on Ubuntu |
| Windows scheduled task, `scripts/*.ps1` | No | Replaced by a systemd service |

### Why the `.env` secrets matter

The database stores calendar OAuth tokens and web-push subscriptions **encrypted with `DATA_ENCRYPTION_KEY`**, and login sessions and CSRF tokens depend on `SESSION_SECRET`.

- **Keep the same keys:** calendars keep syncing, push keeps working, you stay signed in, and your Siri/Shortcuts tokens keep working.
- **Generate new keys by mistake** (for example by running `node scripts/gen-env.mjs` on Ubuntu): the data still opens, but connected calendars and push devices can no longer be decrypted and have to be reconnected, and everyone is signed out. **Do not run `gen-env.mjs` on the new machine.**

> `.env` is a secret. Never commit it, paste it into a chat or email it. Copy it only with `scp` or a USB drive, as shown below.

---

## 1. Before you start: checklist

- [ ] The latest code is pushed to GitHub (on the Windows PC: `git status`, then `git push`). Ubuntu will clone from GitHub, so anything unpushed would be missing. (No GitHub access from the Ubuntu box? See the *bundle* fallback in 4.2.)
- [ ] You can SSH into the Ubuntu machine, and it has a user with `sudo`.
- [ ] You know which address you will use afterwards (see section 6). **Easiest: keep the same public address** (`https://todo.goyalfamily.ca`) so phones, the installed app and calendar redirect URIs need no changes.
- [ ] Ubuntu has at least 1 GB free disk and 512 MB free RAM. The app is small.
- [ ] You have 30 minutes when nobody (including your phone) needs to add tasks.

Optional but recommended: do a **rehearsal** first. Do sections 2 to 5 using a backup taken while the Windows server is still running, test on Ubuntu with `http://<ubuntu-ip>:4390` (temporarily `APP_HOST=0.0.0.0`), then repeat with a fresh backup at the real cutover. Anything you add on Windows after the rehearsal backup would be lost, so always take a **new** backup after stopping Windows (section 2).

---

## 2. On Windows: stop the server and take the final backup

Open PowerShell in the project folder (`C:\Users\vipulgoyal\workspace\todo`).

### 2.1 Stop the app and its watchdog

The scheduled task restarts the server every 5 minutes if it is down, so **disable** it, then stop the running process:

```powershell
Disable-ScheduledTask -TaskName "WorkspaceOS Server"
Stop-ScheduledTask   -TaskName "WorkspaceOS Server" -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "name='node.exe'" |
  Where-Object { $_.CommandLine -like '*apps\server\dist\index.js*' -or $_.CommandLine -like '*apps/server/dist/index.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

Check that nothing answers any more (this should fail with a connection error):

```powershell
Invoke-WebRequest http://127.0.0.1:4390/api/health/live -UseBasicParsing
```

From this moment the app is **down**; this is your maintenance window.

### 2.2 Create one verified backup

The backup tool takes a consistent copy of the database (it handles the write-ahead log correctly), checks integrity and writes a checksum. **Do not copy `data\workspace.sqlite` by hand.**

```powershell
node --env-file=.env apps/server/dist/cli.js backup
```

It prints `Backup ok: <full path> (<size> bytes, sha256 ...)`. Note the file name, then verify that exact file:

```powershell
node --env-file=.env apps/server/dist/cli.js list-backups
node --env-file=.env apps/server/dist/cli.js verify backups\<the-file-name>.sqlite.gz
```

You should see `OK: archive is intact (schema version N, manifest checksum matches).`

Tip: before step 2.1, note roughly how many open tasks and projects you have in the UI, so you can compare after the move.

### 2.3 Collect the files to move

You need exactly these:

1. `backups\<the-file-name>.sqlite.gz` and its `<the-file-name>.manifest.json` (same folder)
2. `.env`

Optional: the rest of `backups\` if you want history.

### 2.4 Copy them to Ubuntu

Windows 10/11 include an OpenSSH client. Replace `ubuntu-user` and `UBUNTU_IP` (a LAN IP or the Tailscale name):

```powershell
ssh ubuntu-user@UBUNTU_IP "mkdir -p ~/migrate"
scp backups\<the-file-name>.sqlite.gz backups\<the-file-name>.manifest.json .env ubuntu-user@UBUNTU_IP:~/migrate/
```

(`.env` is a dotfile; if your `scp` skips it, copy it as `scp .env ubuntu-user@UBUNTU_IP:~/migrate/env.txt` and rename it on Ubuntu.)

No SSH? Use a USB stick or an encrypted share. Anything works, as long as `.env` is not sent over an unprotected channel.

---

## 3. On Ubuntu: install the prerequisites

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential python3
```

`build-essential` and `python3` are only used if the SQLite driver has to be compiled; usually a prebuilt binary is downloaded and they are not needed, but installing them avoids a confusing failure.

Install Node.js 22 (the app requires Node 22 or newer):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version          # must print v22.x or higher
sudo corepack enable    # provides the exact pnpm version the project pins
```

Create a dedicated, unprivileged user and the install folder:

```bash
sudo adduser --system --group --home /opt/workspace-os workspace
sudo mkdir -p /opt/workspace-os
sudo chown workspace:workspace /opt/workspace-os
```

---

## 4. On Ubuntu: get the code and build it

### 4.1 Clone and build

Do this as your normal sudo user; ownership is handed to the `workspace` user in 5.4.

```bash
sudo mkdir -p /opt/workspace-os && sudo chown "$USER": /opt/workspace-os
cd /opt/workspace-os
git clone https://github.com/goyalvipul/workspace-os.git app
cd app
git log --oneline -3          # confirm the newest commit (Siri / Apple Watch / swipe) is there
pnpm install --frozen-lockfile
pnpm build                    # builds the web app and the server bundle
```

When it finishes without errors, `apps/server/dist/index.js` and `apps/web/dist/` exist.

### 4.2 Fallback: no GitHub access from Ubuntu (git bundle)

On the Windows PC (project folder):

```powershell
git bundle create workspace-os.bundle --all
scp workspace-os.bundle ubuntu-user@UBUNTU_IP:~/migrate/
```

On Ubuntu:

```bash
git clone ~/migrate/workspace-os.bundle /opt/workspace-os/app
cd /opt/workspace-os/app && git checkout main
```

Then continue with `pnpm install --frozen-lockfile` and `pnpm build` as above.

---

## 5. On Ubuntu: configure `.env`, restore the data, start the app

All commands below run in `/opt/workspace-os/app`.

### 5.1 Install your `.env` (the same secrets) and fix Windows-only values

```bash
cd /opt/workspace-os/app
cp ~/migrate/.env .env          # or: cp ~/migrate/env.txt .env
chmod 600 .env
mkdir -p data backups
```

Open it in an editor (`nano .env`) and review **only these lines**; leave every secret exactly as it is:

| Key | Set it to | Why |
| --- | --- | --- |
| `NODE_ENV` | `production` | |
| `APP_HOST` | `127.0.0.1` | Listen on loopback only. Your proxy or Tailscale reaches it (section 6). |
| `APP_PORT` | `4390` | Same port as on Windows |
| `DATABASE_PATH` | `/opt/workspace-os/app/data/workspace.sqlite` | Use an absolute Linux path (not `./data`, and no backslashes) |
| `BACKUP_DIR` | `/opt/workspace-os/app/backups` | Same |
| `PUBLIC_BASE_URL` | The address you will use, e.g. `https://todo.goyalfamily.ca` | Used for login origin checks, cookies and OAuth. Must match what you type in the browser. |
| `TRUSTED_ORIGINS` | Any extra address(es), comma separated | E.g. a Tailscale name. If you are unsure, copy what was on Windows. |
| `GOOGLE_REDIRECT_URI`, `MS_REDIRECT_URI` | Same host as `PUBLIC_BASE_URL` + the existing path | Only if you use calendars. Must also match what is registered with Google/Microsoft. |

**Do not change** `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, `DATA_ENCRYPTION_KEY_VERSION`, `DATA_ENCRYPTION_KEY_PREVIOUS`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT_EMAIL`, `GOOGLE_CLIENT_*`, `MS_CLIENT_*`.

Sanity check that the secrets are present without printing them (the answer must be `3`):

```bash
grep -cE '^(SESSION_SECRET|DATA_ENCRYPTION_KEY|VAPID_PRIVATE_KEY)=.{10,}' .env
```

### 5.2 Restore the backup

The app must **not** be running yet. Put the backup where the app expects it, verify it, then restore:

```bash
cp ~/migrate/*.sqlite.gz ~/migrate/*.manifest.json backups/
node --env-file=.env apps/server/dist/cli.js verify backups/<the-file-name>.sqlite.gz
node --env-file=.env apps/server/dist/cli.js restore backups/<the-file-name>.sqlite.gz --yes
```

Expected: `Restored (schema version N). Rollback copy: none (database was empty). Start the app again.`

- A damaged or tampered archive is rejected before anything is written.
- If it says the backup is **newer than this application understands**, the Ubuntu checkout is older than the Windows one. `git pull`, `pnpm install --frozen-lockfile`, `pnpm build`, and retry.
- Newer app versions migrate the database automatically on first start; you do not run migrations by hand.

### 5.3 Test-run in the foreground

```bash
node --env-file=.env apps/server/dist/index.js
```

The server should start without errors (startup applies any pending migrations). In a second terminal:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4390/api/health/live
```

It should print `200`. Stop the foreground run with `Ctrl+C`.

### 5.4 Run it as a service (starts at boot, restarts on failure)

Make sure the `workspace` user owns everything, then create the unit:

```bash
sudo chown -R workspace:workspace /opt/workspace-os
sudo chmod 600 /opt/workspace-os/app/.env
sudo tee /etc/systemd/system/workspace-os.service >/dev/null <<'EOF'
[Unit]
Description=Workspace OS
After=network-online.target
Wants=network-online.target

[Service]
User=workspace
Group=workspace
WorkingDirectory=/opt/workspace-os/app
ExecStart=/usr/bin/node --env-file=.env apps/server/dist/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/opt/workspace-os/app/data /opt/workspace-os/app/backups

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now workspace-os
systemctl status workspace-os --no-pager
journalctl -u workspace-os -f        # Ctrl+C to leave
```

If `which node` prints a different path than `/usr/bin/node`, use that path in `ExecStart`.

After any later `.env` change: `sudo systemctl restart workspace-os` (the process only reads `.env` at start).

---

## 6. Make it reachable (switch your address to the new machine)

Pick the option that matches how you reach the app today.

### 6.1 Public address through Cloudflare + Nginx Proxy Manager (what you use now)

On Windows the proxy forwarded to the Windows machine's Tailscale address (`http://<windows-tailscale-ip>:4390`). On Ubuntu, repeat the same pattern:

1. Install Tailscale on Ubuntu and sign in to the same tailnet:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   tailscale ip -4            # note this 100.x.y.z address
   ```
2. Forward the tailnet port to the loopback-only app (this keeps `APP_HOST=127.0.0.1`, and the app trusts the forwarded headers):
   ```bash
   sudo tailscale serve --bg --tcp=4390 tcp://127.0.0.1:4390
   ```
3. In **Nginx Proxy Manager**, edit the existing proxy host for `todo.goyalfamily.ca` and change only the **Forward Hostname / IP** to the new Ubuntu Tailscale IP (port stays `4390`, scheme `http`). Leave **Cache Assets off**, **Websockets on**, SSL as is.
4. Nothing changes in Cloudflare or in `PUBLIC_BASE_URL`, so the installed phone app, sessions and the iOS home-screen icon keep working.
5. Check from outside (4G on your phone, or any other network): `https://todo.goyalfamily.ca`. Purge the Cloudflare cache for `/`, `/sw.js` and `/manifest.webmanifest` if you see an old version.

### 6.2 Private HTTPS with Tailscale Serve

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:4390
sudo tailscale serve status
```

Your address is now `https://<ubuntu-machine>.<tailnet>.ts.net`. **This is a different name from your Windows machine**, so put it in `TRUSTED_ORIGINS` (or `PUBLIC_BASE_URL` if it is the only one), restart the service, and re-install the home-screen app from the new address (an installed app is tied to its address). To reuse the old name, remove the Windows machine from your tailnet first and rename the Ubuntu one to the same hostname in the Tailscale admin console.

### 6.3 Reverse proxy running on the Ubuntu machine itself (Caddy)

```bash
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
todo.example.com {
    reverse_proxy 127.0.0.1:4390
}
EOF
sudo systemctl reload caddy
```

Caddy fetches the certificate by itself (ports 80 and 443 must reach the machine, and the DNS record must point at it). Set `PUBLIC_BASE_URL=https://todo.example.com`.

### 6.4 Firewall

If you use `ufw`, you do **not** need to open port 4390; the app is on loopback and everything arrives through Tailscale or Caddy.

```bash
sudo ufw allow OpenSSH
sudo ufw enable        # only if you want ufw on; keep SSH allowed first
```

---

## 7. Verify the migration

Work through this list on the new machine:

- [ ] `systemctl status workspace-os` shows **active (running)**, and `journalctl -u workspace-os -n 50` shows no errors.
- [ ] Open your address in a browser: you land on the **sign-in page (or already signed in)**. If you see **"Welcome - Create the owner account"** with a *Setup code* field, the restore did not take effect; stop the service and redo 5.2.
- [ ] Sign in with your **existing username and password**.
- [ ] Today, Inbox, Upcoming and Projects show your data. Roughly the same number of open tasks and projects as you noted on Windows.
- [ ] **Settings → Account / General / Productivity** show your saved preferences.
- [ ] **Settings → Connected accounts:** calendars show **Connected** (not "Reconnect required"), and **Settings → Sync diagnostics** looks healthy after a minute or two (if one needs reconnecting, see section 9).
- [ ] **Settings → Notifications → Send test** reaches your phone.
- [ ] **Settings → Siri & Apple Watch:** your tokens are listed. Run "Hey Siri, Add task" once. It works with **no changes** if the address is unchanged.
- [ ] **Settings → Backups → Create backup** succeeds.
- [ ] Add a task on your phone, then check it on the desktop: live updates work through the proxy (if not, review **Websockets on** and `proxy_buffering off` in NPM).

---

## 8. Retire the Windows machine safely

Do this **only after** section 7 passes, and not before.

1. **Never run both servers at the same time.** Two copies would drift apart, and both would sync your calendars. Keep the Windows task disabled (done in 2.1).
2. Keep the Windows `data\` and `backups\` folders untouched for about 2 weeks as your rollback.
3. When you are sure, remove the startup task on Windows:
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-startup.ps1 -Remove
   ```
4. Remove the old machine from Tailscale (admin console → Machines) and, if the NPM entry used its address, make sure it points at the new one.
5. After the keep period, securely delete the Windows `.env`, `data\` and `backups\` (they hold your secrets and data).

### Rolling back

If something is wrong and you need the old setup back quickly:

1. Stop the Ubuntu service: `sudo systemctl stop workspace-os`.
2. On Windows: `Enable-ScheduledTask -TaskName "WorkspaceOS Server"; Start-ScheduledTask -TaskName "WorkspaceOS Server"`.
3. Point NPM back at the Windows Tailscale IP.

Anything you added on Ubuntu in the meantime is not on Windows. Export it first from the Ubuntu app (**Settings → Import & export → Export**) if it matters.

---

## 9. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `pnpm install` fails compiling `better-sqlite3` | Install the build tools: `sudo apt install -y build-essential python3`, check `node --version` is 22+, then `pnpm install --frozen-lockfile` again. |
| `pnpm: command not found` | Run `sudo corepack enable`. The project pins pnpm; corepack downloads the right one. |
| Sign-in says **Cross-origin request blocked** | The address in the browser is not in `PUBLIC_BASE_URL` / `TRUSTED_ORIGINS` (check `https` vs `http`). Fix `.env`, then `sudo systemctl restart workspace-os`. |
| **502 Bad Gateway** from NPM/Cloudflare | The service is down or NPM points at the old IP. `systemctl status workspace-os`, `sudo tailscale serve status`, and check the Forward IP/port in NPM. |
| Page shows the first-run **setup** screen | The database was not restored (empty DB). Stop the service, redo 5.2, check `DATABASE_PATH` is the same file the service uses. |
| Everyone is signed out, calendars ask to reconnect, push stopped | `SESSION_SECRET` or `DATA_ENCRYPTION_KEY` differs from the Windows `.env`. Copy the original `.env` back and restart. (If the original is lost, reconnect calendars and re-enable push; tasks are unaffected.) |
| `EACCES` / `SQLITE_CANTOPEN` in the log | The `workspace` user cannot write `data/`. `sudo chown -R workspace:workspace /opt/workspace-os && sudo systemctl restart workspace-os`. |
| `Address already in use` | Something else uses port 4390. `sudo ss -ltnp | grep 4390`. Stop that process or change `APP_PORT` and the proxy. |
| Restore says backup is **newer than this application understands** | The Ubuntu code is older. `git pull && pnpm install --frozen-lockfile && pnpm build`, retry. |
| Reminders fire at the wrong hour | Your own time zone is stored in the app (Settings → Date & time), not taken from the server, so it should be right. The server clock must be correct: `timedatectl` should say `System clock synchronized: yes`. |
| Calendar says it needs reauthorisation after the move | Only if the **public address changed**. Update the redirect URIs in Google Cloud / Azure to the new `PUBLIC_BASE_URL`, set the same in `.env`, restart, reconnect. |
| Old version still shows on phone | Cloudflare or the service worker cache. Purge Cloudflare, then close and reopen the installed app (accept the "update available" prompt). |

---

## 10. After the move: backups and updates on Ubuntu

### Backups

The app already takes a verified backup about once a day into `/opt/workspace-os/app/backups` (keeps 7 daily, 4 weekly, 3 monthly). A backup on the same disk does not protect you from disk loss, so copy them elsewhere, for example a nightly rsync to another machine:

```bash
sudo -u workspace crontab -e
# add (adjust the destination):
30 3 * * * rsync -a --delete /opt/workspace-os/app/backups/ backupuser@other-host:/srv/backups/workspace-os/
```

Make a manual backup any time:

```bash
cd /opt/workspace-os/app && sudo -u workspace node --env-file=.env apps/server/dist/cli.js backup
```

Restore later: stop the service, `cli.js restore <file> --yes`, start the service (see `docs/BACKUP_RESTORE.md`). **Keep a copy of `.env` with your backups** (in a password manager or encrypted storage). A backup without its `DATA_ENCRYPTION_KEY` cannot decrypt calendar tokens and push subscriptions.

### Updating the app

```bash
cd /opt/workspace-os/app
sudo -u workspace git pull
sudo -u workspace corepack pnpm install --frozen-lockfile
sudo -u workspace corepack pnpm build
sudo systemctl restart workspace-os
```

Take a backup first if the update changes the database (new migrations apply automatically on start).

### Day-to-day commands

| Task | Command |
| --- | --- |
| Status | `systemctl status workspace-os` |
| Live log | `journalctl -u workspace-os -f` |
| Restart (after `.env` edit) | `sudo systemctl restart workspace-os` |
| Health | `curl -s http://127.0.0.1:4390/api/health/live` |
| New setup code (only if no owner exists) | `node --env-file=.env apps/server/dist/cli.js setup-code` |

---

## Appendix: moving to Docker instead of plain Node

If you prefer Docker on Ubuntu (instead of sections 3 to 5), the data move is the same: do section 2 on Windows, then on Ubuntu install Docker Engine with the Compose plugin, clone the repo (4.1, without `pnpm install`), and copy your `.env` into the repo folder. You do **not** need to change the paths or port in `.env`: `compose.yaml` forces the container-internal values (`APP_HOST=0.0.0.0`, `APP_PORT=3000`, `DATABASE_PATH=/data/workspace.sqlite`, `BACKUP_DIR=/backups`). Keep every secret, and set `PUBLIC_BASE_URL` / `TRUSTED_ORIGINS` as in 5.1. Then, from the repo folder (with the backup files in `~/migrate`):

```bash
docker compose build
docker compose run --rm --no-deps -v "$HOME/migrate:/in:ro" app node dist/cli.js verify /in/<the-file-name>.sqlite.gz
docker compose run --rm --no-deps -v "$HOME/migrate:/in:ro" app node dist/cli.js restore /in/<the-file-name>.sqlite.gz --yes
docker compose up -d
docker compose logs -f app
```

The data lives in the Docker volumes `wos-data` and `wos-backups`. The container publishes port 4390 on `127.0.0.1` only, so continue with section 6 for the network side. Updates: `git pull && docker compose build && docker compose up -d`. Day-to-day CLI: `docker compose exec app node dist/cli.js backup`.
