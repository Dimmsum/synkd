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
//   - One-tap ping replies (WF-093): tapping a reply button on a ping notification stores only
//     `{ pingId, reply, at }` under a random one-time key in the `synkd-quick-replies` cache
//     and opens the inbox, which takes it and sends the reply as the signed-in user. Nothing
//     else is stored, and the worker still never calls the API (lib/push/quick-reply.ts).
//   - WF-110 adds the offline cache of the last-known Now data, holding only what the
//     redacting database functions already returned for this viewer. Nothing here does that yet.
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { NetworkOnly, Serwist } from 'serwist';
// Relative, not `@/`: this file is bundled on its own by the serwist route.
import { DEFAULT_PUSH_URL, FALLBACK_PUSH, parsePushText, safeAppPath } from '../lib/push/payload';
import {
  PING_QUICK_REPLIES,
  QUICK_REPLY_CACHE,
  QUICK_REPLY_PARAM,
  pingIdFromTag,
  quickReplyAction,
  quickReplyFromAction,
  quickReplyPath,
} from '../lib/push/quick-reply';

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

/** TypeScript's lib lacks notification action buttons (supported by Chrome; ignored elsewhere). */
type NotificationOptionsWithActions = NotificationOptions & {
  actions?: { action: string; title: string }[];
};

self.addEventListener('push', (event) => {
  const payload = parsePushText(pushText(event)) ?? FALLBACK_PUSH;
  // A ping gets one-tap reply buttons (FR-PING-4, WF-093); the platform shows as many as it can.
  const pingId = payload.kind === 'ping' ? pingIdFromTag(payload.tag) : null;
  const options: NotificationOptionsWithActions = {
    body: payload.body,
    tag: payload.tag,
    icon: '/icons/icon-192.png',
    // Only the path to open (and, for a ping, its id for a quick reply); nothing else is kept.
    data: pingId ? { url: payload.url, pingId } : { url: payload.url },
    ...(pingId
      ? {
          actions: PING_QUICK_REPLIES.map((title, i) => ({ action: quickReplyAction(i), title })),
        }
      : {}),
  };
  event.waitUntil(self.registration.showNotification(payload.title, options));
});

/**
 * For a tap on a quick-reply button: stores the reply under a one-time key and returns the inbox
 * path that finishes it, or null (then the notification just opens as usual).
 */
async function stageQuickReply(action: string, data: unknown): Promise<string | null> {
  const reply = quickReplyFromAction(action);
  const pingId = pingIdFromTag(`ping:${String((data as { pingId?: unknown } | null)?.pingId)}`);
  if (!reply || !pingId) return null;
  try {
    const key = self.crypto.randomUUID();
    const path = quickReplyPath(key);
    if (!path) return null;
    const cache = await caches.open(QUICK_REPLY_CACHE);
    await cache.put(
      new URL(path, self.location.origin).href,
      new Response(JSON.stringify({ pingId, reply, at: Date.now() }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    return `/inbox?${QUICK_REPLY_PARAM}=${key}`;
  } catch {
    return null;
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data: unknown = event.notification.data;
  const action = event.action;
  event.waitUntil(
    (async () => {
      const quick = action ? await stageQuickReply(action, data) : null;
      const path =
        quick ?? safeAppPath((data as { url?: unknown } | null)?.url) ?? DEFAULT_PUSH_URL;
      const target = new URL(path, self.location.origin).href;
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

// TODO(WF-091 follow-up): `pushsubscriptionchange` (the browser rotated the subscription) isn't
// handled yet; the settings card re-saves the current subscription whenever it's shown, and a
// dead one is removed on the next send. (It needs an authenticated save from the worker, which
// has no fresh session token; see lib/push/quick-reply.ts for the same constraint.)
