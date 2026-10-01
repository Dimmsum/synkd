/// <reference lib="esnext" />
/// <reference lib="webworker" />
// Service worker source (FR-PWA-1, WF-090). Bundled by `app/serwist/[path]/route.ts` and served
// at /serwist/sw.js with `Service-Worker-Allowed: /`, so it controls the whole origin.
//
// Privacy (NFR-SEC-1, NFR-SEC-2, D35, D41): this worker precaches the static app shell only.
//   - Precached: hashed build output under /_next/static, files in public/ (icons) and the static
//     /offline page. None of these carry user data.
//   - Never cached: page HTML, RSC payloads, server actions, route handlers, Supabase, Clerk or any
//     other request. Those can hold other people's (redacted) schedules or auth state, so they go
//     straight to the network. There is no runtime cache and no on-demand CACHE_URLS handling
//     (the message listener is deliberately not registered).
//   - Web Push (WF-091): the push handler shows what the (encrypted) payload says and nothing
//     else. It fetches nothing, caches nothing and logs nothing; the payload format and its
//     limits are in lib/push/payload.ts. Tapping a notification opens a path on this site only.
//   - WF-110 adds the offline cache of the last-known Now data, holding only what the
//     redacting database functions already returned for this viewer. Nothing here does that yet.
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { NetworkOnly, Serwist } from 'serwist';
// Relative, not `@/`: this file is bundled on its own by the serwist route.
import { DEFAULT_PUSH_URL, FALLBACK_PUSH, parsePushText, safeAppPath } from '../lib/push/payload';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/** Precached at install (see the route's `additionalPrecacheEntries`). */
const OFFLINE_URL = '/offline';

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: { cleanupOutdatedCaches: true },
  // TODO(WF-112): wait for the user to accept "New version available" instead of skipping.
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  disableDevLogs: true,
  runtimeCaching: [
    {
      // Page navigations always hit the network and are never stored. The route only exists so
      // that a failed navigation falls back to the precached offline page below.
      matcher: ({ request }) => request.mode === 'navigate',
      handler: new NetworkOnly(),
    },
  ],
  fallbacks: {
    entries: [{ url: OFFLINE_URL, matcher: ({ request }) => request.destination === 'document' }],
  },
});

self.addEventListener('install', serwist.handleInstall);
self.addEventListener('activate', serwist.handleActivate);
self.addEventListener('fetch', serwist.handleFetch);

// ---------------------------------------------------------------------------------------------
// Web Push (WF-091, FR-PING-3). Every push must show a notification (the subscription is
// `userVisibleOnly`, and Safari drops subscriptions that push silently), so an unreadable
// payload shows a generic one instead of nothing.
// ---------------------------------------------------------------------------------------------

function pushText(event: PushEvent): string | null {
  try {
    return event.data?.text() ?? null;
  } catch {
    return null;
  }
}

self.addEventListener('push', (event) => {
  const payload = parsePushText(pushText(event)) ?? FALLBACK_PUSH;
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: '/icons/icon-192.png',
      // Only the path to open; nothing else about the notification is kept.
      data: { url: payload.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data: unknown = event.notification.data;
  const path = safeAppPath((data as { url?: unknown } | null)?.url) ?? DEFAULT_PUSH_URL;
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Reuse an open window of the app if there is one, otherwise open a new one.
      const existing = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (existing) {
        const focused = await existing.focus();
        await focused.navigate(target).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

// TODO(WF-092/WF-093): `pushsubscriptionchange` (the browser rotated the subscription) isn't
// handled yet; the settings card re-saves the current subscription whenever it's shown, and a
// dead one is removed on the next send. Notification action buttons (one-tap replies) are
// WF-093.
