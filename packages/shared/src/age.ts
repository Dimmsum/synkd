// Age gate (FR-AUTH-6, NFR-COMP-7, D13, D29).
//
// The full date of birth is checked here, on the Next.js server, and is never
// sent to the database: only the birth year is stored (`confirm_age`).
//
// "Today" is always passed in as a local calendar date, so the check is pure
// and testable. Use `localDateIn(Date.now())`, which defaults to
// America/Jamaica: the legal age boundary is a date on the calendar where the
// user lives, and the server clock (UTC on Vercel) runs up to five hours ahead
// of Jamaica, which would let someone in on the evening before their 18th
// birthday.

import type { z } from 'zod';
import { DEFAULT_TIMEZONE } from './constants';
import { LocalDate } from './schemas';

/** Minimum age to use the app (D13). */
export const MINIMUM_AGE = 18;

/** Oldest plausible age; older dates of birth are treated as typos. */
export const MAXIMUM_AGE = 120;

/** Earliest birth year the database accepts (`users.birth_year`). */
export const MIN_BIRTH_YEAR = 1900;

/** A date of birth as typed in the sign-up form: a real `YYYY-MM-DD` date, year 1900 or later. */
export const DateOfBirth = LocalDate.refine((d) => Number(d.slice(0, 4)) >= MIN_BIRTH_YEAR, {
  message: `Year must be ${MIN_BIRTH_YEAR} or later`,
});
export type DateOfBirth = z.infer<typeof DateOfBirth>;

/**
 * The person's age in completed years on `today`. Both arguments are `YYYY-MM-DD` local dates.
 *
 * Someone born on 29 February has their birthday on 1 March in non-leap years (the later of the
 * two usual conventions, so the gate never opens early). Throws a `RangeError` if either date is
 * invalid or `dateOfBirth` is after `today`.
 */
export function ageOn(dateOfBirth: string, today: string): number {
  if (!LocalDate.safeParse(dateOfBirth).success) {
    throw new RangeError(`Invalid date of birth: ${dateOfBirth}`);
  }
  if (!LocalDate.safeParse(today).success) throw new RangeError(`Invalid date: ${today}`);
  if (dateOfBirth > today) throw new RangeError('Date of birth is in the future');
  const years = Number(today.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
  // Compare month and day as "MM-DD" strings. 29 Feb vs a non-leap year: "02-28" < "02-29"
  // (birthday not reached) and "03-01" > "02-29" (reached), which is the 1 March rule.
  return today.slice(5) < dateOfBirth.slice(5) ? years - 1 : years;
}

/** Whether someone born on `dateOfBirth` is at least 18 on `today` (both `YYYY-MM-DD`). */
export function isAdult(dateOfBirth: string, today: string): boolean {
  return ageOn(dateOfBirth, today) >= MINIMUM_AGE;
}

/** Why a date of birth was refused. `under_age` is the only one to show as "you must be 18". */
export type AgeCheckFailure = 'invalid_date' | 'in_future' | 'implausible' | 'under_age';

export type AgeCheck =
  | { readonly ok: true; readonly birthYear: number }
  | { readonly ok: false; readonly reason: AgeCheckFailure };

/**
 * Checks a sign-up form's date of birth against `today` (a local `YYYY-MM-DD` date). On success
 * returns only the birth year, which is all that may be stored (D29). Throws a `RangeError` if
 * `today` is not a valid date (a bug in the caller, not bad user input).
 */
export function checkAge(dateOfBirth: unknown, today: string): AgeCheck {
  if (!LocalDate.safeParse(today).success) throw new RangeError(`Invalid date: ${today}`);
  const parsed = DateOfBirth.safeParse(dateOfBirth);
  if (!parsed.success) return { ok: false, reason: 'invalid_date' };
  const dob = parsed.data;
  if (dob > today) return { ok: false, reason: 'in_future' };
  const age = ageOn(dob, today);
  if (age > MAXIMUM_AGE) return { ok: false, reason: 'implausible' };
  if (age < MINIMUM_AGE) return { ok: false, reason: 'under_age' };
  return { ok: true, birthYear: Number(dob.slice(0, 4)) };
}

/** The local calendar date (`YYYY-MM-DD`) at `instant` in `timeZone` (default America/Jamaica). */
export function localDateIn(instant: number | Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
