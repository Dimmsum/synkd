// Converting between UTC instants and wall-clock time in an IANA timezone (FR-AVL-9).
//
// This uses the platform's own tz database through `Intl.DateTimeFormat` rather than a library.
// The engine needs only two operations (instant → local date/time, local date/time → instant),
// and doing them here keeps the package dependency-free and lets us choose the DST rules
// explicitly (see `localToUtc`). Calendar dates are handled as "day numbers": whole days since
// 1970-01-01, which makes date arithmetic plain integer maths with no timezone involved.

import { DAYS_OF_WEEK, type DayOfWeek } from '@synkd/shared';

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    // Throws a RangeError for an unknown timezone, which is what we want.
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The UTC offset in ms (local = utc + offset) in effect at instant `t`. */
export function offsetAt(t: number, timeZone: string): number {
  const f = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of formatterFor(timeZone).formatToParts(t)) {
    if (part.type in f) f[part.type as keyof typeof f] = Number(part.value);
  }
  const wall = new Date(0);
  wall.setUTCFullYear(f.year, f.month - 1, f.day);
  wall.setUTCHours(f.hour, f.minute, f.second, 0);
  // Intl drops milliseconds, so compare against `t` rounded down to the second.
  return wall.getTime() - Math.floor(t / 1000) * 1000;
}

/** The local wall-clock time of `t` as if it were UTC ("floating" local time), in ms. */
export function toLocalMs(t: number, timeZone: string): number {
  return t + offsetAt(t, timeZone);
}

/** The local calendar day (as a day number) that instant `t` falls on. */
export function localDayOf(t: number, timeZone: string): number {
  return Math.floor(toLocalMs(t, timeZone) / DAY_MS);
}

/**
 * The instant at which the wall clock in `timeZone` shows `day` + `msOfDay`.
 *
 * DST is resolved the way Temporal's default (`'compatible'`) does, and the way people expect:
 * - a time skipped by spring-forward (e.g. 02:30 in New York) moves forward by the size of
 *   the gap (03:30);
 * - a time that happens twice at fall-back (01:30) means the first one (daylight time).
 *
 * `msOfDay` may be 24 h or more to mean a time on a later day.
 */
export function localToUtc(day: number, msOfDay: number, timeZone: string): number {
  const local = day * DAY_MS + msOfDay;
  // Intl is slow (~10 µs a call) and the same wall times come up again and again (everyone's
  // 08:00 and 22:00, classes on the hour), so remember answers. This is plain memoisation of
  // a pure function; the cache is emptied when it fills so it can't grow without limit.
  let cache = utcCache.get(timeZone);
  if (!cache) {
    cache = new Map();
    utcCache.set(timeZone, cache);
  }
  let t = cache.get(local);
  if (t === undefined) {
    t = resolveLocal(local, timeZone);
    if (cache.size >= MAX_CACHED_CONVERSIONS) cache.clear();
    cache.set(local, t);
  }
  return t;
}

/** Most wall times remembered per timezone by `localToUtc`. */
export const MAX_CACHED_CONVERSIONS = 10_000;
const utcCache = new Map<string, Map<number, number>>();

function resolveLocal(local: number, timeZone: string): number {
  // At most one transition can happen near `local`, so the offsets a day either side are the
  // only candidates. Almost always they're the same and there's nothing to resolve.
  const before = offsetAt(local - DAY_MS, timeZone);
  const after = offsetAt(local + DAY_MS, timeZone);
  if (before === after) return local - before;
  const withBefore = local - before;
  const withAfter = local - after;
  const valid = [withBefore, withAfter].filter((t) => toLocalMs(t, timeZone) === local);
  // Overlap (fall-back): both are valid, take the first. Gap (spring-forward): neither is valid,
  // so read the wall time with the pre-transition offset, which lands after the gap.
  return valid.length > 0 ? Math.min(...valid) : withBefore;
}

/** The day number of a `YYYY-MM-DD` date. */
export function dayFromDate(date: string): number {
  const day = Date.parse(`${date}T00:00:00Z`) / DAY_MS;
  // The round trip rejects dates that `Date.parse` rolls over, like 2026-02-30.
  if (!Number.isInteger(day) || dateFromDay(day) !== date) {
    throw new RangeError(`Invalid date: ${date}`);
  }
  return day;
}

/** The `YYYY-MM-DD` date of a day number. */
export function dateFromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Monday = 0 … Sunday = 6, matching `DAYS_OF_WEEK`. 1970-01-01 was a Thursday. */
export function weekdayOf(day: number): number {
  return (((day + 3) % 7) + 7) % 7;
}

/** The `DAYS_OF_WEEK` index of a day name. */
export function weekdayIndex(day: DayOfWeek): number {
  return DAYS_OF_WEEK.indexOf(day);
}

/** Milliseconds since midnight for an `HH:MM` wall-clock time. */
export function msFromLocalTime(time: string): number {
  if (!/^\d\d:\d\d$/.test(time)) throw new RangeError(`Invalid time: ${time}`);
  return (Number(time.slice(0, 2)) * 60 + Number(time.slice(3))) * MINUTE_MS;
}
