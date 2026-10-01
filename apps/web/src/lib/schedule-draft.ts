// Building a schedule to confirm (WF-030, WF-031): the period and its exceptions in the review
// editor, and the checks before `commit_schedule` is called. Pure, so the editor, the server
// action and the tests share them. The database checks the same rules again (ScheduleCommit).

import { eventTimesFromDraft } from '@whosfree/availability';
import {
  DEFAULT_TIMEZONE,
  jamaicanHolidayExceptions,
  LocalDate,
  SCHEDULE_MAX_EXCEPTIONS,
  SCHEDULE_PERIOD_MAX_DAYS,
  ScheduleCommit,
  type DateRange,
  type EventDraft,
  type SchedulePeriod,
} from '@whosfree/shared';
import { addDays, formatMonthDay } from '@whosfree/ui/lib/time';

/** The job id of manual entry (`/import/manual/review`, `/onboarding/review?job=manual`). */
export const MANUAL_JOB_ID = 'manual';

/** How long a typed-in schedule runs by default: 16 weeks, about a semester (FR-IMP-7). */
export const DEFAULT_MANUAL_PERIOD_DAYS = 16 * 7;

/** The period manual entry starts with: from today for 16 weeks. The user changes it. */
export function defaultManualPeriod(today: string): { start: string; end: string } {
  return { start: today, end: addDays(today, DEFAULT_MANUAL_PERIOD_DAYS - 1) };
}

/** A break or holiday in the editor. `holiday` marks a pre-filled public holiday (FR-IMP-8). */
export interface EditableException extends DateRange {
  holiday?: boolean;
}

function validPeriod(period: { start: string; end: string }): boolean {
  return (
    LocalDate.safeParse(period.start).success &&
    LocalDate.safeParse(period.end).success &&
    period.start <= period.end
  );
}

/**
 * The exceptions the editor shows: the ones the user added, plus the Jamaican public holidays
 * inside the period (FR-IMP-8) that they haven't removed (`dismissed`, by date), in date order.
 * Holidays follow the period: change the dates and the list is worked out again.
 */
export function withHolidays(
  exceptions: readonly EditableException[],
  period: { start: string; end: string },
  dismissed: readonly string[],
): EditableException[] {
  const own = exceptions.filter((e) => !e.holiday);
  const holidays = validPeriod(period)
    ? jamaicanHolidayExceptions(period.start, period.end)
        .filter((h) => !dismissed.includes(h.start))
        // Don't list a holiday twice when the user already added that day themselves.
        .filter((h) => !own.some((e) => e.start <= h.start && h.start <= e.end))
        .map((h) => ({ ...h, holiday: true }))
    : [];
  return [...own, ...holidays].sort((a, b) =>
    a.start === b.start ? a.end.localeCompare(b.end) : a.start.localeCompare(b.start),
  );
}

/** "Oct 19" for one day, "Oct 12 – Oct 16" for a range. */
export function formatDateRange(range: { start: string; end: string }): string {
  return range.start === range.end
    ? formatMonthDay(range.start)
    : `${formatMonthDay(range.start)} – ${formatMonthDay(range.end)}`;
}

/**
 * The first event that never happens in the period (its days or weeks all fall outside the
 * dates, or its date does), or -1. `commit_schedule` refuses those (WF302).
 */
export function firstEventOutsidePeriod(
  events: readonly Pick<EventDraft, 'start' | 'end' | 'when'>[],
  period: SchedulePeriod,
): number {
  return events.findIndex((e) =>
    e.when.kind === 'date'
      ? e.when.date < period.start || e.when.date > period.end
      : // Whether a weekly event has an occurrence doesn't depend on the timezone.
        eventTimesFromDraft(e, period, DEFAULT_TIMEZONE) === null,
  );
}

export type CheckedSchedule = { ok: true; draft: ScheduleCommit } | { ok: false; error: string };

/**
 * Checks a schedule before it's committed and returns what `commit_schedule` takes, with
 * editor-only fields (ids, the holiday flag) and anything unknown stripped. Error messages
 * name an event by its title, which is fine on screen (never log them, NFR-SEC-11).
 */
export function checkSchedule(input: { events: unknown[]; period: unknown }): CheckedSchedule {
  if (input.events.length === 0) return { ok: false, error: 'Add at least one event first.' };
  const parsed = ScheduleCommit.safeParse(input);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path ?? [];
    if (path[0] === 'events') return { ok: false, error: 'One of the events needs fixing.' };
    if (path[1] === 'exceptions') {
      // The list itself (too long), or one of its entries.
      return path.length === 2
        ? { ok: false, error: `That’s a lot of breaks. Keep at most ${SCHEDULE_MAX_EXCEPTIONS}.` }
        : { ok: false, error: 'Check the dates of your breaks and holidays.' };
    }
    const period = input.period as { start?: unknown; end?: unknown } | null;
    if (
      typeof period?.start === 'string' &&
      typeof period.end === 'string' &&
      validPeriod({ start: period.start, end: period.end })
    ) {
      return {
        ok: false,
        error: `A schedule can cover at most ${SCHEDULE_PERIOD_MAX_DAYS} days. Shorten the dates.`,
      };
    }
    return { ok: false, error: 'Check the start and end dates of your schedule.' };
  }
  const outside = firstEventOutsidePeriod(parsed.data.events, parsed.data.period);
  if (outside >= 0) {
    return {
      ok: false,
      error: outsideMessage(parsed.data.events[outside]?.title, parsed.data.period),
    };
  }
  return { ok: true, draft: parsed.data };
}

/** "“Lab” doesn't happen between Aug 31 and Dec 12. Check its days and the dates." */
export function outsideMessage(
  title: string | undefined,
  period: { start: string; end: string },
): string {
  const what = title ? `“${title}”` : 'One of the events';
  return `${what} doesn’t happen between ${formatMonthDay(period.start)} and ${formatMonthDay(period.end)}. Check its days and the dates.`;
}
