// Friendly messages for the database errors settings, status and schedule writes can hit (WF-040,
// WF-062, WF-063, WF-030). supabase-js puts the SQLSTATE in `error.code`; our functions raise the
// codes listed in packages/backend/src/errors.ts. Pure: the actions pass in the code and show what
// comes back. Messages never repeat what the user typed (NFR-SEC-11 applies to logs, and we keep UI
// errors just as plain), except that a schedule error may name the user's own event on their own
// screen so they can find it. Never log these messages.

import { DB_ERROR } from '@whosfree/backend';
import { outsideMessage } from './schedule-draft';

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
      // STATUS_CHANGES_PER_HOUR (NFR-SEC-9): the window is an hour, so "a moment" would mislead.
      return 'You’ve changed your status a lot this hour. Try again a little later.';
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

/**
 * `commit_schedule` (WF-030, WF-031). `details` is the error's detail string: for an event that
 * never happens in the period (WF402) it's `{"event": index}`, used with the draft to name it.
 */
export function scheduleErrorMessage(
  code: string | undefined,
  details: string | undefined,
  draft: { events: readonly { title: string }[]; period: { start: string; end: string } },
): string {
  switch (code) {
    case DB_ERROR.scheduleEventOutsidePeriod: {
      let index: unknown;
      try {
        index = (JSON.parse(details ?? 'null') as { event?: unknown } | null)?.event;
      } catch {
        index = undefined;
      }
      const title = typeof index === 'number' ? draft.events[index]?.title : undefined;
      return outsideMessage(title, draft.period);
    }
    case DB_ERROR.scheduleInvalid:
      return 'Something in this schedule isn’t right. Check your events and dates, then try again.';
    case PG.notFound:
      return 'We couldn’t find that friend. They may have been removed.';
    case DB_ERROR.rateLimited:
      return 'You’ve saved a schedule a lot today. Try again tomorrow.';
    case DB_ERROR.noAccount:
      return NO_ACCOUNT;
    default:
      return TRY_AGAIN;
  }
}
