import { z } from 'zod';
import {
  DAYS_OF_WEEK,
  DISPLAY_NAME_MAX_LENGTH,
  EVENT_CATEGORIES,
  EVENT_TITLE_MAX_LENGTH,
  MANUAL_STATUSES,
  OFFLINE_FRIEND_NICKNAME_MAX_LENGTH,
  PING_TEXT_MAX_LENGTH,
  SCHEDULE_EXCEPTION_LABEL_MAX_LENGTH,
  SCHEDULE_MAX_EVENTS,
  SCHEDULE_MAX_EXCEPTIONS,
  SCHEDULE_PERIOD_MAX_DAYS,
  STATUS_LABEL_MAX_LENGTH,
  TIERS,
} from './constants';

/** A wall-clock time in the owner's timezone, `HH:MM` (24-hour). */
export const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM (24-hour)');
export type LocalTime = z.infer<typeof LocalTime>;

/** A calendar date, `YYYY-MM-DD`. Checked to be a real date (no 2026-02-30). */
export const LocalDate = z.iso.date();
export type LocalDate = z.infer<typeof LocalDate>;

export const Tier = z.literal(TIERS);
export type Tier = z.infer<typeof Tier>;
export const DayOfWeek = z.enum(DAYS_OF_WEEK);
export type DayOfWeek = z.infer<typeof DayOfWeek>;
export const EventCategory = z.enum(EVENT_CATEGORIES);
export type EventCategory = z.infer<typeof EventCategory>;
export const ManualStatus = z.enum(MANUAL_STATUSES);
export type ManualStatus = z.infer<typeof ManualStatus>;

/**
 * Which weeks a weekly event happens in (FR-IMP-5). Week numbers count from the
 * schedule period's start week (week 1). "Week A / Week B" maps to odd / even.
 */
export const WeekPattern = z.discriminatedUnion('type', [
  z.object({ type: z.literal('every') }),
  z.object({ type: z.literal('alternating'), parity: z.enum(['odd', 'even']) }),
  z.object({
    type: z.literal('weeks'),
    weeks: z
      .array(z.int().min(1).max(60))
      .min(1)
      .refine((w) => new Set(w).size === w.length, 'Week numbers must be unique'),
  }),
]);
export type WeekPattern = z.infer<typeof WeekPattern>;

/** When an event happens: on certain weekdays (recurring), or on one specific date (FR-IMP-6). */
export const EventWhen = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('weekly'),
    days: z
      .array(DayOfWeek)
      .min(1)
      .refine((d) => new Set(d).size === d.length, 'Days must be unique'),
    pattern: WeekPattern,
  }),
  z.object({ kind: z.literal('date'), date: LocalDate }),
]);
export type EventWhen = z.infer<typeof EventWhen>;

/**
 * An event as produced by the parser or the event editor, before it's committed.
 *
 * Times are wall-clock times in the owner's timezone. If `end` is earlier than
 * `start`, the event runs past midnight into the next day (overnight shifts).
 *
 * There is deliberately **no location field** (D35). Unknown keys such as
 * `location` or `room` are stripped when parsing, so they can't be stored.
 */
export const EventDraft = z
  .object({
    title: z.string().trim().min(1).max(EVENT_TITLE_MAX_LENGTH),
    category: EventCategory,
    start: LocalTime,
    end: LocalTime,
    when: EventWhen,
    /** The parser's confidence, 0–1. Manual entries use 1. */
    confidence: z.number().min(0).max(1),
  })
  .refine((e) => e.start !== e.end, { message: 'An event must have a duration', path: ['end'] });
export type EventDraft = z.infer<typeof EventDraft>;

/** A date span, inclusive of both ends. */
export const DateRange = z
  .object({
    start: LocalDate,
    end: LocalDate,
    label: z.string().trim().max(SCHEDULE_EXCEPTION_LABEL_MAX_LENGTH).optional(),
  })
  .refine((r) => r.start <= r.end, { message: 'Start must be on or before end', path: ['end'] });
export type DateRange = z.infer<typeof DateRange>;

/** The dates a schedule covers, plus exceptions such as breaks and holidays (FR-IMP-7, FR-IMP-8). */
export const SchedulePeriod = z
  .object({
    start: LocalDate,
    end: LocalDate,
    exceptions: z.array(DateRange).default([]),
  })
  .refine((p) => p.start <= p.end, { message: 'Start must be on or before end', path: ['end'] });
export type SchedulePeriod = z.infer<typeof SchedulePeriod>;

/** The parser's output for one file (PRD §8.5, NFR-SEC-7). */
export const ParseDraft = z.object({
  events: z.array(EventDraft).max(SCHEDULE_MAX_EVENTS),
  /** A date range found in the file, if any (FR-IMP-7). The user confirms it. */
  suggestedPeriod: SchedulePeriod.optional(),
});
export type ParseDraft = z.infer<typeof ParseDraft>;

