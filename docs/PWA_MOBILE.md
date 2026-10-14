# PWA and mobile

- Manifest `manifest.webmanifest` (standalone, dark theme colour, 192/512 + maskable icons). Service worker `sw.js` precaches the app shell, falls back to `index.html` for navigations (never for `/api/`), handles push and notification clicks, and applies updates when you tap "Update" in the banner.
- **iPhone**: open the HTTPS Tailscale URL in Safari, Share, Add to Home Screen. Web push works only from the installed app on iOS 16.4+ and only over HTTPS.
- **Offline**: last snapshot is in IndexedDB; changes queue in an outbox (shown in the status indicator) and replay in order. If a task changed elsewhere, a conflict dialog lets you keep yours, keep theirs, or merge field-by-field.
- Layout: bottom tab bar and bottom-sheet editors on phones; sidebar and side panel at >= 768 px. Safe-area insets respected; tap targets >= 44 px; reduced-motion honoured.
- Verified in Playwright (Chromium, Pixel 7 emulation): quick add, search, offline queue/replay, manifest + service worker registration. Not verified on a physical iPhone.
