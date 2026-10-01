// SQLSTATE codes our database functions raise for user-facing failures.
// supabase-js puts the SQLSTATE in `error.code`; map these to UI messages.
// Anything else (e.g. 22023 for a bad argument, 42501 for no permission) is a
// bug in the caller, not something to show the user.

export const DB_ERROR = {
  /** The token is valid but there is no `users` row yet (sign-up not finished). */
  noAccount: 'WF001',
  /** Handle fails the format rules (length, characters). */
  handleInvalid: 'WF101',
  /** Handle is a reserved word. */
  handleReserved: 'WF102',
  /** Handle is already someone else's (ignoring case). */
  handleTaken: 'WF103',
  /**
   * No such user. Also returned when either person has blocked the other, so a
   * blocked user can't tell (FR-SOC-6). Show "We couldn't find that person".
   */
  userNotFound: 'WF201',
  /** You tried to friend yourself. */
  cannotTargetSelf: 'WF202',
  /** You're already friends. */
  alreadyFriends: 'WF203',
  /** You've already sent this person a request that is still pending. */
  requestAlreadySent: 'WF204',
  /** There is no pending request from this person to accept (withdrawn, or already handled). */
  requestNotFound: 'WF205',
  /** You have blocked this person; unblock them first. Only ever sent to the blocker. */
  blockedByYou: 'WF206',
  /**
   * `commit_schedule` (WF-030): the draft breaks a `ScheduleCommit` rule or has an unknown
   * field. Clients check it with zod first, so this is a bug, not something the user can fix
   * by retrying. The message names the field (e.g. `events[3].start`), never its value.
   */
  scheduleInvalid: 'WF301',
  /**
   * `commit_schedule` (WF-030): an event never happens inside the schedule's dates (its days
   * or weeks all fall outside them, or its date does). `error.details` is JSON
   * `{ "event": <0-based index into draft.events> }`, so the UI can point at it.
   */
  scheduleEventOutsidePeriod: 'WF302',
  /**
   * Rate limited (NFR-SEC-9): "Slow down". PostgREST returns HTTP 429. The error
   * `details` is JSON: `{ action, limit, retry_at }`.
   */
  rateLimited: 'PT429',
} as const;

export type DbErrorCode = (typeof DB_ERROR)[keyof typeof DB_ERROR];
