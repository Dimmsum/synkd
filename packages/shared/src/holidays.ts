// Jamaican public holidays (FR-IMP-8, WF-030 P1 part): pre-filled as exceptions when someone
// confirms or types in a schedule, so classes and shifts don't show as busy on days off. The
// user sees the list and can remove any of them before confirming.
//
// The Holidays (Public General) Act lists ten holidays: New Year's Day, Ash Wednesday, Good
// Friday, Easter Monday, Labour Day (23 May), Emancipation Day (1 Aug), Independence Day
// (6 Aug), National Heroes Day (third Monday in October), Christmas Day and Boxing Day. A holiday
// that falls on a Sunday is kept on the following Monday (the next free day, if that Monday is
// already a holiday, as when Christmas is a Sunday). Saturdays are not moved. The government
// occasionally proclaims a different day by order; that can't be predicted, and the user can
// edit the pre-filled list.

import type { DateRange } from './schemas';

export interface PublicHoliday {
  /** The day off, `YYYY-MM-DD` (after moving a Sunday holiday to Monday). */
  readonly date: string;
  readonly name: string;
}

const DAY_MS = 86_400_000;

function toKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function utc(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day);
}

/** Easter Sunday (Gregorian), by the anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toKey(utc(year, month, day));
}

/** The holidays of one calendar year, in date order, with Sunday holidays moved. */
function holidaysInYear(year: number): PublicHoliday[] {
  const easter = Date.parse(`${easterSunday(year)}T00:00:00Z`);
  const oct1 = utc(year, 10, 1);
  // Third Monday in October: the first Monday (0 = Sunday … 1 = Monday) plus two weeks.
  const heroes = oct1 + (((8 - new Date(oct1).getUTCDay()) % 7) + 14) * DAY_MS;
  const statutory: [number, string][] = [
    [utc(year, 1, 1), "New Year's Day"],
    [easter - 46 * DAY_MS, 'Ash Wednesday'],
    [easter - 2 * DAY_MS, 'Good Friday'],
    [easter + DAY_MS, 'Easter Monday'],
    [utc(year, 5, 23), 'Labour Day'],
    [utc(year, 8, 1), 'Emancipation Day'],
    [utc(year, 8, 6), 'Independence Day'],
    [heroes, 'National Heroes Day'],
    [utc(year, 12, 25), 'Christmas Day'],
    [utc(year, 12, 26), 'Boxing Day'],
  ];
  const taken = new Set<number>(statutory.map(([d]) => d));
  const result: PublicHoliday[] = [];
  for (const [day, name] of statutory) {
    let observed = day;
    if (new Date(day).getUTCDay() === 0) {
      observed = day + DAY_MS;
      while (taken.has(observed)) observed += DAY_MS;
      taken.add(observed);
    }
    result.push({ date: toKey(observed), name: observed === day ? name : `${name} (observed)` });
  }
  return result.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

/**
 * Jamaican public holidays whose day off falls between `start` and `end` (`YYYY-MM-DD`,
 * inclusive), in date order. Empty when `end` is before `start`.
 */
export function jamaicanPublicHolidays(start: string, end: string): PublicHoliday[] {
  if (end < start) return [];
  const first = Number(start.slice(0, 4));
  const last = Number(end.slice(0, 4));
  const result: PublicHoliday[] = [];
  // A Sunday holiday late in December can move into the first days of the next year, so the
  // year before `start` is checked too.
  for (let year = first - 1; year <= last; year++) {
    for (const h of holidaysInYear(year)) if (h.date >= start && h.date <= end) result.push(h);
  }
  return result;
}

/** {@link jamaicanPublicHolidays} as one-day schedule exceptions, labelled with the holiday. */
export function jamaicanHolidayExceptions(start: string, end: string): DateRange[] {
  return jamaicanPublicHolidays(start, end).map((h) => ({
    start: h.date,
    end: h.date,
    label: h.name,
  }));
}
