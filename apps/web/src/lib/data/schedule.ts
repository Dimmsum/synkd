// The viewer's own schedule (FR-VIEW-5, FR-GCAL-10, WF-030): their `sources` and `events`, read
// directly as the signed-in user, so RLS returns only their rows (D41). RLS can't tell the
// viewer's own schedule from their offline friends' (D44), so every read here filters
// `offline_friend_id is null`. Expansion and wording live in lib/my-schedule.ts.

import { addDays, zonedTimeToInstant } from '@synkd/ui/lib/time';
import type { MyEvent, ScheduleSource } from '@/lib/types';
import {
  describeSources,
  periodOf,
  scheduleOnDates,
  type StoredEvent,
  type StoredSource,
} from '@/lib/my-schedule';
import { getViewerRow } from '@/lib/data/now';
import { createServerSupabase, type ServerSupabase } from '@/lib/supabase/server';

const SOURCE_COLUMNS = 'id, type, status, period_start, period_end, period_exceptions';
const EVENT_COLUMNS =
  'id, source_id, title, category, starts_at, ends_at, rrule, exdates, busy' as const;

async function ownSources(supabase: ServerSupabase): Promise<StoredSource[]> {
  const { data, error } = await supabase
    .from('sources')
    .select(SOURCE_COLUMNS)
    .is('offline_friend_id', null)
    .order('created_at');
  if (error) throw new Error(`Reading your schedule sources failed (${error.code})`);
  return data;
}

/**
 * The viewer's combined schedule for the given consecutive dates (FR-VIEW-5): every busy
 * occurrence of their own events, expanded with @synkd/availability in their timezone.
 * TODO(WF-080): Google Calendar events arrive here once synced; TODO(WF-065) shares the
 * expansion with the friend and group views.
 */
export async function getMySchedule(
  dates: string[],
): Promise<{ events: MyEvent[]; periods: { start: string; end: string }[] }> {
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === undefined || last === undefined) return { events: [], periods: [] };
  const supabase = await createServerSupabase();
  // The viewer's users row is read once per request and shared with the status chip.
  const [{ timezone: timeZone }, sources] = await Promise.all([
    getViewerRow(),
    ownSources(supabase),
  ]);
  if (sources.length === 0) return { events: [], periods: [] };
  // The dates each uploaded or typed-in schedule covers, so an empty week can say where it is.
  const periods = sources.flatMap((s) => {
    const period = periodOf(s);
    return period ? [{ start: period.start, end: period.end }] : [];
  });

  // Rows that can have an occurrence in the range: recurring ones that started before its end
  // (the period and UNTIL bound them), and one-off events overlapping it.
  const rangeStart = zonedTimeToInstant(first, 0, timeZone).toISOString();
  const rangeEnd = zonedTimeToInstant(addDays(last, 1), 0, timeZone).toISOString();
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .is('offline_friend_id', null)
    .lt('starts_at', rangeEnd)
    .or(`rrule.not.is.null,ends_at.gt."${rangeStart}"`);
  if (error) throw new Error(`Reading your events failed (${error.code})`);
  return { events: scheduleOnDates(sources, data as StoredEvent[], dates, timeZone), periods };
}

/** Where the viewer's schedule comes from, with its dates and health (FR-GCAL-10). */
export async function getSources(): Promise<ScheduleSource[]> {
  const supabase = await createServerSupabase();
  const sources = await ownSources(supabase);
  if (sources.length === 0) return describeSources([], []);
  const { data, error } = await supabase
    .from('events')
    .select('source_id')
    .is('offline_friend_id', null)
    .in(
      'source_id',
      sources.map((s) => s.id),
    );
  if (error) throw new Error(`Reading your events failed (${error.code})`);
  return describeSources(sources, data);
}

/**
 * The confirmed upload or typed-in schedule a new one would replace (`commit_schedule` replaces
 * it, FR-IMP-17), for the warning before Confirm: the viewer's own, or that offline friend's
 * (WF-127). Null when there's none.
 */
export async function getScheduleToReplace(
  offlineFriendId: string | null = null,
): Promise<{ type: 'upload' | 'manual'; start: string; end: string } | null> {
  const supabase = await createServerSupabase();
  const query = supabase.from('sources').select(SOURCE_COLUMNS).in('type', ['upload', 'manual']);
  const { data, error } = await (
    offlineFriendId
      ? query.eq('offline_friend_id', offlineFriendId)
      : query.is('offline_friend_id', null)
  )
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Reading your schedule sources failed (${error.code})`);
  const source = data[0];
  const period = source ? periodOf(source) : null;
  if (!source || !period) return null;
  return {
    type: source.type === 'upload' ? 'upload' : 'manual',
    start: period.start,
    end: period.end,
  };
}
