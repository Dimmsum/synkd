// Database errors from the ping functions (WF-092, WF-093) → what the user reads. Pure. Mapped
// by SQLSTATE (`DB_ERROR` in @whosfree/backend), and by message for 22023 (`PING_ERRORS`).
// Messages never repeat what anyone typed (NFR-SEC-11), and "not connected" and "blocked" read
// the same, so nobody learns they were blocked (FR-SOC-6).

import { DB_ERROR, PING_ERRORS } from '@whosfree/backend';
import type { DbError } from '@/lib/social/errors';

export interface PingErrorInfo {
  message: string;
  /** WF302: the recipient isn't free; ask "Ping anyway?" and send again with `confirmed`. */
  needsConfirmation?: true;
}

/** FR-PING-1: why someone can't be pinged, from the status the database puts in `details`. */
function unavailableMessage(status: string | null | undefined): string {
  if (status === 'paused') return 'They’ve paused sharing, so they can’t be pinged right now.';
  return 'They’re on do not disturb, so they can’t be pinged right now.';
}

/** FR-PING-1: the "Ping anyway?" question for someone who isn't free. */
function confirmMessage(status: string | null | undefined): string {
  switch (status) {
    case 'away':
      return 'They’re away right now. Ping anyway?';
    case 'no_schedule':
      return 'They haven’t added a schedule yet, so they might be busy. Ping anyway?';
    default:
      return 'They’re busy right now. Ping anyway?';
  }
}

const BY_MESSAGE: Record<string, string> = {
  [PING_ERRORS.invalidText]: 'Keep it to 140 characters of plain text.',
  [PING_ERRORS.unknownTemplate]: 'Pick one of the quick messages.',
  [PING_ERRORS.emptyPing]: 'Pick a message or write one.',
  [PING_ERRORS.replyNeedsOne]: 'Pick a reply or write one.',
  [PING_ERRORS.unknownReply]: 'Pick a reply or write one.',
};

/**
 * What to show for a failed `send_ping`, `reply_to_ping` or `mark_pings_read`, or null when it
 * isn't a user-facing error (the caller then logs the code only and shows TRY_AGAIN).
 */
export function pingError(error: DbError): PingErrorInfo | null {
  switch (error.code) {
    case DB_ERROR.pingNeedsConfirmation:
      return { message: confirmMessage(error.details), needsConfirmation: true };
    case DB_ERROR.pingRecipientUnavailable:
      return { message: unavailableMessage(error.details) };
    case DB_ERROR.rateLimited:
      return { message: 'You’ve sent a lot of pings today. Try again tomorrow.' };
    // Also what a blocked sender and a stranger get (FR-SOC-6).
    case DB_ERROR.userNotFound:
      return { message: 'We couldn’t find that person.' };
    case DB_ERROR.cannotTargetSelf:
      return { message: 'That’s you!' };
    case DB_ERROR.blockedByYou:
      return { message: 'You’ve blocked this person. Unblock them first.' };
    case DB_ERROR.pingNotFound:
      return { message: 'This ping isn’t there any more.' };
    case DB_ERROR.pingAlreadyReplied:
      return { message: 'You’ve already replied to this ping.' };
    case DB_ERROR.noAccount:
      return { message: 'Finish signing up first.' };
    case '22023': {
      const byMessage = error.message ? BY_MESSAGE[error.message] : undefined;
      return byMessage ? { message: byMessage } : null;
    }
    default:
      return null;
  }
}
