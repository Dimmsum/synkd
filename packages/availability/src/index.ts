// @synkd/availability: the pure availability engine (PRD §6.6). No I/O, no clock reads.
// Every instant is UTC epoch milliseconds and every interval is half-open, `[start, end)`.

export {
  busyIntervals,
  DEFAULT_UNTIL_HORIZON_MS,
  statusAt,
  timeline,
  type CurrentStatus,
  type StatusAtOptions,
} from './engine';
export {
  freeIntervals,
  userFreeIntervals,
  type GroupSegment,
  type UserAvailability,
} from './group';
export { availableHoursIntervals, defaultAvailableHours } from './hours';
export {
  complementIntervals,
  intersectIntervals,
  mergeIntervals,
  subtractIntervals,
  unionIntervals,
  type Interval,
} from './interval';
export {
  eventTimesFromDraft,
  expandEvent,
  type Occurrence,
  type StoredEventTimes,
} from './recurrence';
export { parseRRule, type RecurrenceRule } from './rrule';
export type {
  AvailabilityInput,
  ScheduleEvent,
  ScheduleSource,
  StatusCause,
  StatusOverride,
  StatusSegment,
} from './types';
