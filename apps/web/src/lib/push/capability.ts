// Can this browser get Web Push, and if not, why? (WF-091; FR-PWA-3, FR-PWA-4, NFR-COMPAT-2,
// R5). Pure functions over a snapshot of the browser, so every case is unit-tested; the client
// component takes the snapshot (readPushEnvironment) and shows the matching explanation.

import { PUSH_DEVICE_LABEL_MAX_LENGTH } from '@synkd/shared';

/**
 * - supported: we can ask for permission (after the explanation, never on load: FR-PWA-4).
 * - ios-needs-install: iPhone/iPad in a browser tab. iOS only allows push for apps added to
 *   the Home Screen (iOS 16.4+), so the answer is the install guide (FR-PWA-3, WF-111).
 * - ios-too-old: iOS before 16.4 has no Web Push at all.
 * - unsupported: no service worker, Push API or Notification API (old or locked-down
 *   browsers, some in-app browsers).
 * - not-configured: this build has no VAPID public key, so there is nothing to subscribe with.
 * In every case except `supported`, pings still arrive in the in-app inbox (NFR-COMPAT-2).
 */
export type PushSupport =
  'supported' | 'ios-needs-install' | 'ios-too-old' | 'unsupported' | 'not-configured';

/** What detectPushSupport looks at. */
export interface PushEnvironment {
  userAgent: string;
  /** `navigator.maxTouchPoints`: iPadOS reports a Mac user agent but has a touch screen. */
  maxTouchPoints: number;
  /** Running as an installed app (`display-mode: standalone` or iOS `navigator.standalone`). */
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  vapidPublicKey: string | undefined;
}

/** Web Push arrived on iOS/iPadOS in 16.4, for Home Screen apps only. */
const IOS_PUSH_MIN: readonly [number, number] = [16, 4];

/** The iOS/iPadOS version from a user agent, or null when it isn't iOS. [0, 0] = unknown. */
export function iosVersion(userAgent: string, maxTouchPoints: number): [number, number] | null {
  const iPhoneLike = /\b(iPhone|iPad|iPod)\b/.test(userAgent);
  // iPadOS 13+ asks for desktop sites by default: a Macintosh user agent with touch.
  const iPadAsMac = /\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1;
  if (!iPhoneLike && !iPadAsMac) return null;
  const os = / OS (\d+)[_.](\d+)/.exec(userAgent);
  // A desktop-mode iPad carries no OS version; Safari's version tracks iOS's.
  const safari = /\bVersion\/(\d+)\.(\d+)/.exec(userAgent);
  const match = (iPhoneLike ? os : null) ?? safari;
  if (!match) return [0, 0];
  return [Number(match[1]), Number(match[2])];
}

function atLeast(v: readonly [number, number], min: readonly [number, number]): boolean {
  return v[0] > min[0] || (v[0] === min[0] && v[1] >= min[1]);
}

export function detectPushSupport(env: PushEnvironment): PushSupport {
  if (!env.vapidPublicKey) return 'not-configured';
  const ios = iosVersion(env.userAgent, env.maxTouchPoints);
  if (ios) {
    const known = ios[0] > 0;
    if (known && !atLeast(ios, IOS_PUSH_MIN)) return 'ios-too-old';
    // Tabs never expose PushManager on iOS; the installed app does (from 16.4).
    if (!env.standalone) return 'ios-needs-install';
  }
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return 'unsupported';
  return 'supported';
}

/** Reads the live browser. Client only. */
export function readPushEnvironment(): PushEnvironment {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standalone:
      nav.standalone === true ||
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(display-mode: standalone)').matches),
    hasServiceWorker: 'serviceWorker' in nav,
    hasPushManager: 'PushManager' in window,
    hasNotification: 'Notification' in window,
    // Written out in full so Next inlines it into the client bundle.
    vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || undefined,
  };
}

/**
 * A coarse label for the device list, such as "Chrome on Android", so people can tell their
 * devices apart without us storing the raw user agent (NFR-SEC-1). Null when nothing is
 * recognised.
 */
export function deviceLabel(userAgent: string, maxTouchPoints = 0): string | null {
  const ua = userAgent;
  const browser = /\bEdg(A|iOS)?\//.test(ua)
    ? 'Edge'
    : /\bSamsungBrowser\//.test(ua)
      ? 'Samsung Internet'
      : /\b(OPR|OPT)\//.test(ua)
        ? 'Opera'
        : /\b(Firefox|FxiOS)\//.test(ua)
          ? 'Firefox'
          : /\b(Chrome|CriOS|Chromium)\//.test(ua)
            ? 'Chrome'
            : /\bVersion\/[\d.]+.*\bSafari\//.test(ua)
              ? 'Safari'
              : null;
  const os = /\biPhone\b/.test(ua)
    ? 'iPhone'
    : /\biPad\b/.test(ua) || (/\bMacintosh\b/.test(ua) && maxTouchPoints > 1)
      ? 'iPad'
      : /\bAndroid\b/.test(ua)
        ? 'Android'
        : /\bCrOS\b/.test(ua)
          ? 'ChromeOS'
          : /\bWindows\b/.test(ua)
            ? 'Windows'
            : /\bMac OS X\b|\bMacintosh\b/.test(ua)
              ? 'Mac'
              : /\bLinux\b/.test(ua)
                ? 'Linux'
                : null;
  const label = browser && os ? `${browser} on ${os}` : (browser ?? os);
  return label ? label.slice(0, PUSH_DEVICE_LABEL_MAX_LENGTH) : null;
}

/**
 * A base64url VAPID public key as the bytes `pushManager.subscribe` wants. Throws on a string
 * that isn't base64url.
 */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(base64Url)) throw new Error('Not a base64url string');
  const unpadded = base64Url.replace(/=+$/, '');
  const base64 =
    unpadded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (unpadded.length % 4)) % 4);
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Whether a subscription's server key is `vapidPublicKey` (false after a key rotation). */
export function sameServerKey(
  applicationServerKey: ArrayBuffer | null | undefined,
  vapidPublicKey: string,
): boolean {
  if (!applicationServerKey) return false;
  const a = new Uint8Array(applicationServerKey);
  const b = urlBase64ToUint8Array(vapidPublicKey);
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}
