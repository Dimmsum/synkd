// Available hours (FR-AVL-2, D24): the part of each local day a user is willing to show as free.

import { DAYS_OF_WEEK, DEFAULT_AVAILABLE_HOURS, type AvailableHours } from '@whosfree/shared';
import { mergeIntervals, type Interval } from './interval';
import { localDayOf, localToUtc, msFromLocalTime, weekdayOf } from './time';

/** The default available hours: 08:00–22:00 every day (D24). Returns a fresh array. */
export function defaultAvailableHours(): AvailableHours[] {
  return DAYS_OF_WEEK.map((day) => ({ day, ...DEFAULT_AVAILABLE_HOURS }));
}

/**
 * The instants inside `range` that fall within the given daily local-time windows.
 *
 * Each window is read as wall-clock time in `timeZone` on its own date, so 08:00–22:00 stays
 * 08:00–22:00 local on DST-change days (the window is then 13 or 15 hours long). A weekday
 * with no window contributes nothing. Used for available hours, and by the slot finder for its
 * optional time-of-day window (FR-SLOT-1).
 */
export function availableHoursIntervals(
  hours: readonly AvailableHours[],
  range: Interval,
  timeZone: string,
): Interval[] {
  if (range.end <= range.start || hours.length === 0) return [];
  const byWeekday = DAYS_OF_WEEK.map((day) =>
    hours
      .filter((h) => h.day === day)
      .map((h) => ({ start: msFromLocalTime(h.start), end: msFromLocalTime(h.end) })),
  );
  const intervals: Interval[] = [];
  // One day of margin either side: a local day can start before or end after the UTC day.
  const lastDay = localDayOf(range.end, timeZone) + 1;
  for (let day = localDayOf(range.start, timeZone) - 1; day <= lastDay; day++) {
    for (const window of byWeekday[weekdayOf(day)] as Interval[]) {
      const start = Math.max(range.start, localToUtc(day, window.start, timeZone));
      const end = Math.min(range.end, localToUtc(day, window.end, timeZone));
      if (start < end) intervals.push({ start, end });
    }
  }
  return mergeIntervals(intervals);
}
