// Interval maths on UTC epoch milliseconds. Every interval is half-open: `[start, end)`.

/**
 * A half-open span of time, `[start, end)`, in UTC epoch milliseconds.
 *
 * `start` is included and `end` is not, so `[9:00, 10:00)` and `[10:00, 11:00)` touch but
 * don't overlap. An interval with `end <= start` is empty.
 */
export interface Interval {
  readonly start: number;
  readonly end: number;
}

/**
 * Sorts intervals, drops empty ones and merges any that overlap or touch.
 *
 * The result is the canonical form every other function here returns: sorted by `start`,
 * non-empty, and with a gap between each interval and the next. Merging is idempotent.
 */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [];
  for (const { start, end } of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last.end) {
      if (end > last.end) merged[merged.length - 1] = { start: last.start, end };
    } else {
      merged.push({ start, end });
    }
  }
  return merged;
}

/** Everything covered by `a` or `b`, merged. */
export function unionIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  return mergeIntervals([...a, ...b]);
}

/** The times covered by both `a` and `b`, merged. */
export function intersectIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const x = mergeIntervals(a);
  const y = mergeIntervals(b);
  const result: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    const p = x[i] as Interval;
    const q = y[j] as Interval;
    const start = Math.max(p.start, q.start);
    const end = Math.min(p.end, q.end);
    if (start < end) result.push({ start, end });
    if (p.end < q.end) i++;
    else j++;
  }
  return result;
}

/** The times covered by `a` but not by `b`, merged. */
export function subtractIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const cut = mergeIntervals(b);
  const result: Interval[] = [];
  let j = 0;
  for (const { start, end } of mergeIntervals(a)) {
    let cursor = start;
    // Skip holes that end before this interval starts. They can't affect later intervals either.
    while (j < cut.length && (cut[j] as Interval).end <= cursor) j++;
    let k = j;
    while (k < cut.length && (cut[k] as Interval).start < end) {
      const hole = cut[k] as Interval;
      if (hole.start > cursor) result.push({ start: cursor, end: hole.start });
      cursor = Math.max(cursor, hole.end);
      k++;
    }
    if (cursor < end) result.push({ start: cursor, end });
  }
  return result;
}

/** The parts of `range` not covered by `intervals`, merged. */
export function complementIntervals(intervals: readonly Interval[], range: Interval): Interval[] {
  return subtractIntervals([range], intervals);
}

/** Whether `t` falls inside `interval` (`start` included, `end` excluded). */
export function containsInstant(interval: Interval, t: number): boolean {
  return interval.start <= t && t < interval.end;
}

/** Whether two intervals share any time. Touching intervals don't overlap. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end && a.start < a.end && b.start < b.end;
}
