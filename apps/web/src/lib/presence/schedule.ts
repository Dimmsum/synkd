// Someone else's day or week calendar at the viewer's tier (FR-VIEW-4, WF-065).
//
// Pure, like compute.ts: the server reads the tier-redacted `now_for_viewer` row for the dates
// shown and runs the availability engine's `timeline` over it here, so the calendar agrees with
// their status on the Now screen. Nothing here widens what a row says (FR-VIS-5, D41).

import { timeline, type StatusSegment } from '@synkd/availability';
import { addDays, minutesIntoDay, zonedTimeToInstant } from '@synkd/ui/lib/time';
import type { ScheduleBlock } from '@/lib/types';
import { activityFor, type PresenceInput } from './compute';

const SHOWN = new Set<string>(['busy', 'dnd', 'away']);

/** Same status for the same reason (the engine also cuts at available-hours boundaries). */
const sameRun = (a: StatusSegment, b: StatusSegment) =>
  a.end === b.start && a.status === b.status && JSON.stringify(a.cause) === JSON.stringify(b.cause);

/**
 * Every stretch on `dates` (consecutive local dates) when the person isn't free, split at local
 * midnight in the viewer's `timeZone` so each block belongs to one date. Times are minutes since
 * local midnight; a block running to midnight ends at 1440. Free time has no block; paused and
 * no-schedule are whole-range states the caller shows instead. Throws whatever the engine
 * throws (e.g. a `RangeError` for a malformed RRULE): callers catch it.
 */
export function blocksOnDates(
  input: PresenceInput,
  dates: readonly string[],
  timeZone: string,
): ScheduleBlock[] {
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === undefined || last === undefined) return [];
  const dayStart = (date: string) => zonedTimeToInstant(date, 0, timeZone).getTime();

  const runs: StatusSegment[] = [];
  for (const seg of timeline(input.engine, {
    start: dayStart(first),
    end: dayStart(addDays(last, 1)),
  })) {
    if (!SHOWN.has(seg.status)) continue;
    const prev = runs[runs.length - 1];
    if (prev && sameRun(prev, seg)) runs[runs.length - 1] = { ...prev, end: seg.end };
    else runs.push(seg);
  }

  const blocks: ScheduleBlock[] = [];
  for (const run of runs) {
    const activity = activityFor(run.cause, input);
    for (const date of dates) {
      const from = dayStart(date);
      const to = dayStart(addDays(date, 1));
      if (run.end <= from || run.start >= to) continue;
      blocks.push({
        id: `${run.start}:${date}`,
        date,
        start: run.start <= from ? 0 : minutesIntoDay(run.start, timeZone),
        end: run.end >= to ? 24 * 60 : minutesIntoDay(run.end, timeZone),
        status: run.status as ScheduleBlock['status'],
        outsideHours: run.cause.type === 'outside_hours',
        ...activity,
      });
    }
  }
  return blocks;
}
