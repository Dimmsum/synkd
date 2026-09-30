// Friendly messages for the database errors settings and status writes can hit (WF-040, WF-062,
// WF-063). supabase-js puts the SQLSTATE in `error.code`; our functions raise the codes listed in
// packages/backend/src/errors.ts. Pure: the actions pass in the code and show what comes back.
// Messages never repeat what the user typed (NFR-SEC-11 applies to logs, and we keep UI errors
// just as plain).

import { DB_ERROR } from '@whosfree/backend';

export const TRY_AGAIN = 'Something went wrong on our side. Try again.';
const NO_ACCOUNT = 'Finish signing up first, then try again.';

/** Postgres codes raised by constraints and triggers on plain updates. */
const PG = {
  checkViolation: '23514',
  invalidParameter: '22023',
  notFound: 'P0002',
} as const;

/** `set_handle` and the profile update (FR-AUTH-2, WF-040). */
export function profileErrorMessage(code: string | undefined): string {
  switch (code) {
    case DB_ERROR.handleInvalid:
      return 'Handles are 3–30 letters, numbers or underscores, starting with a letter.';
    case DB_ERROR.handleReserved:
      return 'That handle is reserved. Try another.';
    case DB_ERROR.handleTaken:
      return 'That handle is taken. Try another.';
    case DB_ERROR.rateLimited:
      return 'You’ve changed your handle a lot today. Try again tomorrow.';
    case DB_ERROR.noAccount:
      return NO_ACCOUNT;
    case PG.checkViolation:
      return 'Names are 1–100 characters.';
    case PG.invalidParameter:
      return 'Pick a timezone from the list.';
    default:
      return TRY_AGAIN;
  }
}

/** `set_status` and `clear_status` (FR-AVL-3, WF-063). */
export function statusErrorMessage(code: string | undefined): string {
  switch (code) {
    case PG.invalidParameter:
      return 'Check the end time and note, then try again.';
    case DB_ERROR.rateLimited:
      return 'You’re changing your status a lot. Wait a moment and try again.';
    case DB_ERROR.noAccount:
    case PG.notFound:
      return NO_ACCOUNT;
    default:
      return TRY_AGAIN;
  }
}

/** Saving `availability_prefs.weekly` (FR-AVL-2, WF-062). */
export function hoursErrorMessage(code: string | undefined): string {
  switch (code) {
    case PG.invalidParameter:
      return 'Each day’s end time must be after its start time.';
    case DB_ERROR.noAccount:
    case PG.notFound:
      return NO_ACCOUNT;
    default:
      return TRY_AGAIN;
  }
}
