// A tiny stand-in for the availability engine (packages/availability, WF-060/WF-061) and
// for server-side redaction (WF-041), just enough to make the mock data consistent.
// TODO(WF-064): delete this file. The real status comes from `now_for_viewer` + the engine.

import { MANUAL_STATUS_TO_STATUS, type Status, type Tier } from '@whosfree/shared';
import { addDays, minutesIntoDay, zonedTimeToInstant } from '@whosfree/ui/lib/time';
import type { Activity, Iso } from '@/lib/types';
import type { MockEvent, MockPerson } from './data';

export function eventsOn(p: MockPerson, date: string, today: string): MockEvent[] {
  const weekday = weekdayIndex(date);
  const list =
    date === today && p.today ? p.today : p.weekly.filter((e) => e.days.includes(weekday));
  return [...list].sort((a, b) => a.start - b.start);
}

function weekdayIndex(date: string) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Merges overlapping or touching intervals. */
export function mergeIntervals(list: [number, number][]): [number, number][] {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Busy time for the overlap views: events plus time outside available hours (times only). */
export function busyIntervals(p: MockPerson, date: string, today: string): [number, number][] {
  const events = eventsOn(p, date, today).map((e): [number, number] => [e.start, e.end]);
  return mergeIntervals([...events, [0, p.hours.start], [p.hours.end, 1440]]);
}

export interface MockStatus {
  status: Status;
  until: Iso | null;
  nextFreeAt: Iso | null;
  activity?: Activity;
}

/**
 * Status at `now`, following the PRD precedence (§6.6): paused → manual override →
 * no_schedule → busy events → available hours → free.
 */
export function statusAt(p: MockPerson, now: Date, today: string, timeZone: string): MockStatus {
  const at = (date: string, minutes: number) =>
    zonedTimeToInstant(date, minutes, timeZone).toISOString();
  const tomorrowStart = at(addDays(today, 1), p.hours.start);

  if (p.paused) return { status: 'paused', until: null, nextFreeAt: null };
  if (p.override) {
    const until = at(today, p.override.until);
    return { status: MANUAL_STATUS_TO_STATUS[p.override.status], until, nextFreeAt: until };
  }
  if (p.noSchedule) return { status: 'no_schedule', until: null, nextFreeAt: null };

  const m = minutesIntoDay(now, timeZone);
  const events = eventsOn(p, today, today);
  const merged = mergeIntervals(events.map((e) => [e.start, e.end]));
  const block = merged.find(([s, e]) => s <= m && m < e);

  if (block) {
    const current = [...events].reverse().find((e) => e.start <= m && m < e.end);
    const end = block[1];
    const freeAfter = end < p.hours.end ? at(today, Math.max(end, p.hours.start)) : tomorrowStart;
    return {
      status: 'busy',
      until: at(today, end),
      nextFreeAt: freeAfter,
      activity: current ? { category: current.category, title: current.title } : undefined,
    };
  }
  if (m < p.hours.start) {
    return {
      status: 'away',
      until: at(today, p.hours.start),
      nextFreeAt: at(today, p.hours.start),
    };
  }
  if (m >= p.hours.end) return { status: 'away', until: tomorrowStart, nextFreeAt: tomorrowStart };

  const nextStart = merged.find(([s]) => s > m)?.[0] ?? Infinity;
  return { status: 'free', until: at(today, Math.min(nextStart, p.hours.end)), nextFreeAt: null };
}

/** What a viewer at `tier` may see of an activity (WF-041 does this in Postgres). */
export function redact(activity: Activity | undefined, tier: Tier): Activity | undefined {
  if (!activity || tier === 1) return undefined;
  if (tier === 2) return { category: activity.category };
  return { category: activity.category, title: activity.title };
}
