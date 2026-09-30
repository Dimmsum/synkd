// The status engine (PRD §6.6): works out a user's status over time from their events,
// available hours and manual overrides.

import { DEFAULT_TIMEZONE, MANUAL_STATUS_TO_STATUS, type Status } from '@whosfree/shared';
import { availableHoursIntervals, defaultAvailableHours } from './hours';
import { intersectIntervals, mergeIntervals, overlaps, type Interval } from './interval';
import { DAY_MS } from './time';
import type {
  AvailabilityInput,
  StatusCause,
  StatusOverride,
  StatusSegment,
  ScheduleSource,
} from './types';

/**
 * How far ahead {@link statusAt} looks for the end of the current status: 7 days.
 *
 * A status that doesn't change within a week has no useful "until" ("Away until next
 * Thursday" isn't what the Now screen is for), and a bounded look-ahead keeps the work per
 * user small. Beyond it, `until` is `null` and the UI shows the status on its own.
 */
export const DEFAULT_UNTIL_HORIZON_MS = 7 * DAY_MS;

/** A busy span produced by one event (one occurrence, for a recurring event). */
interface Occurrence extends Interval {
  readonly eventId: string;
}

/** Busy occurrences from every source that overlap `range`, sorted by start. */
function busyOccurrences(sources: readonly ScheduleSource[], range: Interval): Occurrence[] {
  const occurrences: Occurrence[] = [];
  for (const source of sources) {
    for (const event of source.events) {
      if (event.busy === false || !overlaps(event, range)) continue;
      occurrences.push({ eventId: event.id, start: event.start, end: event.end });
    }
  }
  return occurrences.sort((a, b) => a.start - b.start);
}

/**
 * The times within `range` when the user's events make them busy, from every source, with
 * overlapping and back-to-back events merged into single blocks (FR-AVL-1).
 *
 * This is the raw calendar view: it ignores overrides, available hours and pausing. Use
 * {@link timeline} for what viewers see.
 */
export function busyIntervals(input: AvailabilityInput, range: Interval): Interval[] {
  return intersectIntervals(mergeIntervals(busyOccurrences(input.sources, range)), [range]);
}

interface ActiveOverride {
  readonly override: StatusOverride;
  readonly index: number;
  readonly end: number;
}

/** The override in charge at `t`: the latest-starting active one, ties to the later entry. */
function overrideAt(overrides: readonly ActiveOverride[], t: number): ActiveOverride | undefined {
  let best: ActiveOverride | undefined;
  for (const candidate of overrides) {
    if (candidate.override.startsAt > t || candidate.end <= t) continue;
    if (!best || candidate.override.startsAt >= best.override.startsAt) best = candidate;
  }
  return best;
}

function sameCause(a: StatusCause, b: StatusCause): boolean {
  if (a.type === 'override' && b.type === 'override') {
    return a.manualStatus === b.manualStatus && a.overrideId === b.overrideId;
  }
  if (a.type === 'events' && b.type === 'events') {
    return (
      a.eventIds.length === b.eventIds.length && a.eventIds.every((id, i) => id === b.eventIds[i])
    );
  }
  return a.type === b.type;
}

/**
 * The user's status across `range`, as a list of segments that exactly cover it in order.
 *
 * At each instant the first rule that applies wins (PRD §6.6 precedence):
 * 1. `paused` when sharing is paused;
 * 2. the active manual override (`focused` shows as `busy`);
 * 3. `no_schedule` when the user has no schedule sources;
 * 4. `busy` during any busy event from any source;
 * 5. `away` outside available hours;
 * 6. otherwise `free`.
 *
 * A new segment starts whenever the status or its cause changes, so back-to-back classes give
 * one `busy` segment per class. Returns `[]` for an empty range. Throws a `RangeError` if the
 * timezone is unknown.
 */
