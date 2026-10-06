// Available hours (FR-AVL-2, D24, WF-062): converting between what the database stores and what
// the editors show. Pure, so it can be tested without a database.
//
// `availability_prefs.weekly` is `AvailableHours[]` from @synkd/shared: at most one window per
// day, no overnight windows (end after start), in mon..sun order. A day with no entry is not
// available at all, and the availability engine shows it as Away all day. The editors show all
// seven days with an on/off switch instead.

import {
  AvailableHours,
  DAYS_OF_WEEK,
  DEFAULT_AVAILABLE_HOURS,
  type DayOfWeek,
} from '@synkd/shared';
import type { AvailableHoursDay } from '@/lib/types';

/**
 * The stored week as one row per day, mon..sun. A missing day is switched off; it carries the
 * default 08:00–22:00 (D24) so switching it back on starts from sensible times. Entries that
 * don't pass the shared schema are treated as missing (the database trigger already rejects them).
 */
export function weeklyToDays(weekly: unknown): AvailableHoursDay[] {
  const byDay = new Map<DayOfWeek, AvailableHours>();
  if (Array.isArray(weekly)) {
    for (const entry of weekly) {
      const parsed = AvailableHours.safeParse(entry);
      if (parsed.success && !byDay.has(parsed.data.day)) byDay.set(parsed.data.day, parsed.data);
    }
  }
  return DAYS_OF_WEEK.map((day) => {
    const hours = byDay.get(day);
    return hours
      ? { day, enabled: true, start: hours.start, end: hours.end }
      : { day, enabled: false, ...DEFAULT_AVAILABLE_HOURS };
  });
}

export type WeeklyResult =
  | { ok: true; weekly: AvailableHours[] }
  | { ok: false; reason: 'invalid_day' | 'duplicate_day'; day?: string };

/**
 * The editors' rows as the value to store. Days switched off are left out (Away all day); each
 * day switched on must be a valid window with its end after its start. Output is mon..sun.
 */
export function daysToWeekly(days: readonly AvailableHoursDay[]): WeeklyResult {
  const seen = new Set<string>();
  const weekly: AvailableHours[] = [];
  for (const d of days) {
    if (seen.has(d.day)) return { ok: false, reason: 'duplicate_day', day: d.day };
    seen.add(d.day);
    if (!d.enabled) continue;
    const parsed = AvailableHours.safeParse({ day: d.day, start: d.start, end: d.end });
    if (!parsed.success) return { ok: false, reason: 'invalid_day', day: d.day };
    weekly.push(parsed.data);
  }
  weekly.sort((a, b) => DAYS_OF_WEEK.indexOf(a.day) - DAYS_OF_WEEK.indexOf(b.day));
  return { ok: true, weekly };
}
