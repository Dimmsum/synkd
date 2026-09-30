// Free time across several people (FR-AVL-5), for the slot finder (FR-SLOT, WF-098).

import { timeline } from './engine';
import { mergeIntervals, type Interval } from './interval';
import type { AvailabilityInput } from './types';

/** One person's availability input, tagged with their user id. */
export interface UserAvailability extends AvailabilityInput {
  readonly userId: string;
}

/** A span of time and who is (and isn't) free for all of it. */
export interface GroupSegment {
  readonly start: number;
  readonly end: number;
  /** Users whose status is `free` throughout, in input order. */
  readonly freeUserIds: readonly string[];
  /** Everyone else, in input order. */
  readonly notFreeUserIds: readonly string[];
}

/** The times within `range` when the user's status is `free`, merged. */
export function userFreeIntervals(input: AvailabilityInput, range: Interval): Interval[] {
  return mergeIntervals(timeline(input, range).filter((s) => s.status === 'free'));
}

/**
 * Splits `range` into segments by who is free (FR-AVL-5). The segments cover the whole range
 * in order, and each one starts where the set of free users changes, so neighbouring
 * segments never have the same set.
 *
 * The slot finder takes segments with no `notFreeUserIds` as "everyone is free" and those
 * with N as "all but N" (FR-SLOT-2), then applies its minimum duration and time-of-day window
 * (see `availableHoursIntervals`). Only times are returned, never why someone is busy
 * (FR-SLOT-3).
 *
 * "Free" means the status viewers would see is `free`, so a `paused` user is never free and a
 * `no_schedule` user only is during a manual "Free" status. The slot finder should flag and
 * leave out both beforehand (FR-SLOT-4). Throws a `RangeError` if a user id appears twice.
 */
export function freeIntervals(users: readonly UserAvailability[], range: Interval): GroupSegment[] {
  if (range.end <= range.start) return [];
  const ids = users.map((u) => u.userId);
  if (new Set(ids).size !== ids.length) throw new RangeError('User ids must be unique');

  // +1 when a user becomes free, −1 when they stop. Merged intervals never touch, so a user
  // can't stop and start at the same instant.
  const changes = new Map<number, { index: number; delta: 1 | -1 }[]>();
  const change = (t: number, index: number, delta: 1 | -1) => {
    const list = changes.get(t);
    if (list) list.push({ index, delta });
    else changes.set(t, [{ index, delta }]);
  };
  users.forEach((user, index) => {
    for (const { start, end } of userFreeIntervals(user, range)) {
      change(start, index, 1);
      change(end, index, -1);
    }
  });

  const instants = [...new Set([range.start, range.end, ...changes.keys()])].sort((a, b) => a - b);
  const free = users.map(() => false);
  const segments: GroupSegment[] = [];
  for (let i = 0; i + 1 < instants.length; i++) {
    const start = instants[i] as number;
    for (const { index, delta } of changes.get(start) ?? []) free[index] = delta === 1;
    segments.push({
      start,
      end: instants[i + 1] as number,
      freeUserIds: ids.filter((_, j) => free[j]),
      notFreeUserIds: ids.filter((_, j) => !free[j]),
    });
  }
  return segments;
}
