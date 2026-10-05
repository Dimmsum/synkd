// The viewer's own schedule as stored (`sources` + `events`, read under RLS) turned into what
// My schedule and Settings show (FR-VIEW-5, FR-GCAL-10, WF-030). Pure: lib/data/schedule.ts
// reads the rows, these functions expand and describe them.

import { expandEvent } from '@synkd/availability';
import { EventCategory, SchedulePeriod, SOURCE_TYPES, type SourceType } from '@synkd/shared';
import { addDays, minutesIntoDay, zonedTimeToInstant } from '@synkd/ui/lib/time';
import { CATEGORY_LABELS } from '@/lib/status';
import type { MyEvent, ScheduleSource } from '@/lib/types';
import { formatDateRange } from './schedule-draft';

/** A `sources` row of the viewer's own (offline_friend_id is null), as selected. */
export interface StoredSource {
  id: string;
  type: string;
  status: string;
  period_start: string | null;
  period_end: string | null;
  period_exceptions: unknown;
}

/** An `events` row of the viewer's own, as selected. Instants are ISO strings. */
export interface StoredEvent {
  id: string;
  source_id: string;
  title: string | null;
  category: string | null;
  starts_at: string;
  ends_at: string;
  rrule: string | null;
  exdates: string[];
  busy: boolean;
}

/** The source's period for the engine, or null without one. Malformed exceptions are dropped. */
export function periodOf(source: StoredSource): SchedulePeriod | null {
  if (!source.period_start || !source.period_end) return null;
  const parsed = SchedulePeriod.safeParse({
    start: source.period_start,
    end: source.period_end,
    exceptions: source.period_exceptions,
  });
  return parsed.success
    ? parsed.data
    : { start: source.period_start, end: source.period_end, exceptions: [] };
}

function sourceType(type: string): SourceType {
  return (SOURCE_TYPES as readonly string[]).includes(type) ? (type as SourceType) : 'manual';
}

/**
 * Every busy occurrence of the viewer's events on `dates` (consecutive local dates), split at
 * local midnight so each piece belongs to one day, for the My schedule grid. Times are minutes
 * since local midnight in `timeZone`; a piece running to midnight ends at 1440. The viewer
 * always sees their own titles; an event without one shows its category.
 */
export function scheduleOnDates(
  sources: readonly StoredSource[],
  events: readonly StoredEvent[],
  dates: readonly string[],
  timeZone: string,
): MyEvent[] {
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === undefined || last === undefined) return [];
  const dayStart = (date: string) => zonedTimeToInstant(date, 0, timeZone).getTime();
  const range = { start: dayStart(first), end: dayStart(addDays(last, 1)) };
  const byId = new Map(sources.map((s) => [s.id, s]));

  const result: MyEvent[] = [];
  for (const e of events) {
    const source = byId.get(e.source_id);
    if (!source || !e.busy) continue;
    const category = EventCategory.safeParse(e.category);
    const cat = category.success ? category.data : 'other';
    let occurrences;
    try {
      occurrences = expandEvent(
        {
          id: e.id,
          start: Date.parse(e.starts_at),
          end: Date.parse(e.ends_at),
          rrule: e.rrule,
          exdates: e.exdates.map((d) => Date.parse(d)),
        },
        range,
        timeZone,
        periodOf(source),
      );
    } catch {
      // A rule outside the supported subset (D42) can't come from commit_schedule; skip it
      // rather than break the page.
      continue;
    }
    for (const o of occurrences) {
      for (const date of dates) {
        const from = dayStart(date);
        const to = dayStart(addDays(date, 1));
        if (o.end <= from || o.start >= to) continue;
        result.push({
          id: `${e.id}:${o.start}:${date}`,
          date,
          start: o.start <= from ? 0 : minutesIntoDay(o.start, timeZone),
          end: o.end >= to ? 24 * 60 : minutesIntoDay(o.end, timeZone),
          title: e.title ?? CATEGORY_LABELS[cat],
          category: cat,
          source: sourceType(source.type),
        });
      }
    }
  }
  return result.sort((a, b) =>
    a.date === b.date ? a.start - b.start || a.end - b.end : a.date.localeCompare(b.date),
  );
}

const LABELS: Record<SourceType, string> = {
  upload: 'Uploaded timetable',
  manual: 'Typed in by you',
  gcal: 'Google Calendar',
};

/**
 * The viewer's sources for Settings (FR-GCAL-10): each uploaded or typed-in schedule with its
 * dates and number of events, then Google Calendar (not connected until WF-080).
 */
export function describeSources(
  sources: readonly StoredSource[],
  events: readonly Pick<StoredEvent, 'source_id'>[],
): ScheduleSource[] {
  const schedules = sources
    .filter((s) => s.type === 'upload' || s.type === 'manual')
    .map((s): ScheduleSource => {
      const type = sourceType(s.type);
      const n = events.filter((e) => e.source_id === s.id).length;
      const period = periodOf(s);
      const count = `${n} ${n === 1 ? 'event' : 'events'}`;
      return {
        id: s.id,
        type,
        label: LABELS[type],
        status: s.status === 'healthy' ? 'healthy' : 'failed',
        detail: period ? `${formatPeriod(period)} · ${count}` : count,
        periodEnd: period?.end,
      };
    });
  // TODO(WF-080): the real Google Calendar source and its sync health.
  return [
    ...schedules,
    { type: 'gcal', label: LABELS.gcal, status: 'not_connected', detail: 'Not connected' },
  ];
}

/** "Aug 31 – Dec 12, 2026" (or "Dec 1, 2026 – Jan 5, 2027" across a new year). */
export function formatPeriod(period: { start: string; end: string }): string {
  const sameYear = period.start.slice(0, 4) === period.end.slice(0, 4);
  return sameYear
    ? `${formatDateRange(period)}, ${period.end.slice(0, 4)}`
    : `${formatDateRange({ start: period.start, end: period.start })}, ${period.start.slice(0, 4)} – ${formatDateRange({ start: period.end, end: period.end })}, ${period.end.slice(0, 4)}`;
}

/**
 * Why a range of dates on My schedule is empty although the viewer has a schedule: it ends
 * before them or starts after them. The schedule nearest the range wins, an upcoming one first.
 * Null when a schedule covers any of the dates (then the range is simply free) or there's none.
 */
export function scheduleOutsideRange(
  periods: readonly { start: string; end: string }[],
  dates: readonly string[],
): { kind: 'upcoming' | 'ended'; period: { start: string; end: string } } | null {
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === undefined || last === undefined || periods.length === 0) return null;
  if (periods.some((p) => p.start <= last && p.end >= first)) return null;
  const upcoming = periods
    .filter((p) => p.start > last)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  if (upcoming) return { kind: 'upcoming', period: upcoming };
  const ended = [...periods].sort((a, b) => b.end.localeCompare(a.end))[0];
  return ended ? { kind: 'ended', period: ended } : null;
}
