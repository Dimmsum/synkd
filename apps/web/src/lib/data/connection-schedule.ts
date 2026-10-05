// Someone else's day or week calendar (FR-VIEW-4, WF-065), read as the signed-in user.
//
// `now_for_viewer` already returns each connection's schedule redacted to the viewer's tier
// for a range of up to 8 days (D41), so a week fits in one call and no new database function is
// needed. The engine runs here, on the server (lib/presence/schedule.ts).
//
// Only error codes go into thrown errors and logs, never names or titles (NFR-SEC-11).

import 'server-only';
import type { NowConnection } from '@synkd/backend';
import { addDays, zonedTimeToInstant } from '@synkd/ui/lib/time';
import { getViewerRow } from '@/lib/data/now';
import { errorCode, nowRowInput } from '@/lib/presence/compute';
import { blocksOnDates } from '@/lib/presence/schedule';
import { isUuid } from '@/lib/social/mappers';
import { createServerSupabase } from '@/lib/supabase/server';
import type { ConnectionSchedule } from '@/lib/types';

/**
 * A connection's calendar on the given consecutive dates (at most a week), in the viewer's
 * timezone and at their tier for the viewer. Null when they aren't a connection (or either of
 * you blocked the other). One schedule the engine can't handle is `unavailable`, not a crash.
 */
export async function getConnectionSchedule(
  id: string,
  dates: string[],
): Promise<ConnectionSchedule | null> {
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!isUuid(id) || first === undefined || last === undefined) return null;
  const [{ timezone: timeZone }, supabase] = await Promise.all([
    getViewerRow(),
    createServerSupabase(),
  ]);
  const { data, error } = await supabase.rpc('now_for_viewer', {
    range_start: zonedTimeToInstant(first, 0, timeZone).toISOString(),
    range_end: zonedTimeToInstant(addDays(last, 1), 0, timeZone).toISOString(),
  });
  if (error) throw new Error(`now_for_viewer failed (${error.code})`);
  const row = (data as unknown as NowConnection[]).find((r) => r.user_id === id);
  if (!row) return null;
  const { tier } = row;
  if (row.paused) return { state: 'paused', blocks: [], tier };
  if (!row.has_schedule) return { state: 'no_schedule', blocks: [], tier };
  try {
    return { state: 'ok', blocks: blocksOnDates(nowRowInput(row), dates, timeZone), tier };
  } catch (err) {
    // The error class only: an engine message can quote an RRULE (NFR-SEC-11).
    console.warn('Schedule: a calendar could not be worked out', errorCode(err));
    return { state: 'unavailable', blocks: [], tier };
  }
}
