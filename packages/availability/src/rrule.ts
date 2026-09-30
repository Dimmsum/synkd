// The subset of RFC 5545 recurrence rules the engine understands (FR-AVL-6).
//
// We only ever write weekly rules (see `eventTimesFromDraft`), and Google events arrive
// already expanded (`singleEvents=true`), so the engine supports FREQ=DAILY/WEEKLY with
// INTERVAL, BYDAY (plain weekdays), COUNT, UNTIL and WKST. Anything else is rejected loudly
// rather than expanded wrongly.

import { dayFromDate } from './time';

/** RFC 5545 weekday codes, Monday first (same order as `DAYS_OF_WEEK`). */
export const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

/** A parsed recurrence rule. Weekdays are numbered Monday = 0 … Sunday = 6. */
export interface RecurrenceRule {
  readonly freq: 'DAILY' | 'WEEKLY';
  readonly interval: number;
  /** BYDAY, sorted. `null` when absent: a weekly rule then repeats on DTSTART's weekday. */
  readonly byDay: readonly number[] | null;
  readonly count: number | null;
  /** UNTIL, inclusive: an instant (UTC epoch ms) or a local calendar day number. */
  readonly until:
    | { readonly kind: 'instant'; readonly at: number }
    | { readonly kind: 'date'; readonly day: number }
    | null;
  /** WKST, the first day of the week. Defaults to Monday, as in RFC 5545. */
  readonly weekStart: number;
}

function positiveInteger(name: string, value: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw new RangeError(`RRULE ${name} must be a positive integer`);
  return Number(value);
}

function weekday(value: string): number {
  const index = (WEEKDAY_CODES as readonly string[]).indexOf(value);
  if (index < 0) throw new RangeError(`Unsupported RRULE weekday: ${value}`);
  return index;
}

function parseUntil(value: string): RecurrenceRule['until'] {
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (date) return { kind: 'date', day: dayFromDate(`${date[1]}-${date[2]}-${date[3]}`) };
  const instant = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  const at = instant
    ? Date.parse(
        `${instant[1]}-${instant[2]}-${instant[3]}T${instant[4]}:${instant[5]}:${instant[6]}Z`,
      )
    : NaN;
  if (Number.isNaN(at)) {
    throw new RangeError(`RRULE UNTIL must be YYYYMMDD or YYYYMMDDTHHMMSSZ, got ${value}`);
  }
  return { kind: 'instant', at };
}

/**
 * Parses an RFC 5545 RRULE value such as `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE`, with or
 * without a leading `RRULE:`.
 *
 * Throws a `RangeError` for anything outside the supported subset (other frequencies,
 * BYMONTH, BYSETPOS, ordinal weekdays like `2MO`, floating UNTIL, …) or for a malformed rule,
 * so a bad rule is caught when it's written rather than silently expanded wrongly.
 */
export function parseRRule(rule: string): RecurrenceRule {
  const parts = new Map<string, string>();
  for (const part of rule
    .trim()
    .replace(/^RRULE:/i, '')
    .split(';')) {
    if (part.trim() === '') continue; // tolerate a trailing ';'
    const [key, value, ...rest] = part.split('=');
    const name = (key as string).trim().toUpperCase();
    if (!name || value === undefined || rest.length > 0 || parts.has(name)) {
      throw new RangeError(`Malformed RRULE: ${rule}`);
    }
    parts.set(name, value.trim().toUpperCase());
  }

  let freq: RecurrenceRule['freq'] | undefined;
  let interval = 1;
  let byDay: number[] | null = null;
  let count: number | null = null;
  let until: RecurrenceRule['until'] = null;
  let weekStart = 0;
  for (const [name, value] of parts) {
    switch (name) {
      case 'FREQ':
        if (value !== 'DAILY' && value !== 'WEEKLY') {
          throw new RangeError(`Unsupported RRULE FREQ: ${value}`);
        }
        freq = value;
        break;
      case 'INTERVAL':
        interval = positiveInteger(name, value);
        break;
      case 'COUNT':
        count = positiveInteger(name, value);
        break;
      case 'UNTIL':
        until = parseUntil(value);
        break;
      case 'BYDAY':
        byDay = [...new Set(value.split(',').map(weekday))].sort((a, b) => a - b);
        break;
      case 'WKST':
        weekStart = weekday(value);
        break;
      default:
        throw new RangeError(`Unsupported RRULE part: ${name}`);
    }
  }
  if (!freq) throw new RangeError(`RRULE needs FREQ: ${rule}`);
  if (count !== null && until !== null) {
    throw new RangeError('RRULE cannot have both COUNT and UNTIL');
  }
  return { freq, interval, byDay, count, until, weekStart };
}

/** Formats an instant as an RFC 5545 UTC date-time, e.g. `20261212T140000Z`. */
export function formatUtcDateTime(t: number): string {
  return new Date(t)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}
