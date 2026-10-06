// Recurring events (FR-AVL-6, FR-IMP-5, PRD §9 modelling decision).
//
// A recurring event is stored as its first occurrence (`start`/`end`, UTC instants) plus an
// RFC 5545 RRULE and EXDATEs, and belongs to a source with a period (dates it covers, plus
// exceptions such as breaks). Expansion works in the owner's local wall time on calendar day
// numbers: each occurrence keeps the first occurrence's local start time and local length,
// so a 09:00 class stays at 09:00 across a DST change. We expand the rules ourselves instead
// of using the `rrule` package: we only need a small weekly subset, and `rrule`'s timezone
// handling ("fake UTC" dates, TZID quirks) is exactly where DST bugs come from.

import type { EventDraft, SchedulePeriod } from '@synkd/shared';
import { overlaps, type Interval } from './interval';
import { formatUtcDateTime, parseRRule, WEEKDAY_CODES, type RecurrenceRule } from './rrule';
import {
  DAY_MS,
  dayFromDate,
  localDayOf,
  localToUtc,
  msFromLocalTime,
  toLocalMs,
  weekdayIndex,
  weekdayOf,
} from './time';
import type { ScheduleEvent } from './types';

/** One occurrence of an event: when it happens, and which event it belongs to. */
export interface Occurrence extends Interval {
  readonly eventId: string;
}

/** The first day (day number) of the week containing `day`, for weeks starting on `weekStart`. */
function weekStartOf(day: number, weekStart: number): number {
  return day - ((weekdayOf(day) - weekStart + 7) % 7);
}

/**
 * Whether the rule generates an occurrence on `day`, which must be on or after `firstDay`
 * (ignoring COUNT, UNTIL and EXDATE).
 */
function ruleMatches(rule: RecurrenceRule, firstDay: number, day: number): boolean {
  // RFC 5545: DTSTART is always the first occurrence.
  if (day === firstDay) return true;
  if (rule.freq === 'DAILY') {
    return (day - firstDay) % rule.interval === 0 && (rule.byDay?.includes(weekdayOf(day)) ?? true);
  }
  const weeks = (weekStartOf(day, rule.weekStart) - weekStartOf(firstDay, rule.weekStart)) / 7;
  const days = rule.byDay ?? [weekdayOf(firstDay)];
  return weeks % rule.interval === 0 && days.includes(weekdayOf(day));
}

/** A test for "is this local day in one of the period's exceptions?" */
function exceptionFilter(period: SchedulePeriod | null | undefined): (day: number) => boolean {
  const exceptions = (period?.exceptions ?? []).map((r) => ({
    first: dayFromDate(r.start),
    last: dayFromDate(r.end),
  }));
  return (day) => exceptions.some((r) => r.first <= day && day <= r.last);
}

/**
 * The occurrences of `event` that overlap `range`, in order.
 *
 * - A one-off event (no `rrule`: dated schedules, Google events) is returned as-is if it
 *   overlaps the range. The period doesn't apply to it.
 * - A recurring event is expanded in `timeZone`. An occurrence is kept only if its local start
 *   date is inside `period` (inclusive) and not in any of its exceptions, and its start
 *   instant isn't one of `exdates`.
 *
 * Throws a `RangeError` if the rule is outside the supported subset (see `parseRRule`) or the
 * timezone is unknown.
 */
export function expandEvent(
  event: ScheduleEvent,
  range: Interval,
  timeZone: string,
  period?: SchedulePeriod | null,
): Occurrence[] {
  if (range.end <= range.start || event.end <= event.start) return [];
  if (!event.rrule) {
    return overlaps(event, range)
      ? [{ eventId: event.id, start: event.start, end: event.end }]
      : [];
  }
  const rule = parseRRule(event.rrule);
  const startLocal = toLocalMs(event.start, timeZone);
  const firstDay = Math.floor(startLocal / DAY_MS);
  const startOffset = startLocal - firstDay * DAY_MS;
  // May be more than a day, for events that run past midnight.
  const endOffset = toLocalMs(event.end, timeZone) - firstDay * DAY_MS;

  // Local days whose occurrence could overlap the range, with a day of slack each side.
  let from = localDayOf(range.start, timeZone) - Math.ceil(endOffset / DAY_MS) - 1;
  let to = localDayOf(range.end, timeZone) + 1;
  if (rule.until?.kind === 'date') to = Math.min(to, rule.until.day);
  if (rule.until?.kind === 'instant') to = Math.min(to, localDayOf(rule.until.at, timeZone));
  if (period) {
    // Clipping to the period's dates here is what applies the period (exceptions come below).
    from = Math.max(from, dayFromDate(period.start));
    to = Math.min(to, dayFromDate(period.end));
  }
  const isException = exceptionFilter(period);
  const exdates = new Set(event.exdates ?? []);

  const occurrences: Occurrence[] = [];
  let generated = 0;
  // COUNT numbers occurrences from DTSTART, so counting has to start there.
  for (let day = rule.count === null ? Math.max(from, firstDay) : firstDay; day <= to; day++) {
    if (!ruleMatches(rule, firstDay, day)) continue;
    if (rule.count !== null && ++generated > rule.count) break;
    if (day < from || isException(day)) continue;
    const start = localToUtc(day, startOffset, timeZone);
    if (rule.until?.kind === 'instant' && start > rule.until.at) break;
    let end = localToUtc(day, endOffset, timeZone);
    // Only possible when the start was pushed forward by a DST gap (a 02:30–03:30 event on
    // spring-forward day becomes 03:30–03:30). Keep the first occurrence's length rather than
    // losing the occurrence.
    if (end <= start) end = start + (event.end - event.start);
    const occurrence = { eventId: event.id, start, end };
    if (!exdates.has(start) && overlaps(occurrence, range)) occurrences.push(occurrence);
  }
  return occurrences;
}

