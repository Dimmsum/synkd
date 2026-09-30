import { fc, test } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';
import {
  complementIntervals,
  containsInstant,
  intersectIntervals,
  mergeIntervals,
  overlaps,
  subtractIntervals,
  unionIntervals,
  type Interval,
} from './interval';

// Endpoints are small integers, so checking every integer instant in [LOW, HIGH) tells us
// exactly which time an interval list covers.
const LOW = -30;
const HIGH = 260;

const interval = fc
  .tuple(fc.integer({ min: -20, max: 200 }), fc.integer({ min: -10, max: 50 }))
  .map(([start, length]): Interval => ({ start, end: start + length }));
const intervals = fc.array(interval, { maxLength: 12 });
const range = fc
  .tuple(fc.integer({ min: -20, max: 200 }), fc.integer({ min: 1, max: 60 }))
  .map(([start, length]): Interval => ({ start, end: start + length }));

const covers = (list: readonly Interval[], t: number) => list.some((i) => containsInstant(i, t));

function coverage(list: readonly Interval[]): boolean[] {
  const result: boolean[] = [];
  for (let t = LOW; t < HIGH; t++) result.push(covers(list, t));
  return result;
}

function expectCanonical(list: readonly Interval[]) {
  for (const [i, current] of list.entries()) {
    expect(current.end).toBeGreaterThan(current.start);
    const next = list[i + 1];
    // Sorted, and a real gap between neighbours (touching intervals would have been merged).
    if (next) expect(next.start).toBeGreaterThan(current.end);
  }
}

describe('mergeIntervals', () => {
  it('merges overlapping and touching intervals and drops empty ones', () => {
    expect(
      mergeIntervals([
        { start: 10, end: 12 },
        { start: 1, end: 3 },
        { start: 3, end: 5 },
        { start: 4, end: 4 },
        { start: 11, end: 20 },
        { start: 30, end: 25 },
        { start: 2, end: 4 },
      ]),
    ).toEqual([
      { start: 1, end: 5 },
      { start: 10, end: 20 },
    ]);
  });

  it('returns [] for no input and does not mutate its input', () => {
    expect(mergeIntervals([])).toEqual([]);
    const input = [
      { start: 5, end: 6 },
      { start: 1, end: 2 },
    ];
    mergeIntervals(input);
    expect(input[0]).toEqual({ start: 5, end: 6 });
  });

  it('keeps a contained interval inside its container', () => {
    expect(
      mergeIntervals([
        { start: 0, end: 10 },
        { start: 2, end: 3 },
      ]),
    ).toEqual([{ start: 0, end: 10 }]);
  });

  test.prop([intervals])('is sorted, non-overlapping and non-empty', (list) => {
    expectCanonical(mergeIntervals(list));
  });

  test.prop([intervals])('covers exactly what the input covers', (list) => {
    expect(coverage(mergeIntervals(list))).toEqual(coverage(list));
  });

  test.prop([intervals])('is idempotent', (list) => {
    const once = mergeIntervals(list);
    expect(mergeIntervals(once)).toEqual(once);
  });

  test.prop([intervals])('does not depend on input order', (list) => {
    expect(mergeIntervals([...list].reverse())).toEqual(mergeIntervals(list));
  });
});

describe('unionIntervals', () => {
  test.prop([intervals, intervals])('covers a or b, and is commutative', (a, b) => {
    const union = unionIntervals(a, b);
    expectCanonical(union);
    expect(coverage(union)).toEqual(coverage(a).map((x, i) => x || coverage(b)[i]));
    expect(unionIntervals(b, a)).toEqual(union);
  });
});

