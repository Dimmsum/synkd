/**
 * Display helpers for times and dates.
 *
 * Everything is stored and computed in UTC (FR-AVL-9) and only converted here, for
 * display, into the viewer's timezone (default `America/Jamaica`, FR-AUTH-3). Every
 * function takes the timezone explicitly so server and client render the same text.
 */

export type Instant = Date | string | number;

/** A calendar date in some timezone, `YYYY-MM-DD`. */
export type DateKey = string;

const toDate = (i: Instant): Date => (i instanceof Date ? i : new Date(i));

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string) {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

/** The wall-clock fields of an instant in a timezone. */
export function zonedParts(instant: Instant, timeZone: string): ZonedParts {
  const out: Record<string, string> = {};
  for (const p of partsFormatter(timeZone).formatToParts(toDate(instant))) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAY_INDEX[out.weekday ?? 'Mon'] ?? 0,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The local calendar date of an instant, e.g. `2026-09-30`. */
export function dateKey(instant: Instant, timeZone: string): DateKey {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutes since local midnight (0–1439). */
export function minutesIntoDay(instant: Instant, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  return p.hour * 60 + p.minute;
}

/** Adds whole days to a date key (calendar arithmetic, no timezone involved). */
export function addDays(key: DateKey, days: number): DateKey {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Day of week for a date key, 0 = Monday … 6 = Sunday. */
export function weekdayOf(key: DateKey): number {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** The Monday on or before a date key. */
export function startOfWeek(key: DateKey): DateKey {
  return addDays(key, -weekdayOf(key));
}

/** Whole days from `a` to `b` (positive if `b` is later). */
export function daysBetween(a: DateKey, b: DateKey): number {
  const ms = (k: DateKey) => {
    const [y, m, d] = k.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

/**
 * The instant at which it is `minutes` past midnight on `key` in `timeZone`.
 * Two passes handle any fixed or DST offset.
 */
export function zonedTimeToInstant(key: DateKey, minutes: number, timeZone: string): Date {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const wallAsUtc = Date.UTC(y, m - 1, d, 0, minutes);
  const offsetAt = (t: number) => {
    const p = zonedParts(t, timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t;
  };
  let t = wallAsUtc - offsetAt(wallAsUtc);
  t = wallAsUtc - offsetAt(t);
  return new Date(t);
}

/** "2:30 PM" for minutes since midnight (1440 reads as midnight). */
export function formatClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h % 12 || 12;
  return `${h12}:${pad(mm)} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Compact hour label for grids: "8 AM", "12 PM", "3:30 PM". */
export function formatHourLabel(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h % 12 || 12;
  return `${h12}${mm ? `:${pad(mm)}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * "9:00 – 10:30 AM" when both ends share AM/PM, otherwise "11:00 AM – 1:00 PM".
 * Uses an en dash with thin spacing like the design.
 */
export function formatClockRange(startMinutes: number, endMinutes: number): string {
  const s = formatClock(startMinutes);
  const e = formatClock(endMinutes);
  const sameMeridiem = s.slice(-2) === e.slice(-2);
  return `${sameMeridiem ? s.slice(0, -3) : s} – ${e}`;
}

/** "2:30 PM" for an instant in the viewer's timezone. */
export function formatTime(instant: Instant, timeZone: string): string {
  return formatClock(minutesIntoDay(instant, timeZone));
}

export function formatTimeRange(start: Instant, end: Instant, timeZone: string): string {
  return formatClockRange(minutesIntoDay(start, timeZone), minutesIntoDay(end, timeZone));
}

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const WEEKDAY_LONG = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export function weekdayShort(key: DateKey): string {
  return WEEKDAY_SHORT[weekdayOf(key)] ?? '';
}

export function weekdayLong(key: DateKey): string {
  return WEEKDAY_LONG[weekdayOf(key)] ?? '';
}

/** "Sep 30" */
export function formatMonthDay(key: DateKey): string {
  const [, m, d] = key.split('-').map(Number) as [number, number, number];
  return `${MONTH_SHORT[m - 1]} ${d}`;
}

/** "Today", "Tomorrow", "Yesterday", or the weekday name within a week, else "Wed, Oct 7". */
export function formatDayLabel(key: DateKey, todayKey: DateKey): string {
  const diff = daysBetween(todayKey, key);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return weekdayLong(key);
  return `${weekdayShort(key)}, ${formatMonthDay(key)}`;
}

/** "Sep 28 – Oct 4, 2026" for a week starting on `start`. */
export function formatWeekRange(start: DateKey): string {
  const end = addDays(start, 6);
  const [sy, sm] = start.split('-').map(Number) as [number, number, number];
  const [ey, em, ed] = end.split('-').map(Number) as [number, number, number];
  const endLabel = sm === em && sy === ey ? String(ed) : formatMonthDay(end);
  return `${formatMonthDay(start)} – ${endLabel}, ${ey}`;
}

/**
 * The "until X" part of a status (D18): "2:00 PM" today, "8:00 AM tomorrow",
 * or "Thu 8:00 AM" further out.
 */
export function formatUntil(until: Instant, now: Instant, timeZone: string): string {
  const time = formatTime(until, timeZone);
  const diff = daysBetween(dateKey(now, timeZone), dateKey(until, timeZone));
  if (diff === 0) return time;
  if (diff === 1) return `${time} tomorrow`;
  return `${weekdayShort(dateKey(until, timeZone))} ${time}`;
}

/** "30 min", "1 hr", "1 hr 30 min", "2.5 hr" style used in the design ("2 hr"). */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

/** "just now", "5 min ago", "2 hr ago", "Yesterday", "3 days ago". */
export function formatAgo(then: Instant, now: Instant): string {
  const mins = Math.floor((toDate(now).getTime() - toDate(then).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}
