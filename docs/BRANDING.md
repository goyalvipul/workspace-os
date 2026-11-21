# Workspace OS branding assets

The current icon is the approved ivory-background, orange-to-coral rounded checkbox with a dark checkmark and orange leaf. The name **Workspace OS** is unchanged.

## Source and generated files

- `apps/web/public/icons/workspace.svg`: vector branding mark (sidebar and scalable favicon).
- `apps/web/public/icons/workspace-favicon-16.png` and `workspace-favicon-32.png`: browser tabs.
- `apps/web/public/icons/workspace-apple-touch.png`: 180px iPhone Home Screen icon.
- `apps/web/public/icons/workspace-192.png`, `workspace-512.png`: installed PWA.
- `apps/web/public/icons/workspace-maskable-512.png`: safe-zone Android icon.

Legacy `icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, and `apple-touch-icon.png` are also regenerated so existing icon paths remain functional.

All PNGs are checked into GitHub. Their source is `scripts/gen-icons.mjs`, which is run automatically before the web development server and before every production web build. There are no new npm dependencies.

The `workspace-*` filenames intentionally differ from the previous icon URLs to bypass aggressive favicon/PWA icon caches, while avoiding offline-cache query-parameter mismatches.

## Redeploy on the existing server

```bash
cd /home/vipul/workspace/workspace-os
git fetch origin
git switch feat/nori-inspired-ux-phase2-3
git pull --ff-only origin feat/nori-inspired-ux-phase2-3
docker compose up -d --build --force-recreate
```

After rebuilding, check `https://todo.goyalfamily.ca/icons/workspace.svg` and `https://todo.goyalfamily.ca/icons/workspace-apple-touch.png`.

Favicon appearance may require closing and reopening the browser. The icon already installed on an iPhone Home Screen can remain cached by iOS even after the website updates; **remove and re-add only the Home Screen shortcut** if needed (not the account, data, or server). Ensure queued offline task changes have synchronized before removing an installed PWA.