/** Days from `start` to `end` of a valid {@link DateRange}, counting both ends. */
function daysInRange(r: { start: string; end: string }): number {
  return (Date.parse(`${r.end}T00:00:00Z`) - Date.parse(`${r.start}T00:00:00Z`)) / 86_400_000 + 1;
}

/**
 * What `commit_schedule` takes (WF-030, PRD §8.5 step 7): the confirmed events and the period
 * they cover, from the review screen (an upload's draft) or manual entry (FR-IMP-12). Stricter
 * than {@link ParseDraft}: at least one event, a period of at most
 * {@link SCHEDULE_PERIOD_MAX_DAYS} days, at most {@link SCHEDULE_MAX_EXCEPTIONS} exceptions.
 * The database checks the same rules again and rejects unknown keys (D35: no location).
 *
 * Exceptions are stored on the source (`sources.period_exceptions`) and applied when the
 * schedule is expanded; Jamaican public holidays are pre-filled by the UI (FR-IMP-8,
 * `jamaicanPublicHolidays`). Every weekly event must happen at least once in the period.
 */
export const ScheduleCommit = z.object({
  events: z.array(EventDraft).min(1, 'Add at least one event').max(SCHEDULE_MAX_EVENTS),
  period: SchedulePeriod.refine(
    (p) => p.start > p.end || daysInRange(p) <= SCHEDULE_PERIOD_MAX_DAYS,
    {
      message: `A schedule can cover at most ${SCHEDULE_PERIOD_MAX_DAYS} days`,
      path: ['end'],
    },
  ).refine((p) => p.exceptions.length <= SCHEDULE_MAX_EXCEPTIONS, {
    message: `At most ${SCHEDULE_MAX_EXCEPTIONS} breaks or holidays`,
    path: ['exceptions'],
  }),
});
export type ScheduleCommit = z.infer<typeof ScheduleCommit>;

/** One day's available hours in local time (FR-AVL-2). `end` must be after `start`. */
export const AvailableHours = z
  .object({ day: DayOfWeek, start: LocalTime, end: LocalTime })
  .refine((h) => h.start < h.end, { message: 'End must be after start', path: ['end'] });
export type AvailableHours = z.infer<typeof AvailableHours>;

/**
 * Free-text ping or reply (D31, FR-PING-4): trimmed, 1–140 characters, plain text with no
 * control characters except tab and newline. Length counts Unicode code points, so an emoji
 * counts as one character. The database applies the same rules (`private.clean_ping_text`,
 * which also turns CRLF into LF first).
 */
export const PingText = z
  .string()
  .trim()
  .min(1)
  .refine((t) => [...t].length <= PING_TEXT_MAX_LENGTH, {
    message: `At most ${PING_TEXT_MAX_LENGTH} characters`,
  })
  // eslint-disable-next-line no-control-regex
  .refine((t) => !/[\u0000-\u0008\u000B-\u001F\u007F]/.test(t), {
    message: 'No control characters',
  });

/**
 * An offline friend's nickname (FR-SOC-14, D44): trimmed, 1–40 characters, no control
 * characters. Length counts Unicode code points, as the database does. Besides their schedule
 * it's the only thing stored about the person (NFR-COMP-9), so the UI should ask for a
 * nickname, not a full name or contact details.
 */
export const OfflineFriendNickname = z
  .string()
  .trim()
  .min(1, 'Enter a nickname')
  .refine((t) => [...t].length <= OFFLINE_FRIEND_NICKNAME_MAX_LENGTH, {
    message: `At most ${OFFLINE_FRIEND_NICKNAME_MAX_LENGTH} characters`,
  })
  .refine((t) => !/\p{Cc}/u.test(t), { message: 'No control characters' });
export type OfflineFriendNickname = z.infer<typeof OfflineFriendNickname>;

/**
 * The optional label on a manual status (FR-AVL-3, J5), e.g. "Revising for MATH1141": trimmed,
 * 1–40 characters, no control characters. Length counts Unicode code points, as `set_status` does.
 * An empty label means none. The UI shouldn't invite a location here (D35).
 */
export const StatusLabel = z
  .string()
  .trim()
  .min(1, 'Enter a label')
  .refine((t) => [...t].length <= STATUS_LABEL_MAX_LENGTH, {
    message: `At most ${STATUS_LABEL_MAX_LENGTH} characters`,
  })
  .refine((t) => !/\p{Cc}/u.test(t), { message: 'No control characters' });
export type StatusLabel = z.infer<typeof StatusLabel>;

/**
 * A display name (FR-AUTH-2, PRD §9 `users.name`): trimmed, 1–100 characters (code points, as
 * the database counts), no control characters.
 */
export const DisplayName = z
  .string()
  .trim()
  .min(1, 'Add your name')
  .refine((t) => [...t].length <= DISPLAY_NAME_MAX_LENGTH, {
    message: `At most ${DISPLAY_NAME_MAX_LENGTH} characters`,
  })
  .refine((t) => !/\p{Cc}/u.test(t), { message: 'No control characters' });
export type DisplayName = z.infer<typeof DisplayName>;
