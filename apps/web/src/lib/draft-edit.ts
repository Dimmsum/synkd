// Split and merge events on the review screen (FR-IMP-11, WF-029). Pure, so the editor and the
// tests share them. A parser often joins what should be two events (one block across a
// lecture and a lab, or one "Mon, Wed" event whose times differ) or breaks one in two.
//
// Split: an event on several days becomes one event per day; an event on one day becomes two
// back-to-back halves (split at the middle, on a 5-minute boundary).
// Merge: events at the same time with the same week pattern become one event on all their days;
// events on the same days and weeks that touch or overlap become one event spanning them.
// Either result keeps the lowest confidence, so a doubtful event stays highlighted until edited.

import { DAYS_OF_WEEK, type DayOfWeek } from '@synkd/shared';
import type { DraftEvent } from '@/lib/types';

const DAY_MINUTES = 24 * 60;

export const toMinutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return h * 60 + m;
};
export const toTime = (minutes: number): string => {
  const m = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Minutes from start to end, across midnight when end is earlier (an overnight event). */
export function durationMinutes(e: Pick<DraftEvent, 'start' | 'end'>): number {
  return (toMinutes(e.end) - toMinutes(e.start) + DAY_MINUTES) % DAY_MINUTES;
}

export type SplitKind = 'days' | 'halves' | null;

/** How an event would be split, or null when it can't be (one day and under 10 minutes). */
export function splitKind(e: DraftEvent): SplitKind {
  if (e.when.kind === 'weekly' && e.when.days.length > 1) return 'days';
  return durationMinutes(e) >= 10 ? 'halves' : null;
}

/** Splits an event (see {@link splitKind}); returns it unchanged when it can't be split. */
export function splitEvent(e: DraftEvent): DraftEvent[] {
  const kind = splitKind(e);
  if (kind === 'days' && e.when.kind === 'weekly') {
    const { pattern } = e.when;
    return e.when.days.map((day) => ({
      ...e,
      id: `${e.id}-${day}`,
      when: { kind: 'weekly' as const, days: [day], pattern },
    }));
  }
  if (kind === 'halves') {
    const half = Math.round(durationMinutes(e) / 2 / 5) * 5;
    const middle = toTime(toMinutes(e.start) + half);
    return [
      { ...e, id: `${e.id}-a`, end: middle },
      { ...e, id: `${e.id}-b`, start: middle },
    ];
  }
  return [e];
}

const sortDays = (days: Iterable<DayOfWeek>) => DAYS_OF_WEEK.filter((d) => new Set(days).has(d));

/**
 * Week numbers typed as "1-6, 8, 10–12" (FR-IMP-5), sorted and unique; null when the text
 * isn't a list of weeks from 1 to 60.
 */
export function parseWeekList(text: string): number[] | null {
  const parts = text
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const weeks = new Set<number>();
  for (const part of parts) {
    const range = /^(\d{1,2})(?:\s*[-–—]\s*(\d{1,2}))?$/.exec(part);
    if (!range) return null;
    const from = Number(range[1]);
    const to = range[2] === undefined ? from : Number(range[2]);
    if (from < 1 || to > 60 || to < from) return null;
    for (let w = from; w <= to; w++) weeks.add(w);
  }
  return [...weeks].sort((a, b) => a - b);
}

/** [1, 2, 3, 5, 8, 9] → "1–3, 5, 8–9". */
export function formatWeekList(weeks: readonly number[]): string {
  const sorted = [...new Set(weeks)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    out.push(i === j ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
    i = j + 1;
  }
  return out.join(', ');
}

/**
 * The single event `events` merge into, or null when they can't be merged (see the header).
 * Needs at least two weekly events; dated events (WF-036) aren't merged.
 */
export function mergeEvents(events: readonly DraftEvent[]): DraftEvent | null {
  const [first] = events;
  if (!first || events.length < 2) return null;
  const weekly = events.flatMap((e) => (e.when.kind === 'weekly' ? [{ e, when: e.when }] : []));
  if (weekly.length !== events.length) return null;
  const pattern = JSON.stringify(weekly[0]?.when.pattern);
  if (weekly.some((w) => JSON.stringify(w.when.pattern) !== pattern)) return null;
  const confidence = Math.min(...events.map((e) => e.confidence));
  const base = { ...first, id: `${first.id}-merged`, confidence };
  const firstWhen = weekly[0]!.when;

  // Same time, different days: one event on all of them.
  if (events.every((e) => e.start === first.start && e.end === first.end)) {
    return {
      ...base,
      when: { ...firstWhen, days: sortDays(weekly.flatMap((w) => w.when.days)) },
    };
  }

  // Same days, back-to-back or overlapping (none overnight): one event spanning them.
  const days = sortDays(firstWhen.days).join();
  if (weekly.some((w) => sortDays(w.when.days).join() !== days)) return null;
  if (events.some((e) => toMinutes(e.end) <= toMinutes(e.start))) return null;
  const sorted = [...events].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  let reach = toMinutes(sorted[0]!.end);
  for (const e of sorted.slice(1)) {
    if (toMinutes(e.start) > reach) return null; // a gap between them
    reach = Math.max(reach, toMinutes(e.end));
  }
  return { ...base, start: sorted[0]!.start, end: toTime(reach) };
}
