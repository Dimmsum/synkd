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
//     straight to the network. There is no runtime cache, no on-demand CACHE_URLS handling (the
//     message listener is deliberately not registered) and no push handler (WF-091).
//   - WF-110 adds the offline cache of the last-known Now data, holding only what the
//     redacting database functions already returned for this viewer. Nothing here does that yet.
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { NetworkOnly, Serwist } from 'serwist';

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
