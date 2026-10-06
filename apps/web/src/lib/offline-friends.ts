// Offline friends (D44, FR-SOC-14 to FR-SOC-19, WF-127, WF-128): people who aren't on synkd,
// added by the viewer with a nickname and given a schedule by upload or manual entry. Pure and
// safe for the browser: how they're ordered and described, the cap and error wording. Their
// statuses are worked out on the server (lib/presence/offline-friends.ts).

import type { Route } from 'next';
import { DB_ERROR, OFFLINE_FRIEND_ERRORS } from '@synkd/backend';
import { DEFAULT_AVAILABLE_HOURS, MAX_OFFLINE_FRIENDS } from '@synkd/shared';
import { formatClockRange, type Instant } from '@synkd/ui/lib/time';
import { describeStatus, type StatusText } from '@/lib/status';
import type { OfflineFriendView } from '@/lib/types';

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * The hours an offline friend can be free in, "8:00 AM – 10:00 PM": the default available hours
 * (D24), since they have no settings of their own (WF-128).
 */
export const OFFLINE_FRIEND_HOURS_LABEL = formatClockRange(
  minutes(DEFAULT_AVAILABLE_HOURS.start),
  minutes(DEFAULT_AVAILABLE_HOURS.end),
);

const ms = (iso: string | null) => (iso ? Date.parse(iso) : Infinity);
const rank = (f: OfflineFriendView) =>
  f.status === 'free' ? 0 : f.status === 'no_schedule' || f.status === 'unknown' ? 2 : 1;

/**
 * The "Not on synkd" section's order: free first (longest free time first), then busy or
 * away (free again soonest first), then anyone without a schedule; ties by nickname.
 */
export function sortOfflineFriends(friends: readonly OfflineFriendView[]): OfflineFriendView[] {
  return [...friends].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (rank(a) === 0 ? ms(b.until) - ms(a.until) : ms(a.nextFreeAt) - ms(b.nextFreeAt)) ||
      a.nickname.localeCompare(b.nickname),
  );
}

/**
 * The words for an offline friend's status: as for anyone else ("Free until 2:00 PM", always
 * with an icon, never colour alone, NFR-UX-1), except that a missing schedule is the viewer's
 * to add, not something the friend hasn't done.
 */
export function describeOfflineStatus(
  f: Pick<OfflineFriendView, 'status' | 'until' | 'nextFreeAt' | 'activity'>,
  now: Instant,
  timeZone: string,
): StatusText {
  if (f.status === 'no_schedule') return { tone: 'no_schedule', label: 'No schedule yet' };
  return describeStatus(f, now, timeZone);
}

/**
 * Friends, after someone has just become a friend: the page then offers to delete an offline
 * copy of them, if the viewer added one (FR-SOC-19).
 */
export const friendedHref = (personId: string) =>
  `/friends?friended=${encodeURIComponent(personId)}` as Route;

/** True while the viewer can add another offline friend (FR-SOC-18). */
export const canAddOfflineFriend = (count: number) => count < MAX_OFFLINE_FRIENDS;

/** What the add button says when the viewer is at the cap (FR-SOC-18). */
export const OFFLINE_FRIEND_LIMIT_MESSAGE = `You can add up to ${MAX_OFFLINE_FRIENDS} people who aren’t on synkd. Delete one to add someone new.`;

/** The fields of a PostgrestError we read. */
interface DbError {
  code?: string | null;
  message?: string | null;
}

/**
 * The message to show for a failed offline friend function (`create_`/`update_`/
 * `delete_offline_friend`), or null when it isn't a user-facing error: the caller then logs
 * the SQLSTATE only and shows a generic "try again". Never repeats what the user typed.
 */
export function offlineFriendErrorMessage(error: DbError): string | null {
  switch (error.code) {
    case DB_ERROR.noAccount:
      return 'Finish signing up first, then try again.';
    case DB_ERROR.rateLimited:
      return 'You’ve added a lot of people today. Try again tomorrow.';
    case 'P0001':
      return error.message === OFFLINE_FRIEND_ERRORS.limitReached
        ? OFFLINE_FRIEND_LIMIT_MESSAGE
        : null;
    case 'P0002':
      return 'We couldn’t find them. They may have been deleted already.';
    case '22023':
      switch (error.message) {
        case OFFLINE_FRIEND_ERRORS.permissionRequired:
          return 'Tick the box to confirm you have their permission.';
        case OFFLINE_FRIEND_ERRORS.invalidEmoji:
          return 'Pick a single emoji.';
        case OFFLINE_FRIEND_ERRORS.nicknameControlCharacters:
          return 'Nicknames can only use ordinary letters, numbers, spaces and emoji.';
        default:
          return 'Give them a nickname of 1 to 40 characters.';
      }
    default:
      return null;
  }
}
