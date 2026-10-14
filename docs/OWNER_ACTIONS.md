# Owner actions (only you can do these)
Last updated: 2026-10-14

| # | Step | Why a human must do it | Where | Config key / command | Validation | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Enable WSL2 for Docker Desktop | Needs admin rights and a reboot | Admin PowerShell | `wsl --install --no-distribution` then reboot, start Docker Desktop | `docker info` shows a Linux server | BLOCKED_EXTERNAL |
| 2 | Enable Tailscale HTTPS + MagicDNS | Tailnet admin setting | https://login.tailscale.com/admin/dns | enable MagicDNS + HTTPS Certificates | `tailscale serve status` shows an https URL | NOT_DONE |
| 3 | Run Tailscale Serve | Changes host network config; I will not do it without your approval | PowerShell | `tailscale serve --bg 4390` (verify with `tailscale serve --help`) | open the https URL on phone | NOT_DONE |
| 4 | Google OAuth app (optional) | Needs your Google account/consent | Google Cloud Console | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Settings > Connected accounts | NOT_DONE |
| 5 | Microsoft Entra app (optional) | Needs your Microsoft account/consent | Entra admin center | `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | Settings > Connected accounts | NOT_DONE |
| 6 | Back up `.env` (encryption key) privately | Losing `DATA_ENCRYPTION_KEY` makes stored provider tokens unreadable | your password manager | `DATA_ENCRYPTION_KEY` | restore drill | NOT_DONE |
| 7 | Install on iPhone | Physical device | Safari > Share > Add to Home Screen | n/a | launches standalone | NOT_DONE |
