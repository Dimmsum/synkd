// What the screens say about uploads and parse jobs (FR-IMP-13, FR-IMP-14, FR-IMP-19). Pure and
// client-safe: the upload card, Pending uploads and the server actions share it.

import { PARSE_ATTEMPTS_PER_DAY, type ParseErrorCode, type ParseJobStatus } from '@synkd/shared';

/** Why a parse failed, in words, with what to try (FR-IMP-14). */
export function parseFailureMessage(code: ParseErrorCode | null): string {
  switch (code) {
    case 'unsupported_file':
      return 'That file isn’t a PDF, photo or screenshot we can read. Try a different file.';
    case 'file_too_large':
      return 'That file is over 10 MB. Try a smaller photo or a PDF.';
    case 'too_many_pages':
      return 'That PDF has more than 5 pages. Upload just the pages with your schedule.';
    case 'image_too_large':
      return 'That image is too big to read. Try a screenshot or a smaller photo.';
    case 'unreadable_file':
      return 'We couldn’t open that file. It may be damaged or password-protected.';
    case 'file_missing':
      return 'The upload didn’t finish. Try uploading it again.';
    case 'no_schedule_found':
      return 'We couldn’t find a schedule in that file. Try a clearer photo, or enter it by hand.';
    case 'timed_out':
      return 'Reading that file took too long. Try again, or try a different file.';
    case 'parse_failed':
    case null:
      return 'We couldn’t read a schedule in that file.';
  }
}

/**
 * Whether the file itself can't be used (wrong type, too big, damaged), so nothing can ever be
 * done with it: it's deleted straight away instead of waiting out its 7 days (D38, WF-136).
 */
export function isRejectedFile(code: ParseErrorCode | null): boolean {
  return (
    code === 'unsupported_file' ||
    code === 'file_too_large' ||
    code === 'too_many_pages' ||
    code === 'image_too_large' ||
    code === 'unreadable_file'
  );
}

/** Whether "Try again" with the same file could help (FR-IMP-14). */
export function canRetry(code: ParseErrorCode | null): boolean {
  return (
    code === 'parse_failed' || code === 'timed_out' || code === 'file_missing' || code === null
  );
}

/** The one-line state of a pending upload (FR-IMP-13, FR-IMP-16). */
export function jobStateLabel(status: ParseJobStatus | null): string {
  switch (status) {
    case null:
      return 'Upload didn’t finish';
    case 'queued':
      return 'Waiting in line';
    case 'processing':
      return 'Reading your schedule';
    case 'needs_review':
      return 'Ready to review';
    case 'failed':
      return 'Couldn’t read it';
    case 'committed':
      return 'Saved';
  }
}

/** FR-IMP-19: the daily parse limit is used up. */
export const PARSE_LIMIT_MESSAGE = `You’ve used today’s ${PARSE_ATTEMPTS_PER_DAY} schedule reads. Try again tomorrow, or enter your schedule by hand.`;

/** Too many new uploads today (SCHEDULE_UPLOADS_PER_DAY). */
export const UPLOAD_LIMIT_MESSAGE =
  'You’ve uploaded a lot of files today. Try again tomorrow, or enter your schedule by hand.';

/** MAX_PENDING_UPLOADS reached. */
export const TOO_MANY_PENDING_MESSAGE =
  'You have too many uploads waiting. Confirm or delete one in Pending uploads first.';
