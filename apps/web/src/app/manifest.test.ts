import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SPLASH_SCREENS, pwaMetadata } from '@/lib/pwa';
import manifest from './manifest';

// FR-PWA-1 / WF-090: the installability basics that browsers check.

const publicDir = fileURLToPath(new URL('../../public', import.meta.url));

/** Width and height from a PNG's IHDR chunk. */
function pngSize(url: string): { width: number; height: number } {
  const buf = readFileSync(`${publicDir}${url}`);
  expect(buf.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('web app manifest', () => {
  const m = manifest();

  it('opens standalone, inside its own scope', () => {
    expect(m.display).toBe('standalone');
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(m.background_color).toBeTruthy();
    expect(m.start_url?.startsWith(m.scope ?? '/')).toBe(true);
  });

  it.each(['any', 'maskable'] as const)('has 192px and 512px %s icons', (purpose) => {
    const sizes = (m.icons ?? []).filter((i) => i.purpose === purpose).map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  });

  it('points every icon at a PNG of the declared size', () => {
    for (const icon of m.icons ?? []) {
      const [w, h] = (icon.sizes ?? '').split('x').map(Number);
      expect(pngSize(icon.src)).toEqual({ width: w, height: h });
    }
  });
});

describe('iOS metadata', () => {
  it('has a 180px apple-touch-icon', () => {
    for (const icon of pwaMetadata.icons.apple) {
      expect(pngSize(icon.url)).toEqual({ width: 180, height: 180 });
    }
  });

  it('has a launch image matching each media query', () => {
    expect(SPLASH_SCREENS.length).toBeGreaterThan(0);
    for (const { url, media } of SPLASH_SCREENS) {
      const match = /device-width: (\d+)px\) and \(device-height: (\d+)px\).*ratio: (\d)\)/.exec(
        media,
      );
      expect(match).not.toBeNull();
      const [, cssW, cssH, dpr] = (match ?? []).map(Number);
      expect(pngSize(url)).toEqual({ width: cssW! * dpr!, height: cssH! * dpr! });
    }
  });
});
