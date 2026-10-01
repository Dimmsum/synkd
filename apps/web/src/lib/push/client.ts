// Browser side of Web Push (WF-091, FR-PWA-4). Used only by client components, and only from
// a tap on a button that follows the explanation: nothing here runs on page load except
// reading the current state, which never prompts.

import { deletePushSubscription, savePushSubscription } from '@/lib/actions/push';
import { deviceLabel, sameServerKey, urlBase64ToUint8Array } from './capability';

/** How long to wait for the service worker before giving up. */
const SW_TIMEOUT_MS = 10_000;

/**
 * The active service worker registration, or null when there isn't one: in development
 * (SerwistProvider only registers it in production builds), or while it's still installing and
 * `wait` is false. With `wait`, gives it up to 10 s to become active.
 */
export async function pushRegistration(wait = false): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing?.active) return existing;
  if (!wait) return null;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), SW_TIMEOUT_MS)),
  ]);
}

/** This browser's current subscription, if any. Never prompts. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await pushRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

function toInput(sub: PushSubscription) {
  const json = sub.toJSON();
  return {
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
    deviceLabel: deviceLabel(navigator.userAgent, navigator.maxTouchPoints),
  };
}

export type EnableResult =
  | { ok: true }
  | { ok: false; reason: 'denied' | 'dismissed' | 'no-service-worker' | 'failed'; error?: string };

/**
 * Asks for permission, subscribes and saves the subscription. Call only from a click on the
 * "Turn on" button of the explanation (FR-PWA-4); iOS also requires a user gesture.
 */
export async function enablePush(vapidPublicKey: string): Promise<EnableResult> {
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return { ok: false, reason: 'denied' };
  if (permission !== 'granted') return { ok: false, reason: 'dismissed' };

  const reg = await pushRegistration(true);
  if (!reg) return { ok: false, reason: 'no-service-worker' };

  try {
    let sub = await reg.pushManager.getSubscription();
    // Subscribed with an older server key (VAPID rotation): subscribe() would refuse.
    if (sub && !sameServerKey(sub.options.applicationServerKey, vapidPublicKey)) {
      await deletePushSubscription(sub.endpoint);
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
    const saved = await savePushSubscription(toInput(sub));
    if (!saved.ok) {
      // Don't leave a browser subscription the server doesn't know about.
      await sub.unsubscribe().catch(() => undefined);
      return { ok: false, reason: 'failed', error: saved.error };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/**
 * Re-saves an existing subscription (keys can change, and a device dropped by the server,
 * e.g. over the cap, comes back). Silent: no prompt, errors ignored.
 */
export async function resyncPush(sub: PushSubscription): Promise<void> {
  await savePushSubscription(toInput(sub)).catch(() => undefined);
}

/**
 * Turns push off on this device: forgets it on the server, then unsubscribes the browser.
 * Used by "Turn off" and before signing out, so the next person to use this browser doesn't
 * get the previous account's notifications. Never throws.
 */
export async function disablePush(): Promise<void> {
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    await deletePushSubscription(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe();
  } catch {
    // Best effort: a stale subscription is removed on the next send (HTTP 404/410).
  }
}

/** For the sign-out button: disablePush, but never holds sign-out up for long. */
export async function disablePushBeforeSignOut(timeoutMs = 3_000): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  await Promise.race([disablePush(), new Promise((r) => setTimeout(r, timeoutMs))]);
}
