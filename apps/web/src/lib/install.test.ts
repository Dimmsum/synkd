import { describe, expect, it } from 'vitest';
import {
  INSTALL_DISMISSED_KEY,
  detectInstallPlatform,
  installView,
  iosSupportsPush,
  readDismissed,
  writeDismissed,
  type InstallPlatform,
  type InstallSurface,
  type KeyValueStore,
} from './install';

// WF-111 (FR-PWA-3, R5): which install prompt or guide a browser gets, and dismissal.

const UA = {
  iPhoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iPhone163:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1',
  iPhoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  iPhoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
  iPhoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 337.0.3.23.54 (iPhone15,3; iOS 17_5; en_US; en; scale=3.00; 1290x2796; 618183384)',
  iPhoneFacebook:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.37.106;FBBV/600000000;FBDV/iPhone15,3]',
  iPadDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
};

const env = (userAgent: string, extra: { maxTouchPoints?: number; standalone?: boolean } = {}) => ({
  userAgent,
  maxTouchPoints: extra.maxTouchPoints ?? 0,
  standalone: extra.standalone ?? false,
});

describe('detectInstallPlatform', () => {
  it.each([
    ['iPhone Safari', env(UA.iPhoneSafari, { maxTouchPoints: 5 }), 'ios-safari'],
    ['iPad in desktop mode', env(UA.iPadDesktop, { maxTouchPoints: 5 }), 'ios-safari'],
    ['Chrome on iPhone', env(UA.iPhoneChrome, { maxTouchPoints: 5 }), 'ios-browser'],
    ['Firefox on iPhone', env(UA.iPhoneFirefox, { maxTouchPoints: 5 }), 'ios-browser'],
    ['Instagram on iPhone', env(UA.iPhoneInstagram, { maxTouchPoints: 5 }), 'ios-in-app'],
    ['Facebook on iPhone', env(UA.iPhoneFacebook, { maxTouchPoints: 5 }), 'ios-in-app'],
    ['Chrome on Android', env(UA.androidChrome, { maxTouchPoints: 5 }), 'android'],
    ['Firefox on Android', env(UA.androidFirefox, { maxTouchPoints: 5 }), 'android'],
    ['Safari on a Mac', env(UA.macSafari), 'desktop'],
    ['Edge on Windows', env(UA.windowsEdge), 'desktop'],
  ] as const)('%s → %s', (_name, e, expected) => {
    expect(detectInstallPlatform(e)).toBe(expected);
  });

  it('reports the installed app (standalone) before anything else', () => {
    expect(
      detectInstallPlatform(env(UA.iPhoneSafari, { maxTouchPoints: 5, standalone: true })),
    ).toBe('installed');
    expect(detectInstallPlatform(env(UA.androidChrome, { standalone: true }))).toBe('installed');
  });
});

describe('iosSupportsPush', () => {
  it('is true from iOS 16.4, false before, and false off iOS', () => {
    expect(iosSupportsPush(env(UA.iPhoneSafari))).toBe(true);
    expect(iosSupportsPush(env(UA.iPhone163))).toBe(false);
    expect(iosSupportsPush(env(UA.iPadDesktop, { maxTouchPoints: 5 }))).toBe(true);
    expect(iosSupportsPush(env(UA.androidChrome))).toBe(false);
  });
});

describe('installView', () => {
  const view = (
    platform: InstallPlatform,
    surface: InstallSurface,
    opts: { canPrompt?: boolean; dismissed?: boolean } = {},
  ) =>
    installView({
      platform,
      surface,
      canPrompt: opts.canPrompt ?? false,
      dismissed: opts.dismissed ?? false,
    });

  it('shows nothing once installed, except a note where the user asked', () => {
    expect(view('installed', 'banner', { canPrompt: true })).toBe('hidden');
    expect(view('installed', 'onboarding')).toBe('hidden');
    expect(view('installed', 'requested')).toBe('installed');
  });

  it('Android: our own prompt when the browser offered one, else the browser menu', () => {
    expect(view('android', 'banner', { canPrompt: true })).toBe('prompt');
    expect(view('android', 'onboarding', { canPrompt: true })).toBe('prompt');
    expect(view('android', 'onboarding')).toBe('android-menu');
    expect(view('android', 'banner')).toBe('hidden');
  });

  it('iOS: the step-by-step guide for the browser in use', () => {
    expect(view('ios-safari', 'banner')).toBe('ios-safari');
    expect(view('ios-browser', 'onboarding')).toBe('ios-browser');
    expect(view('ios-in-app', 'requested')).toBe('ios-in-app');
  });

  it('computers: never in the banner, otherwise the prompt or a hint', () => {
    expect(view('desktop', 'banner', { canPrompt: true })).toBe('hidden');
    expect(view('desktop', 'onboarding', { canPrompt: true })).toBe('prompt');
    expect(view('desktop', 'requested')).toBe('desktop');
  });

  it('once dismissed: hidden in the banner, collapsed in onboarding', () => {
    expect(view('ios-safari', 'banner', { dismissed: true })).toBe('hidden');
    expect(view('android', 'banner', { dismissed: true, canPrompt: true })).toBe('hidden');
    expect(view('ios-safari', 'onboarding', { dismissed: true })).toBe('collapsed');
  });

  it('shows again when the user asks for it, dismissed or not', () => {
    expect(view('ios-safari', 'requested', { dismissed: true })).toBe('ios-safari');
    expect(view('android', 'requested', { dismissed: true, canPrompt: true })).toBe('prompt');
  });
});

describe('dismissal storage', () => {
  const memory = (): KeyValueStore & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
  };

  it('remembers a dismissal with its time, and forgets it when asked again', () => {
    const store = memory();
    expect(readDismissed(store)).toBe(false);
    writeDismissed(store, true, new Date('2026-09-30T12:00:00Z'));
    expect(store.data.get(INSTALL_DISMISSED_KEY)).toBe('2026-09-30T12:00:00.000Z');
    expect(readDismissed(store)).toBe(true);
    writeDismissed(store, false);
    expect(readDismissed(store)).toBe(false);
  });

  it('treats missing or blocked storage as not dismissed, without throwing', () => {
    const blocked: KeyValueStore = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(readDismissed(null)).toBe(false);
    expect(readDismissed(blocked)).toBe(false);
    expect(() => writeDismissed(blocked, true)).not.toThrow();
    expect(() => writeDismissed(undefined, false)).not.toThrow();
  });
});
