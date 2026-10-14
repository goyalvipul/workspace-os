# Release checklist

- [ ] `pnpm check` clean
- [ ] `pnpm test` all green
- [ ] `pnpm build`, then `pnpm smoke`
- [ ] `pnpm test:e2e` all green (desktop + mobile)
- [ ] `docker compose up -d --build` healthy; `docker compose exec app node dist/cli.js verify <latest backup>`
- [ ] Take a manual backup before upgrading a live instance
- [ ] `docs/BUILD_STATUS.md` updated with real results and commit hash
- [ ] `.env.example` matches every variable read in `apps/server/src/config`
- [ ] No secrets in git (`git log -p -S SESSION_SECRET` shows only `.env.example` placeholders)
- [ ] On the phone: install PWA, add a task offline, reconnect, confirm it syncs
- [ ] Tag the release
