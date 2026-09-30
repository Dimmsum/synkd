import { LocalDate } from '@whosfree/shared';

/** Minimum age (D13, NFR-COMP-7). */
export const MIN_AGE = 18;

/** Whole years between a date of birth and `today` (both `YYYY-MM-DD`). */
export function ageOn(dateOfBirth: string, today: string): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  const hadBirthday = tm > bm || (tm === bm && td >= bd);
  return ty - by - (hadBirthday ? 0 : 1);
}

export type AgeCheck =
  { ok: true; birthYear: number } | { ok: false; reason: 'invalid' | 'future' | 'under_18' };

/**
 * Checks a self-declared date of birth (FR-AUTH-6, D29). Only `birthYear` comes out:
 * the full date is used for this check and never stored.
 * Someone born on Feb 29 turns 18 on Mar 1 in non-leap years.
 */
export function checkAge(dateOfBirth: string, today: string): AgeCheck {
  if (!LocalDate.safeParse(dateOfBirth).success) return { ok: false, reason: 'invalid' };
  if (dateOfBirth > today) return { ok: false, reason: 'future' };
  if (ageOn(dateOfBirth, today) < MIN_AGE) return { ok: false, reason: 'under_18' };
  return { ok: true, birthYear: Number(dateOfBirth.slice(0, 4)) };
}
