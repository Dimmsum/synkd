import { describe, expect, it } from 'vitest';
import { hueFor } from './hue';

describe('hueFor', () => {
  it('is stable and a whole number from 0 to 359', () => {
    const id = '5b2f3c1e-8a4d-4f7e-9c21-0d6a1b2c3d4e';
    expect(hueFor(id)).toBe(hueFor(id));
    for (const x of ['', 'a', id, 'user_2abc']) {
      const hue = hueFor(x);
      expect(Number.isInteger(hue)).toBe(true);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it('spreads different ids apart', () => {
    const hues = new Set(Array.from({ length: 50 }, (_, i) => hueFor(`user-${i}`)));
    expect(hues.size).toBeGreaterThan(30);
  });
});