/**
 * How an event is stored (PRD §9 `events.start`, `end`, `rrule`, `exdates`): the first
 * occurrence as UTC instants, plus the recurrence for a recurring event.
 */
export interface StoredEventTimes {
  /** Start of the first occurrence, UTC epoch ms. */
  readonly start: number;
  /** End of the first occurrence, UTC epoch ms. */
  readonly end: number;
  /** RFC 5545 RRULE value (no `RRULE:` prefix), or `null` for a one-off event. */
  readonly rrule: string | null;
  /** Start instants of occurrences the rule generates that don't happen. */
  readonly exdates: readonly number[];
}

/**
 * Converts an event draft (from the parser or the editor) into the form stored in `events`,
 * for `commit_schedule` (WF-030).
 *
 * Times are wall-clock times in `timeZone`; an `end` before `start` runs past midnight. Week
 * numbers count from the week (Monday–Sunday) containing `period.start`, which is week 1.
 * The first occurrence is the first matching day in the period, and every rule ends with
 * `UNTIL` at the start of the last one, so a rule never runs past the period's end even when
 * expanded without the period (`events_for_viewer` relies on it). Encodings:
 * - `every`: `FREQ=WEEKLY;WKST=MO;BYDAY=…;UNTIL=…`
 * - `alternating`: the same with `INTERVAL=2`, anchored by the first occurrence, which is in
 *   a week of the right parity.
 * - `weeks`: the `every` rule up to the last chosen week, plus an EXDATE for each occurrence
 *   in a week that wasn't chosen.
 *
 * The period's exceptions (breaks, holidays) are not written into the rule: always expand it
 * with the source's period (as `timeline` does), so breaks can change without rewriting
 * events. Returns `null` when the draft has no occurrence in the period (e.g. only weeks
 * after it ends). A `date` draft becomes a one-off event on that date.
 *
 * `commit_schedule` (backend migration 20261002800000) computes exactly the same in SQL;
 * the backend tests compare the two.
 */
export function eventTimesFromDraft(
  draft: Pick<EventDraft, 'start' | 'end' | 'when'>,
  period: SchedulePeriod,
  timeZone: string,
): StoredEventTimes | null {
  const startMs = msFromLocalTime(draft.start);
  let endMs = msFromLocalTime(draft.end);
  if (endMs <= startMs) endMs += DAY_MS;
  const occurrence = (day: number) => ({
    start: localToUtc(day, startMs, timeZone),
    end: localToUtc(day, endMs, timeZone),
  });

  const { when } = draft;
  if (when.kind === 'date') {
    return { ...occurrence(dayFromDate(when.date)), rrule: null, exdates: [] };
  }

  const weekdays = [...new Set(when.days.map(weekdayIndex))].sort((a, b) => a - b);
  const periodStart = dayFromDate(period.start);
  const weekOne = weekStartOf(periodStart, 0);
  const { pattern } = when;
  const inChosenWeek = (day: number) => {
    const week = (weekStartOf(day, 0) - weekOne) / 7 + 1;
    if (pattern.type === 'every') return true;
    if (pattern.type === 'alternating') return week % 2 === (pattern.parity === 'odd' ? 1 : 0);
    return pattern.weeks.includes(week);
  };
  const onWeekday = (day: number) => weekdays.includes(weekdayOf(day));

  const chosen: number[] = [];
  for (let day = periodStart; day <= dayFromDate(period.end); day++) {
    if (onWeekday(day) && inChosenWeek(day)) chosen.push(day);
  }
  const first = chosen[0];
  const last = chosen[chosen.length - 1];
  if (first === undefined || last === undefined) return null;

  const byDay = `BYDAY=${weekdays.map((d) => WEEKDAY_CODES[d]).join(',')}`;
  const interval = pattern.type === 'alternating' ? 'INTERVAL=2;' : '';
  const until = formatUtcDateTime(occurrence(last).start);
  const exdates: number[] = [];
  if (pattern.type === 'weeks') {
    for (let day = first; day <= last; day++) {
      if (onWeekday(day) && !inChosenWeek(day)) exdates.push(occurrence(day).start);
    }
  }
  return {
    ...occurrence(first),
    rrule: `FREQ=WEEKLY;${interval}WKST=MO;${byDay};UNTIL=${until}`,
    exdates,
  };
}
