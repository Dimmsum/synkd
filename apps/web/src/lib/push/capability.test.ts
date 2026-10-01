import { describe, expect, it } from 'vitest';
import {
  detectPushSupport,
  deviceLabel,
  iosVersion,
  sameServerKey,
  urlBase64ToUint8Array,
} from './capability';
import type { PushEnvironment } from './capability';

const UA = {
  iPhone17Safari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iPhone164:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1',
  iPhone163:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1',
  iPhoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  iPadDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidSamsung:
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
};

// A real-shaped VAPID public key: 65 bytes, base64url without padding.
const VAPID =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

function env(over: Partial<PushEnvironment> = {}): PushEnvironment {
  return {
    userAgent: UA.androidChrome,
    maxTouchPoints: 5,
    standalone: false,
    hasServiceWorker: true,
    hasPushManager: true,
    hasNotification: true,
    vapidPublicKey: VAPID,
    ...over,
  };
}

describe('iosVersion', () => {
  it('reads iPhone and iPad versions, including desktop-mode iPads', () => {
    expect(iosVersion(UA.iPhone17Safari, 5)).toEqual([17, 5]);
    expect(iosVersion(UA.iPhone163, 5)).toEqual([16, 3]);
    expect(iosVersion(UA.iPhoneChrome, 5)).toEqual([17, 5]);
    expect(iosVersion(UA.iPadDesktop, 5)).toEqual([17, 4]);
  });

  it('is null off iOS; a Mac without touch is a Mac', () => {
    expect(iosVersion(UA.macSafari, 0)).toBeNull();
    expect(iosVersion(UA.androidChrome, 5)).toBeNull();
    expect(iosVersion(UA.windowsEdge, 0)).toBeNull();
  });
});

describe('detectPushSupport', () => {
  it('supported on Android Chrome and desktop browsers', () => {
    expect(detectPushSupport(env())).toBe('supported');
    expect(detectPushSupport(env({ userAgent: UA.windowsEdge, maxTouchPoints: 0 }))).toBe(
      'supported',
    );
    expect(detectPushSupport(env({ userAgent: UA.macSafari, maxTouchPoints: 0 }))).toBe(
      'supported',
    );
  });

  it('iPhone and iPad in a browser tab need the Home Screen app (R5, FR-PWA-3)', () => {
    for (const userAgent of [UA.iPhone17Safari, UA.iPhoneChrome, UA.iPadDesktop, UA.iPhone164])
      expect(detectPushSupport(env({ userAgent, hasPushManager: false, standalone: false }))).toBe(
        'ios-needs-install',
      );
  });

  it('the installed app on iOS 16.4+ is supported', () => {
    expect(detectPushSupport(env({ userAgent: UA.iPhone164, standalone: true }))).toBe('supported');
    expect(detectPushSupport(env({ userAgent: UA.iPadDesktop, standalone: true }))).toBe(
      'supported',
    );
  });

  it('iOS before 16.4 has no Web Push, installed or not', () => {
    for (const standalone of [true, false])
      expect(detectPushSupport(env({ userAgent: UA.iPhone163, standalone }))).toBe('ios-too-old');
  });

  it('an installed iOS app without the Push API is unsupported', () => {
    expect(
      detectPushSupport(
        env({ userAgent: UA.iPhone17Safari, standalone: true, hasPushManager: false }),
      ),
    ).toBe('unsupported');
  });

  it('unsupported without a service worker, the Push API or the Notification API', () => {
    expect(detectPushSupport(env({ hasServiceWorker: false }))).toBe('unsupported');
    expect(detectPushSupport(env({ hasPushManager: false }))).toBe('unsupported');
    expect(detectPushSupport(env({ hasNotification: false }))).toBe('unsupported');
  });

  it('not configured without a VAPID public key, whatever the browser', () => {
    expect(detectPushSupport(env({ vapidPublicKey: undefined }))).toBe('not-configured');
    expect(detectPushSupport(env({ vapidPublicKey: '', userAgent: UA.iPhone163 }))).toBe(
      'not-configured',
    );
  });
});

describe('deviceLabel', () => {
  it('gives a coarse browser and platform, never the raw user agent', () => {
    expect(deviceLabel(UA.iPhone17Safari, 5)).toBe('Safari on iPhone');
    expect(deviceLabel(UA.iPhoneChrome, 5)).toBe('Chrome on iPhone');
    expect(deviceLabel(UA.iPadDesktop, 5)).toBe('Safari on iPad');
    expect(deviceLabel(UA.macSafari, 0)).toBe('Safari on Mac');
    expect(deviceLabel(UA.androidChrome, 5)).toBe('Chrome on Android');
    expect(deviceLabel(UA.androidSamsung, 5)).toBe('Samsung Internet on Android');
    expect(deviceLabel(UA.windowsEdge, 0)).toBe('Edge on Windows');
    expect(deviceLabel(UA.linuxFirefox, 0)).toBe('Firefox on Linux');
  });

  it('is null when nothing is recognised', () => {
    expect(deviceLabel('curl/8.0')).toBeNull();
    expect(deviceLabel('')).toBeNull();
  });
});

describe('urlBase64ToUint8Array and sameServerKey', () => {
  it('decodes a VAPID public key to its 65 bytes', () => {
    const bytes = urlBase64ToUint8Array(VAPID);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(0x04); // uncompressed P-256 point
  });

  it('handles padding and rejects non-base64url input', () => {
    expect([...urlBase64ToUint8Array('AQID')]).toEqual([1, 2, 3]);
    expect([...urlBase64ToUint8Array('AQ==')]).toEqual([1]);
    expect([...urlBase64ToUint8Array('_-8')]).toEqual([0xff, 0xef]);
    expect(() => urlBase64ToUint8Array('not base64!')).toThrow();
  });

  it('sameServerKey tells whether a subscription used this key', () => {
    const key = urlBase64ToUint8Array(VAPID).buffer;
    expect(sameServerKey(key, VAPID)).toBe(true);
    expect(sameServerKey(new Uint8Array(65).buffer, VAPID)).toBe(false);
    expect(sameServerKey(null, VAPID)).toBe(false);
  });
});
