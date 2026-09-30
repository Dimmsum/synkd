// Free-overlap maths for the group week view (the design's "overlap" week style) and the
// slot finder. It only ever deals in times, never in why someone is busy (FR-SLOT-3).
// TODO(WF-061/WF-098): the slot finder will call packages/availability on the server;
// the week view can keep using freeWindows() on the intervals the server returns.

import type { MemberBusyDay, PersonId } from '@/lib/types';

export interface FreeWindow {
  /** Local minutes. */
  start: number;
  end: number;
  /** Who's free for the whole window. */
  free: PersonId[];
}

function isFreeDuring(busy: [number, number][], start: number, end: number) {
  return !busy.some(([s, e]) => s < end && start < e);
}

/**
 * Steps through the day and merges consecutive steps that have the same set of free
 * people, like the design's overlap view. Windows where nobody is free are dropped.
 */
export function freeWindows(
  members: MemberBusyDay[],
  dayStart: number,
  dayEnd: number,
  step = 30,
): FreeWindow[] {
  const out: FreeWindow[] = [];
  for (let t = dayStart; t < dayEnd; t += step) {
    const end = Math.min(t + step, dayEnd);
    const free = members.filter((m) => isFreeDuring(m.busy, t, end)).map((m) => m.personId);
    const last = out[out.length - 1];
    if (last && last.end === t && last.free.join() === free.join()) last.end = end;
    else if (free.length) out.push({ start: t, end, free });
  }
  return out;
}

/** How many people are free in each step of the day (the "Group overlap" strip). */
export function freeCounts(
  members: MemberBusyDay[],
  dayStart: number,
  dayEnd: number,
  step = 30,
): number[] {
  const counts: number[] = [];
  for (let t = dayStart; t < dayEnd; t += step) {
    counts.push(members.filter((m) => isFreeDuring(m.busy, t, t + step)).length);
  }
  return counts;
}

export interface RankedSlot extends FreeWindow {
  date: string;
  missing: PersonId[];
}

export interface RankOptions {
  /** Minimum length in minutes (default 60, J4). */
  minDuration: number;
  /** Time-of-day window in local minutes. */
  window: [number, number];
  /** Include "all but N" slots up to this N (FR-SLOT-2). */
  maxMissing?: number;
  /** Ignore time before this moment (e.g. earlier today). */
  notBefore?: { date: string; minute: number };
}

/**
 * Ranks free slots across days (FR-SLOT-2): slots where everyone is free come first,
 * soonest then longest; then "all but 1", "all but 2", each soonest then longest.
 */
export function rankSlots(
  days: { date: string; members: MemberBusyDay[] }[],
  opts: RankOptions,
): RankedSlot[] {
  const maxMissing = opts.maxMissing ?? 2;
  const out: RankedSlot[] = [];
  for (const day of days) {
    const everyone = day.members.map((m) => m.personId);
    const to = opts.window[1];
    let from = opts.window[0];
    if (opts.notBefore) {
      if (day.date < opts.notBefore.date) continue;
      if (day.date === opts.notBefore.date) {
        from = Math.max(from, Math.ceil(opts.notBefore.minute / 30) * 30);
      }
    }
    if (from >= to) continue;
    for (const w of freeWindows(day.members, from, to)) {
      const missing = everyone.filter((id) => !w.free.includes(id));
      if (w.end - w.start >= opts.minDuration && missing.length <= maxMissing) {
        out.push({ ...w, date: day.date, missing });
      }
    }
  }
  return out.sort(
    (a, b) =>
      a.missing.length - b.missing.length ||
      a.date.localeCompare(b.date) ||
      a.start - b.start ||
      b.end - b.start - (a.end - a.start),
  );
}
