/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

// App shell only. API responses are never cached by the service worker; offline data lives in IndexedDB (Dexie).
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));
clientsClaim();

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') void self.skipWaiting();
});

interface PushPayload { title?: string; body?: string; url?: string; tag?: string }

self.addEventListener('push', (event) => {
  let p: PushPayload = {};
  try { p = event.data ? (event.data.json() as PushPayload) : {}; } catch { p = { body: event.data?.text() }; }
  event.waitUntil(
    self.registration.showNotification(p.title ?? 'Workspace OS', {
      body: p.body ?? '',
      tag: p.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: p.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data as { url?: string } | null)?.url ?? '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of all) {
        if ('focus' in c) {
          await c.focus();
          if ('navigate' in c) await (c as WindowClient).navigate(url).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
