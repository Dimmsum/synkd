// Postgres errors from the social functions (WF-040 to WF-047) → what the user reads.
//
// Mapped by SQLSTATE first (`DB_ERROR` in @whosfree/backend). The group, invite and join
// functions share a few generic SQLSTATEs (P0001 a group rule, P0002 not found, 22023 bad
// argument), so for those the stable message from `GROUP_ERRORS` picks the wording. Anything
// else is a bug or an outage: the caller logs only the code (NFR-SEC-11) and shows TRY_AGAIN.

import { DB_ERROR, GROUP_ERRORS } from '@whosfree/backend';

/** The fields of a PostgrestError we read. */
export interface DbError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

export const TRY_AGAIN = 'Something went wrong on our side. Try again.';

const BY_CODE: Record<string, string> = {
  [DB_ERROR.noAccount]: 'Finish signing up first.',
  // NFR-SEC-9: every abusable write is rate-limited.
  [DB_ERROR.rateLimited]: 'You’re doing that a lot. Take a break and try again later.',
  // Also what a blocked user gets, so they can't tell they were blocked (FR-SOC-6).
  [DB_ERROR.userNotFound]: 'We couldn’t find that person.',
  [DB_ERROR.cannotTargetSelf]: 'That’s you!',
  [DB_ERROR.alreadyFriends]: 'You’re already friends.',
  [DB_ERROR.requestAlreadySent]: 'You’ve already sent them a request.',
  [DB_ERROR.requestNotFound]: 'That request isn’t there any more.',
  [DB_ERROR.blockedByYou]: 'You’ve blocked this person. Unblock them first.',
  // Not allowed: a permission was taken away while the page was open (FR-SOC-8).
  '42501': 'You don’t have permission to do that any more.',
  // Join requests (FR-SOC-13) aren't built yet.
  '0A000': 'This group needs the admin’s approval to join, which isn’t available yet.',
};

const BY_MESSAGE: Record<string, string> = {
  [GROUP_ERRORS.groupNotFound]: 'That group doesn’t exist, or you’re not in it any more.',
  [GROUP_ERRORS.memberNotFound]: 'They’re not in this group any more.',
  [GROUP_ERRORS.inviteNotFound]: 'That invite link doesn’t work.',
  [GROUP_ERRORS.invalidName]: 'Give the group a name (up to 60 characters).',
  [GROUP_ERRORS.invalidEmoji]: 'Pick a single emoji.',
  [GROUP_ERRORS.invalidExpiry]: 'Pick an expiry in the future.',
  [GROUP_ERRORS.invalidMaxUses]: 'The use limit must be between 1 and 1000.',
  [GROUP_ERRORS.transferToSelf]: 'Choose another member to become admin.',
  // FR-SOC-7: one admin per group.
  [GROUP_ERRORS.mustTransferAdmin]: 'Make someone else admin before you leave.',
  [GROUP_ERRORS.adminNotRemovable]: 'The admin can’t be removed.',
  [GROUP_ERRORS.adminHasAllPermissions]: 'The admin always has every permission.',
  [GROUP_ERRORS.useLeaveGroup]: 'Use “Leave group” to leave.',
  [GROUP_ERRORS.alreadyMember]: 'You’re already in this group.',
  [GROUP_ERRORS.inviteRevoked]: 'This invite link has been turned off.',
  [GROUP_ERRORS.inviteExpired]: 'This invite link has expired.',
  [GROUP_ERRORS.inviteUsedUp]: 'This invite link has been used as many times as it can be.',
  [GROUP_ERRORS.groupFull]: 'This group is full',
};

/** SQLSTATEs whose wording depends on the message (see the header). */
const GENERIC_CODES = new Set(['P0001', 'P0002', '22023']);

/**
 * The message to show for a failed database call, or null when it isn't a user-facing error
 * (the caller then logs the code and shows TRY_AGAIN).
 */
export function knownDbErrorMessage(error: DbError): string | null {
  const code = error.code ?? '';
  const byCode = BY_CODE[code];
  if (byCode) return byCode;
  if (GENERIC_CODES.has(code) && error.message) {
    const byMessage = BY_MESSAGE[error.message];
    if (byMessage) return byMessage;
  }
  return null;
}

/** Like `knownDbErrorMessage`, with TRY_AGAIN for anything unexpected. */
export function dbErrorMessage(error: DbError): string {
  return knownDbErrorMessage(error) ?? TRY_AGAIN;
}

/** True for "You are already a member of this group" (join_group puts the group id in details). */
export function isAlreadyMember(error: DbError): boolean {
  return error.code === 'P0001' && error.message === GROUP_ERRORS.alreadyMember;
}
