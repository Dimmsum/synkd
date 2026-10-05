// Offline friends' statuses (D44, WF-128). Pure: the rows come from
// lib/data/offline-friends.ts (read under RLS, so only ever the viewer's own) and the engine runs
// through lib/presence/compute.ts, exactly as for the viewer's own status. Their rows never feed
// the viewer's own status (lib/data/now.ts filters `offline_friend_id is null`), and nothing here
// is ever sent to anyone else (FR-SOC-15).

import type { OfflineFriend } from '@synkd/backend';
import {
  computePresence,
  errorCode,
  offlineFriendPresenceInput,
  UNKNOWN_PRESENCE,
  type ComputedPresence,
  type OwnRows,
} from '@/lib/presence/compute';
import type { OfflineFriendView } from '@/lib/types';

/** The viewer's offline friends' sources and events (rows with `offline_friend_id` set). */
export type OfflineScheduleRows = Pick<OwnRows, 'sources' | 'events'>;

/** A `list_offline_friends` row with its worked-out status. */
export function toOfflineFriendView(
  friend: OfflineFriend,
  presence: ComputedPresence,
): OfflineFriendView {
  const { status, until, nextFreeAt, activity, upcoming, refreshAt } = presence;
  return {
    id: friend.id,
    nickname: friend.nickname,
    emoji: friend.emoji,
    hasSchedule: friend.has_schedule,
    status,
    until,
    nextFreeAt,
    ...(activity ? { activity } : {}),
    upcoming,
    refreshAt,
  };
}

/**
 * Every offline friend's status at `now` (WF-128): the availability engine over their own
 * schedule, in the viewer's timezone, with the default available hours 08:00–22:00 (D24). One
 * schedule the engine can't handle gives that friend `unknown`; `errors` holds codes that are
 * safe to log (never nicknames or titles, NFR-SEC-11).
 */
export function offlineFriendsNow(
  friends: readonly OfflineFriend[],
  rows: OfflineScheduleRows,
  timeZone: string,
  now: number,
): { friends: OfflineFriendView[]; errors: string[] } {
  const errors: string[] = [];
  const views = friends.map((f) => {
    let presence: ComputedPresence;
    try {
      presence = computePresence(
        offlineFriendPresenceInput(f.id, { timezone: timeZone, ...rows }),
        now,
      );
    } catch (err) {
      errors.push(errorCode(err));
      presence = UNKNOWN_PRESENCE;
    }
    return toOfflineFriendView(f, presence);
  });
  return { friends: views, errors };
}
