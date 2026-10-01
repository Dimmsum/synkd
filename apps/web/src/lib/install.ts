// Installing the PWA (WF-111; FR-PWA-3, R5, FR-WEB-6). Pure functions over a snapshot of the
// browser, so every case is unit-tested; components/pwa/* takes the snapshot, captures
// `beforeinstallprompt` and shows the matching prompt or guide.
//
//   - Android and other Chromium browsers fire `beforeinstallprompt`. We stop the browser's own
//     mini-infobar, keep the event and call its prompt() from our own "Install" button.
//   - iOS has no install API. Safari (and, from iOS 16.4, Chrome, Edge and Firefox) can "Add to
//     Home Screen" from the Share menu, so we show those steps. Notifications on iPhone and iPad
//     only work in the installed app (iOS 16.4+), which is why the guide matters (R5).
//   - In-app browsers (Instagram, Facebook, …) can't install at all: open the page in Safari.
//   - Once installed (running standalone) nothing is shown.
//   - Dismissed prompts stay hidden on this device until the user asks for them again from
//     Settings → Install app or the help page.

import { iosVersion } from '@/lib/push/capability';

/** What detectInstallPlatform looks at. */
export interface InstallEnvironment {
  userAgent: string;
  /** `navigator.maxTouchPoints`: iPadOS reports a Mac user agent but has a touch screen. */
  maxTouchPoints: number;
  /** Running as the installed app (`display-mode: standalone` or iOS `navigator.standalone`). */
  standalone: boolean;
}

/**
 * - installed      already running as the installed app
 * - ios-safari     iPhone/iPad in Safari: Share → Add to Home Screen
 * - ios-browser    iPhone/iPad in Chrome, Edge, Firefox, …: the same from their Share menu
 *                  (iOS 16.4+); older iOS only installs from Safari
 * - ios-in-app     an app's built-in browser (Instagram, Facebook, …), which can't install
 * - android        Android: the install prompt when the browser offers it, else its menu
 * - desktop        anything else (computers): the browser's install button, where it has one
 */
export type InstallPlatform =
  'installed' | 'ios-safari' | 'ios-browser' | 'ios-in-app' | 'android' | 'desktop';

/** In-app browsers that can't add to the Home Screen. */
const IN_APP =
  /\b(FBAN|FBAV|FB_IAB|Instagram|Line|Snapchat|LinkedInApp|BytedanceWebview|musical_ly)\b/;
/** Third-party iOS browsers (all WebKit underneath). */
const IOS_BROWSER = /\b(CriOS|FxiOS|EdgiOS|OPiOS|OPT|YaBrowser|DuckDuckGo|Brave)\b/;

export function detectInstallPlatform(env: InstallEnvironment): InstallPlatform {
  if (env.standalone) return 'installed';
  if (iosVersion(env.userAgent, env.maxTouchPoints)) {
    if (IN_APP.test(env.userAgent)) return 'ios-in-app';
    if (IOS_BROWSER.test(env.userAgent)) return 'ios-browser';
    return 'ios-safari';
  }
  if (/\bAndroid\b/.test(env.userAgent)) return 'android';
  return 'desktop';
}

/** The iOS version that brought Web Push and Add to Home Screen in other browsers. */
export function iosSupportsPush(env: Pick<InstallEnvironment, 'userAgent' | 'maxTouchPoints'>) {
  const v = iosVersion(env.userAgent, env.maxTouchPoints);
  if (!v) return false;
  // [0, 0] is a desktop-mode iPad without a version: assume a current one.
  return v[0] === 0 || v[0] > 16 || (v[0] === 16 && v[1] >= 4);
}

/**
 * Where the install UI is shown:
 * - banner      the app shell's nudge on phones and tablets, only where installing is one tap
 *               or a clear guide (a captured prompt, or iPhone/iPad), and never once dismissed
 * - onboarding  the install step (J1.8): every case; once dismissed, a "show me how" button
 * - requested   Settings → Install app and the help page: the user asked, so always shown,
 *               dismissed or not, including what to do on a computer
 */
export type InstallSurface = 'banner' | 'onboarding' | 'requested';

/**
 * - hidden         show nothing
 * - collapsed      dismissed earlier: offer to show it again
 * - installed      say it's already installed (only where the user asked)
 * - prompt         our "Install" button, which opens the browser's install dialog
 * - ios-safari, ios-browser, ios-in-app   the matching step-by-step guide
 * - android-menu   no prompt (yet): install from the browser menu
 * - desktop        a computer: the address-bar install button, or install on a phone
 */
export type InstallView =
  | 'hidden'
  | 'collapsed'
  | 'installed'
  | 'prompt'
  | 'ios-safari'
  | 'ios-browser'
  | 'ios-in-app'
  | 'android-menu'
  | 'desktop';

export function installView(input: {
  platform: InstallPlatform;
  /** A `beforeinstallprompt` event is waiting to be used. */
  canPrompt: boolean;
  dismissed: boolean;
  surface: InstallSurface;
}): InstallView {
  const { platform, canPrompt, dismissed, surface } = input;
  if (platform === 'installed') return surface === 'requested' ? 'installed' : 'hidden';
  if (dismissed && surface !== 'requested')
    return surface === 'onboarding' ? 'collapsed' : 'hidden';
  // The banner is for phones and tablets; computers install from Settings or the help page.
  if (surface === 'banner' && platform === 'desktop') return 'hidden';
  if (canPrompt) return 'prompt';
  switch (platform) {
    case 'ios-safari':
    case 'ios-browser':
    case 'ios-in-app':
      return platform;
    case 'android':
      return surface === 'banner' ? 'hidden' : 'android-menu';
    case 'desktop':
      return 'desktop';
  }
}

/** localStorage key holding when the install prompt was dismissed on this device. */
export const INSTALL_DISMISSED_KEY = 'wf_install_dismissed';

/** The part of `Storage` we use, so tests can pass a stand-in. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Whether the prompt was dismissed here. Unreadable storage (private mode) counts as not. */
export function readDismissed(storage: KeyValueStore | null | undefined): boolean {
  try {
    return Boolean(storage?.getItem(INSTALL_DISMISSED_KEY));
  } catch {
    return false;
  }
}

/** Remembers a dismissal (`dismissed`) or forgets it when the user asks again. */
export function writeDismissed(
  storage: KeyValueStore | null | undefined,
  dismissed: boolean,
  now: Date = new Date(),
): void {
  try {
    if (dismissed) storage?.setItem(INSTALL_DISMISSED_KEY, now.toISOString());
    else storage?.removeItem(INSTALL_DISMISSED_KEY);
  } catch {
    // Storage can be full or blocked; the prompt then just shows again next time.
  }
}
