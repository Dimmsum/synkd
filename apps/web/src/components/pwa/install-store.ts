'use client';

// The install prompt's browser state (WF-111, FR-PWA-3). The decisions are in lib/install.ts;
// this module holds the live parts: the captured `beforeinstallprompt` event, whether the app
// was just installed, and the dismissal in localStorage.
//
// The listeners are added when this module is first evaluated. <InstallCapture /> in the root
// layout imports it, so the event is caught on every page, however early the browser fires it.

import { useSyncExternalStore } from 'react';
import {
  detectInstallPlatform,
  iosSupportsPush,
  readDismissed,
  writeDismissed,
  type InstallPlatform,
  type KeyValueStore,
} from '@/lib/install';

/** Chromium's `beforeinstallprompt` event (not in the DOM typings). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface InstallState {
  platform: InstallPlatform;
  /** A captured prompt is waiting for our Install button. */
  canPrompt: boolean;
  dismissed: boolean;
  /** iOS 16.4+, where the installed app can get notifications. */
  iosPush: boolean;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installedHere = false;
let snapshot: InstallState | null = null;
const listeners = new Set<() => void>();

function changed() {
  snapshot = null;
  for (const listener of listeners) listener();
}

function storage(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Running as the installed app (also used to tag feedback, WF-137). */
export function standalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches)
  );
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the browser's own mini-infobar away; our UI offers the prompt instead.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installedHere = true;
    changed();
  });
}

function read(): InstallState {
  const env = {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: installedHere || standalone(),
  };
  return {
    platform: detectInstallPlatform(env),
    canPrompt: deferred !== null,
    dismissed: readDismissed(storage()),
    iosPush: iosSupportsPush(env),
  };
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getSnapshot = () => (snapshot ??= read());
// Unknown during the server render and hydration, so both render the same placeholder.
const getServerSnapshot = () => null;

/** The install state, or null until the browser has been checked. */
export function useInstallState(): InstallState | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Opens the browser's install dialog from a captured prompt. A "no" counts as a dismissal. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred;
  if (!event) return 'unavailable';
  // A prompt can only be used once.
  deferred = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === 'accepted') installedHere = true;
  else writeDismissed(storage(), true);
  changed();
  return outcome;
}

/** "Not now": hidden on this device until the user asks for it again. */
export function dismissInstall() {
  writeDismissed(storage(), true);
  changed();
}

/** The user asked to see it again. */
export function showInstallAgain() {
  writeDismissed(storage(), false);
  changed();
}