describe('intersectIntervals', () => {
  it('keeps only shared time', () => {
    expect(
      intersectIntervals(
        [
          { start: 0, end: 10 },
          { start: 20, end: 30 },
        ],
        [
          { start: 5, end: 25 },
          { start: 30, end: 40 },
        ],
      ),
    ).toEqual([
      { start: 5, end: 10 },
      { start: 20, end: 25 },
    ]);
  });

  test.prop([intervals, intervals])('covers a and b, and is commutative', (a, b) => {
    const both = intersectIntervals(a, b);
    expectCanonical(both);
    const cb = coverage(b);
    expect(coverage(both)).toEqual(coverage(a).map((x, i) => x && cb[i]));
    expect(intersectIntervals(b, a)).toEqual(both);
  });

  test.prop([intervals])('with itself is the merged input', (a) => {
    expect(intersectIntervals(a, a)).toEqual(mergeIntervals(a));
  });

  test.prop([intervals, intervals, intervals])('distributes over union', (a, b, c) => {
    expect(intersectIntervals(a, unionIntervals(b, c))).toEqual(
      unionIntervals(intersectIntervals(a, b), intersectIntervals(a, c)),
    );
  });
});

describe('subtractIntervals', () => {
  it('cuts holes, including several holes in one interval and one hole across two', () => {
    expect(
      subtractIntervals(
        [
          { start: 0, end: 10 },
          { start: 12, end: 20 },
        ],
        [
          { start: 2, end: 3 },
          { start: 5, end: 6 },
          { start: 8, end: 14 },
        ],
      ),
    ).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
      { start: 6, end: 8 },
      { start: 14, end: 20 },
    ]);
  });

  test.prop([intervals, intervals])('covers a but not b', (a, b) => {
    const rest = subtractIntervals(a, b);
    expectCanonical(rest);
    const cb = coverage(b);
    expect(coverage(rest)).toEqual(coverage(a).map((x, i) => x && !cb[i]));
  });

  test.prop([intervals, intervals])('splits a into (a − b) and (a ∩ b) with no overlap', (a, b) => {
    const rest = subtractIntervals(a, b);
    const both = intersectIntervals(a, b);
    expect(intersectIntervals(rest, both)).toEqual([]);
    expect(unionIntervals(rest, both)).toEqual(mergeIntervals(a));
  });
});

describe('complementIntervals', () => {
  it('returns the gaps within the range', () => {
    expect(complementIntervals([{ start: 2, end: 4 }], { start: 0, end: 10 })).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 10 },
    ]);
    expect(complementIntervals([], { start: 0, end: 10 })).toEqual([{ start: 0, end: 10 }]);
    expect(complementIntervals([{ start: -5, end: 15 }], { start: 0, end: 10 })).toEqual([]);
  });

  test.prop([intervals, range])('together with the clipped input, tiles the range', (a, r) => {
    const gaps = complementIntervals(a, r);
    const inside = intersectIntervals(a, [r]);
    expect(intersectIntervals(gaps, inside)).toEqual([]);
    expect(unionIntervals(gaps, inside)).toEqual([r]);
  });

  test.prop([intervals, range])('applied twice gives the input clipped to the range', (a, r) => {
    expect(complementIntervals(complementIntervals(a, r), r)).toEqual(intersectIntervals(a, [r]));
  });

  test.prop([intervals, intervals, range])('obeys De Morgan’s laws', (a, b, r) => {
    expect(complementIntervals(unionIntervals(a, b), r)).toEqual(
      intersectIntervals(complementIntervals(a, r), complementIntervals(b, r)),
    );
    expect(complementIntervals(intersectIntervals(a, b), r)).toEqual(
      unionIntervals(complementIntervals(a, r), complementIntervals(b, r)),
    );
  });
});

describe('overlaps and containsInstant', () => {
  it('treats intervals as half-open', () => {
    const nine = { start: 9, end: 10 };
    expect(containsInstant(nine, 9)).toBe(true);
    expect(containsInstant(nine, 10)).toBe(false);
    expect(overlaps(nine, { start: 10, end: 11 })).toBe(false);
    expect(overlaps(nine, { start: 8, end: 10 })).toBe(true);
    expect(overlaps(nine, { start: 9, end: 9 })).toBe(false);
  });

  test.prop([interval, interval])('agrees with intersecting', (a, b) => {
    expect(overlaps(a, b)).toBe(intersectIntervals([a], [b]).length > 0);
  });
});