export function timeline(input: AvailabilityInput, range: Interval): StatusSegment[] {
  if (range.end <= range.start) return [];
  if (input.sharingPaused) {
    return [{ start: range.start, end: range.end, status: 'paused', cause: { type: 'paused' } }];
  }
  const timeZone = input.timeZone ?? DEFAULT_TIMEZONE;
  const hasSchedule = input.sources.length > 0;

  const overrides: ActiveOverride[] = (input.overrides ?? [])
    .map((override, index) => ({ override, index, end: override.endsAt ?? Infinity }))
    .filter(({ override, end }) => override.startsAt < range.end && end > range.start);
  const occurrences = hasSchedule ? busyOccurrences(input.sources, range) : [];
  const hours = hasSchedule
    ? availableHoursIntervals(input.availableHours ?? defaultAvailableHours(), range, timeZone)
    : [];

  const cuts = new Set([range.start, range.end]);
  const addCut = (t: number) => {
    if (t > range.start && t < range.end) cuts.add(t);
  };
  for (const { override, end } of overrides) {
    addCut(override.startsAt);
    addCut(end);
  }
  for (const spans of [occurrences, hours]) {
    for (const { start, end } of spans) {
      addCut(start);
      addCut(end);
    }
  }
  const instants = [...cuts].sort((a, b) => a - b);

  const segments: StatusSegment[] = [];
  let active: Occurrence[] = [];
  let nextOccurrence = 0;
  let hoursIndex = 0;
  for (let i = 0; i + 1 < instants.length; i++) {
    const start = instants[i] as number;
    const end = instants[i + 1] as number;

    // Sweep: bring in events that have started, drop those that have ended.
    while (nextOccurrence < occurrences.length) {
      const occurrence = occurrences[nextOccurrence] as Occurrence;
      if (occurrence.start > start) break;
      active.push(occurrence);
      nextOccurrence++;
    }
    active = active.filter((o) => o.end > start);
    while (hoursIndex < hours.length && (hours[hoursIndex] as Interval).end <= start) hoursIndex++;

    let status: Status;
    let cause: StatusCause;
    const override = overrideAt(overrides, start);
    if (override) {
      const manualStatus = override.override.status;
      status = MANUAL_STATUS_TO_STATUS[manualStatus];
      cause =
        override.override.id === undefined
          ? { type: 'override', manualStatus }
          : { type: 'override', manualStatus, overrideId: override.override.id };
    } else if (!hasSchedule) {
      status = 'no_schedule';
      cause = { type: 'no_schedule' };
    } else if (active.length > 0) {
      status = 'busy';
      cause = { type: 'events', eventIds: [...new Set(active.map((o) => o.eventId))].sort() };
    } else if ((hours[hoursIndex]?.start ?? Infinity) <= start) {
      status = 'free';
      cause = { type: 'available' };
    } else {
      status = 'away';
      cause = { type: 'outside_hours' };
    }

    const last = segments[segments.length - 1];
    if (last && last.status === status && sameCause(last.cause, cause)) {
      segments[segments.length - 1] = { ...last, end };
    } else {
      segments.push({ start, end, status, cause });
    }
  }
  return segments;
}

/** A user's status at one instant, with when it next changes (D18). */
export interface CurrentStatus {
  readonly status: Status;
  /** Why the user has this status right now. For `busy` from events, the events' ids. */
  readonly cause: StatusCause;
  /**
   * When the displayed status next changes, UTC epoch ms: the end of the unbroken run of the
   * same status, so back-to-back classes give "busy until the last one ends". `null` when it
   * doesn't change within the look-ahead horizon, as for `paused`, `no_schedule` or an
   * "until I change it" override.
   */
  readonly until: number | null;
  /** The status from `until` onwards, or `null` when `until` is `null`. */
  readonly nextStatus: Status | null;
}

/** Options for {@link statusAt}. */
export interface StatusAtOptions {
  /** How far ahead to look for the end of the current status. Default 7 days. */
  readonly horizonMs?: number;
}

/**
 * The user's status at `now` (UTC epoch ms) plus "until X" (FR-AVL-4, D18).
 *
 * `now` is always passed in; the engine never reads the clock. Throws a `RangeError` if
 * `horizonMs` isn't positive or the timezone is unknown.
 */
export function statusAt(
  input: AvailabilityInput,
  now: number,
  options: StatusAtOptions = {},
): CurrentStatus {
  const horizonMs = options.horizonMs ?? DEFAULT_UNTIL_HORIZON_MS;
  if (!(horizonMs > 0)) throw new RangeError('horizonMs must be positive');
  const segments = timeline(input, { start: now, end: now + horizonMs });
  const first = segments[0] as StatusSegment;
  let i = 1;
  while (i < segments.length && (segments[i] as StatusSegment).status === first.status) i++;
  const next = segments[i];
  return {
    status: first.status,
    cause: first.cause,
    until: next ? next.start : null,
    nextStatus: next ? next.status : null,
  };
}
