// The viewer's offline friends (D44, WF-127, WF-128): people who aren't on whosfree, added by
// the viewer. Read as the signed-in user: `list_offline_friends` runs under RLS, and their
// `sources`/`events` are read directly under RLS filtered by `offline_friend_id`, so only the
// viewer's own rows ever come back (FR-SOC-15). These rows never feed the viewer's own status:
// lib/data/now.ts and lib/data/schedule.ts keep their `offline_friend_id is null` filters.
//
// Only error codes go into thrown errors and logs, never nicknames or titles (NFR-SEC-11).

import 'server-only';
import { cache } from 'react';
import { DEFAULT_UNTIL_HORIZON_MS } from '@whosfree/availability';
import type { OfflineFriend } from '@whosfree/backend';
import { addDays, zonedTimeToInstant } from '@whosfree/ui/lib/time';
import { getViewerRow, requestNow } from '@/lib/data/now';
import {
  describeSources,
  scheduleOnDates,
  type StoredEvent,
  type StoredSource,
} from '@/lib/my-schedule';
import { offlineFriendsNow, type OfflineScheduleRows } from '@/lib/presence/offline-friends';
import { errorCode } from '@/lib/presence/compute';
import { isUuid } from '@/lib/social/mappers';
import { createServerSupabase } from '@/lib/supabase/server';
import type { MyEvent, OfflineFriendView, ScheduleSource } from '@/lib/types';

const SCHEDULE_SOURCE_COLUMNS = 'id, type, status, period_start, period_end, period_exceptions';
const SCHEDULE_EVENT_COLUMNS =
  'id, source_id, title, category, starts_at, ends_at, rrule, exdates, busy' as const;

/** The viewer's offline friends, oldest first (`list_offline_friends`). */
export const listOfflineFriends = cache(async (): Promise<OfflineFriend[]> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('list_offline_friends');
  if (error) throw new Error(`list_offline_friends failed (${error.code})`);
  return data as OfflineFriend[];
});

/** One of the viewer's offline friends, or null (also for anyone else's id). */
export async function getOfflineFriendRow(id: string): Promise<OfflineFriend | null> {
  if (!isUuid(id)) return null;
  return (await listOfflineFriends()).find((f) => f.id === id) ?? null;
}

/**
 * The offline friends' sources and the busy events that can touch `[start, end)`: one-offs
 * overlapping it, and recurring events that started before its end. `offlineFriendId` narrows
 * it to one of them.
 */
async function offlineScheduleRows(
  start: string,
  end: string,
  offlineFriendId?: string,
): Promise<OfflineScheduleRows> {
  const supabase = await createServerSupabase();
  const sourceQuery = supabase
    .from('sources')
    .select('id, offline_friend_id, period_start, period_end, period_exceptions');
  const eventQuery = supabase
    .from('events')
    .select(
      'id, source_id, offline_friend_id, starts_at, ends_at, rrule, exdates, busy, category, title',
    )
    .eq('busy', true)
    .lt('starts_at', end)
    .or(`rrule.not.is.null,ends_at.gt."${start}"`);
  const [sources, events] = await Promise.all([
    offlineFriendId
      ? sourceQuery.eq('offline_friend_id', offlineFriendId)
      : sourceQuery.not('offline_friend_id', 'is', null),
    offlineFriendId
      ? eventQuery.eq('offline_friend_id', offlineFriendId)
      : eventQuery.not('offline_friend_id', 'is', null),
  ]);
  const failed = sources.error ?? events.error;
  if (failed) throw new Error(`Reading offline friends' schedules failed (${failed.code})`);
  return { sources: sources.data ?? [], events: events.data ?? [] };
}

/**
 * Every offline friend with their status now and the changes ahead (WF-128), for the Now
 * screen's "Not on whosfree" section and the Friends page. Worked out at the same instant as
 * everyone else's. Null when they can't be read (the screens then leave them out rather than
 * fail).
 */
export const getOfflineFriendsNow = cache(async (): Promise<OfflineFriendView[] | null> => {
  try {
    const friends = await listOfflineFriends();
    if (friends.length === 0) return [];
    const now = requestNow();
    const [{ timezone }, rows] = await Promise.all([
      getViewerRow(),
      offlineScheduleRows(
        new Date(now).toISOString(),
        new Date(now + DEFAULT_UNTIL_HORIZON_MS).toISOString(),
      ),
    ]);
    const result = offlineFriendsNow(friends, rows, timezone, now);
    for (const code of result.errors) {
      console.warn('Offline friends: a status could not be worked out', code);
    }
    return result.friends;
  } catch (err) {
    console.warn('Offline friends: statuses unavailable', errorCode(err));
    return null;
  }
});

/** One offline friend with their status now (WF-128 detail page), or null if not the viewer's. */
export async function getOfflineFriend(id: string): Promise<OfflineFriendView | null> {
  if (!isUuid(id)) return null;
  const all = await getOfflineFriendsNow();
  if (all) return all.find((f) => f.id === id) ?? null;
  // Statuses unavailable: still show who they are.
  const row = await getOfflineFriendRow(id);
  return row
    ? {
        id: row.id,
        nickname: row.nickname,
        emoji: row.emoji,
        hasSchedule: row.has_schedule,
        status: 'unknown',
        until: null,
        nextFreeAt: null,
      }
    : null;
}

/**
 * An offline friend's schedule on the given consecutive dates (WF-128), expanded in the
 * viewer's timezone like My schedule, and where it came from. The viewer added it, so they see
 * the titles (FR-SOC-15).
 */
export async function getOfflineFriendSchedule(
  id: string,
  dates: string[],
): Promise<{ events: MyEvent[]; sources: ScheduleSource[] }> {
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!isUuid(id) || first === undefined || last === undefined) return { events: [], sources: [] };
  const supabase = await createServerSupabase();
  const [{ timezone: timeZone }, sources] = await Promise.all([
    getViewerRow(),
    supabase
      .from('sources')
      .select(SCHEDULE_SOURCE_COLUMNS)
      .eq('offline_friend_id', id)
      .order('created_at'),
  ]);
  if (sources.error) throw new Error(`Reading their schedule failed (${sources.error.code})`);
  if (sources.data.length === 0) return { events: [], sources: [] };

  const rangeStart = zonedTimeToInstant(first, 0, timeZone).toISOString();
  const rangeEnd = zonedTimeToInstant(addDays(last, 1), 0, timeZone).toISOString();
  const [inRange, counts] = await Promise.all([
    supabase
      .from('events')
      .select(SCHEDULE_EVENT_COLUMNS)
      .eq('offline_friend_id', id)
      .lt('starts_at', rangeEnd)
      .or(`rrule.not.is.null,ends_at.gt."${rangeStart}"`),
    supabase.from('events').select('source_id').eq('offline_friend_id', id),
  ]);
  const failed = inRange.error ?? counts.error;
  if (failed) throw new Error(`Reading their events failed (${failed.code})`);
  const stored: StoredSource[] = sources.data;
  return {
    events: scheduleOnDates(stored, (inRange.data ?? []) as StoredEvent[], dates, timeZone),
    // Uploaded or typed in only: they have no Google Calendar (FR-SOC-14).
    sources: describeSources(stored, counts.data ?? []).filter((s) => s.type !== 'gcal'),
  };
}
