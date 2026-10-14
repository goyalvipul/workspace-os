# Security

- **Exposure**: container port bound to `127.0.0.1`; remote access only via Tailscale Serve (tailnet-only HTTPS). No public ingress.
- **Owner bootstrap**: setup screen needs a one-time code printed to the server console/CLI; works only while no owner exists.
- **Passwords**: Argon2id; minimum length enforced; login rate-limited with throttling; generic error messages.
- **Sessions**: opaque random token in HttpOnly SameSite=Lax cookie `wos_session`, only its hash is stored; revoke one/all; password change signs out other devices.
- **CSRF**: HMAC token in `x-csrf-token` on every mutating request plus Origin allow-list (`PUBLIC_BASE_URL`, `TRUSTED_ORIGINS`).
- **Headers**: Helmet with a strict CSP (no inline scripts), `X-Content-Type-Options`, `Referrer-Policy`, frame denial. Asserted in tests.
- **Secrets at rest**: provider tokens AES-256-GCM encrypted with `DATA_ENCRYPTION_KEY` (rotation via `_PREVIOUS`). Logs redact cookies, authorization headers, tokens and passwords.
- **Input**: zod validation on every route; filters are a JSON AST, never SQL; CSV export neutralises formula injection; CSV import is previewed before applying.
- **Backups**: contain all data; keep them private. Downloading one requires password re-entry.
- **Calendar**: read-only scopes; private events masked before storage.
- **Never**: commit `.env`; enable Funnel; run the container as root (it runs as `node`, read-only fs, no capabilities).

Rotating `SESSION_SECRET` signs everyone out. Rotating `DATA_ENCRYPTION_KEY`: set the old value in `DATA_ENCRYPTION_KEY_PREVIOUS`, put a new key in `DATA_ENCRYPTION_KEY`, bump `DATA_ENCRYPTION_KEY_VERSION`, restart.
