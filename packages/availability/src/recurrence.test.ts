import { fc, test } from '@fast-check/vitest';
import {
  DAYS_OF_WEEK,
  type DayOfWeek,
  type EventDraft,
  type SchedulePeriod,
  type WeekPattern,
} from '@whosfree/shared';
import { describe, expect, it } from 'vitest';
import { eventTimesFromDraft, expandEvent, type Occurrence } from './recurrence';
import { DAY_MS, HOUR_MS } from './time';
import type { ScheduleEvent } from './types';

const JM = 'America/Jamaica';
const NY = 'America/New_York';
const at = (iso: string) => Date.parse(iso);
const jm = (local: string) => at(`${local}-05:00`);

// Independent of the code under test: read local dates and times with Intl directly.
const localDate = (t: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(t);
const localTime = (t: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(t);
const dates = (occurrences: readonly Occurrence[], timeZone: string) =>
  occurrences.map((o) => localDate(o.start, timeZone));

const period = (start: string, end: string, exceptions: SchedulePeriod['exceptions'] = []) => ({
  start,
  end,
  exceptions,
});
/** A weekly class, Mon & Wed 09:00–10:00 Jamaica, from Mon 7 Sep 2026. */
const lecture: ScheduleEvent = {
  id: 'lecture',
  start: jm('2026-09-07T09:00'),
  end: jm('2026-09-07T10:00'),
  rrule: 'FREQ=WEEKLY;WKST=MO;BYDAY=MO,WE',
};
const semester = period('2026-09-07', '2026-12-11', [
  { start: '2026-10-12', end: '2026-10-16', label: 'Reading week' },
  { start: '2026-10-19', end: '2026-10-19', label: 'National Heroes Day' },
]);

describe('expandEvent: one-off events', () => {
  const party = { id: 'party', start: jm('2026-09-30T20:00'), end: jm('2026-09-30T23:00') };

  it('returns the event if it overlaps the range, ignoring the period', () => {
    const range = { start: jm('2026-09-30T22:00'), end: jm('2026-10-01T00:00') };
    expect(expandEvent(party, range, JM, period('2027-01-01', '2027-02-01'))).toEqual([
      { eventId: 'party', start: party.start, end: party.end },
    ]);
    expect(expandEvent(party, { start: party.end, end: party.end + HOUR_MS }, JM)).toEqual([]);
  });

  it('returns nothing for an empty range or an empty event', () => {
    expect(expandEvent(party, { start: 5, end: 5 }, JM)).toEqual([]);
    const empty = { ...lecture, end: lecture.start };
    expect(expandEvent(empty, { start: 0, end: at('2030-01-01') }, JM)).toEqual([]);
  });
});

describe('expandEvent: weekly rules', () => {
  it('expands within the range, skipping the period’s exceptions', () => {
    const range = { start: jm('2026-10-05T00:00'), end: jm('2026-10-26T00:00') };
    const occurrences = expandEvent(lecture, range, JM, semester);
    expect(dates(occurrences, JM)).toEqual(['2026-10-05', '2026-10-07', '2026-10-21']);
    expect(occurrences[0]).toEqual({
      eventId: 'lecture',
      start: jm('2026-10-05T09:00'),
      end: jm('2026-10-05T10:00'),
    });
  });

  it('stops at the period’s start and end dates, inclusive', () => {
    const occurrences = expandEvent(lecture, { start: 0, end: at('2030-01-01') }, JM, semester);
    // 14 weeks × 2 classes, less Oct 12 and 14 (reading week) and Oct 19 (holiday).
    expect(occurrences).toHaveLength(25);
    expect(localDate(occurrences[0]?.start ?? 0, JM)).toBe('2026-09-07');
    expect(localDate(occurrences.at(-1)?.start ?? 0, JM)).toBe('2026-12-09');
    const late = period('2026-09-10', '2026-09-14');
    expect(dates(expandEvent(lecture, { start: 0, end: at('2030-01-01') }, JM, late), JM)).toEqual([
      '2026-09-14',
    ]);
  });

  it('repeats forever without a period or an end', () => {
    const range = { start: jm('2031-06-02T00:00'), end: jm('2031-06-09T00:00') };
    expect(dates(expandEvent(lecture, range, JM), JM)).toEqual(['2031-06-02', '2031-06-04']);
  });

  it('skips EXDATEs', () => {
    const cancelled = { ...lecture, exdates: [jm('2026-09-09T09:00')] };
    const range = { start: jm('2026-09-07T00:00'), end: jm('2026-09-14T00:00') };
    expect(dates(expandEvent(cancelled, range, JM), JM)).toEqual(['2026-09-07']);
  });

  it('includes an occurrence that started before the range', () => {
    const nightShift = {
      id: 'night',
      start: jm('2026-09-04T22:00'),
      end: jm('2026-09-05T06:00'),
      rrule: 'FREQ=WEEKLY;BYDAY=FR',
    };
    const range = { start: jm('2026-09-12T05:00'), end: jm('2026-09-12T07:00') };
    expect(expandEvent(nightShift, range, JM)).toEqual([
      { eventId: 'night', start: jm('2026-09-11T22:00'), end: jm('2026-09-12T06:00') },
    ]);
  });

  it('repeats on the start’s weekday when BYDAY is missing, every other week with INTERVAL=2', () => {
    const fortnightly = { ...lecture, rrule: 'FREQ=WEEKLY;INTERVAL=2' };
    const range = { start: jm('2026-09-01T00:00'), end: jm('2026-10-15T00:00') };
    expect(dates(expandEvent(fortnightly, range, JM), JM)).toEqual([
      '2026-09-07',
      '2026-09-21',
      '2026-10-05',
    ]);
  });

  it('follows the RFC 5545 WKST example', () => {
    // RFC 5545 §3.3.10: WKST changes which weeks INTERVAL=2 picks.
    const start = at('1997-08-05T09:00-04:00');
    const event = { id: 'rfc', start, end: start + HOUR_MS };
    const range = { start: at('1997-01-01'), end: at('1998-01-01') };
    const rule = 'FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU';
    expect(dates(expandEvent({ ...event, rrule: `${rule};WKST=MO` }, range, NY), NY)).toEqual([
      '1997-08-05',
      '1997-08-10',
      '1997-08-19',
      '1997-08-24',
    ]);
    expect(dates(expandEvent({ ...event, rrule: `${rule};WKST=SU` }, range, NY), NY)).toEqual([
      '1997-08-05',
      '1997-08-17',
      '1997-08-19',
      '1997-08-31',
    ]);
  });

  it('counts COUNT from the first occurrence, before exceptions and EXDATEs', () => {
    const three = {
      ...lecture,
      rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=3',
      exdates: [jm('2026-09-09T09:00')],
    };
    const all = { start: 0, end: at('2030-01-01') };
    expect(dates(expandEvent(three, all, JM), JM)).toEqual(['2026-09-07', '2026-09-14']);
    const later = { start: jm('2026-09-10T00:00'), end: at('2030-01-01') };
    expect(dates(expandEvent(three, later, JM), JM)).toEqual(['2026-09-14']);
  });

  it('stops at UNTIL, inclusive, as a date or a UTC instant', () => {
    const all = { start: 0, end: at('2030-01-01') };
    const byDate = { ...lecture, rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20260914' };
    expect(dates(expandEvent(byDate, all, JM), JM)).toEqual([
      '2026-09-07',
      '2026-09-09',
      '2026-09-14',
    ]);
    const byInstant = { ...lecture, rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20260914T140000Z' };
    expect(dates(expandEvent(byInstant, all, JM), JM)).toEqual([
      '2026-09-07',
      '2026-09-09',
      '2026-09-14',
    ]);
    const justBefore = { ...lecture, rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20260914T135959Z' };
    expect(dates(expandEvent(justBefore, all, JM), JM)).toEqual(['2026-09-07', '2026-09-09']);
  });

  it('always includes the first occurrence, even off the rule (RFC 5545)', () => {
    const offRule = { ...lecture, rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=2' };
    expect(dates(expandEvent(offRule, { start: 0, end: at('2030-01-01') }, JM), JM)).toEqual([
      '2026-09-07',
      '2026-09-08',
    ]);
  });

  it('supports daily rules with an interval and BYDAY', () => {
    const range = { start: jm('2026-09-07T00:00'), end: jm('2026-09-21T00:00') };
    const everyOtherDay = { ...lecture, rrule: 'FREQ=DAILY;INTERVAL=2' };
    expect(dates(expandEvent(everyOtherDay, range, JM), JM)).toEqual([
      '2026-09-07',
      '2026-09-09',
      '2026-09-11',
      '2026-09-13',
      '2026-09-15',
      '2026-09-17',
      '2026-09-19',
    ]);
    const weekdays = { ...lecture, rrule: 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;COUNT=6' };
    expect(dates(expandEvent(weekdays, range, JM), JM)).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-14',
    ]);
  });

  it('throws for a rule outside the supported subset', () => {
    const monthly = { ...lecture, rrule: 'FREQ=MONTHLY;BYMONTHDAY=1' };
    expect(() => expandEvent(monthly, { start: 0, end: at('2030-01-01') }, JM)).toThrow(RangeError);
  });
});

describe('expandEvent: DST (FR-AVL-9)', () => {
  const range = { start: at('2026-02-01T00:00Z'), end: at('2026-12-31T00:00Z') };

  it('keeps a 09:00 class at 09:00 local across both DST changes', () => {
    const start = at('2026-03-02T09:00-05:00'); // a Monday, before spring-forward
    const event = { id: 'c', start, end: start + HOUR_MS, rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=40' };
    const occurrences = expandEvent(event, range, NY);
    expect(occurrences).toHaveLength(40);
    for (const o of occurrences) {
      expect(localTime(o.start, NY)).toBe('09:00');
      expect(o.end - o.start).toBe(HOUR_MS);
    }
    expect(occurrences[0]?.start).toBe(at('2026-03-02T14:00Z'));
    expect(occurrences[1]?.start).toBe(at('2026-03-09T13:00Z'));
    const november = occurrences.filter((o) => localDate(o.start, NY) >= '2026-10-26').slice(0, 2);
    expect(november.map((o) => o.start)).toEqual([
      at('2026-10-26T13:00Z'),
      at('2026-11-02T14:00Z'),
    ]);
  });

  it('keeps an overnight shift’s local times, so its length changes on DST nights', () => {
    // Saturdays 22:00 → Sunday 06:00, from 28 Feb.
    const start = at('2026-02-28T22:00-05:00');
    const event = { id: 'n', start, end: at('2026-03-01T06:00-05:00'), rrule: 'FREQ=WEEKLY' };
    const byDate = new Map(expandEvent(event, range, NY).map((o) => [localDate(o.start, NY), o]));
    const hours = (date: string) => {
      const o = byDate.get(date);
      return o ? (o.end - o.start) / HOUR_MS : NaN;
    };
    expect(byDate.get('2026-03-07')).toEqual({
      eventId: 'n',
      start: at('2026-03-07T22:00-05:00'),
      end: at('2026-03-08T06:00-04:00'),
    });
    expect([hours('2026-02-28'), hours('2026-03-07'), hours('2026-03-14')]).toEqual([8, 7, 8]);
    expect([hours('2026-10-24'), hours('2026-10-31'), hours('2026-11-07')]).toEqual([8, 9, 8]);
    for (const o of byDate.values()) {
      expect([localTime(o.start, NY), localTime(o.end, NY)]).toEqual(['22:00', '06:00']);
    }
  });

  it('moves an occurrence in the spring-forward gap forward, keeping its length', () => {
    const start = at('2026-03-01T02:30-05:00'); // Sundays 02:30–03:30
    const event = { id: 'g', start, end: start + HOUR_MS, rrule: 'FREQ=WEEKLY;COUNT=3' };
    const occurrences = expandEvent(event, range, NY);
    expect(occurrences.map((o) => localTime(o.start, NY))).toEqual(['02:30', '03:30', '02:30']);
    // 02:30 doesn't exist on 8 March. RFC 5545 reads it with the offset before the gap (03:30),
    // which would make it 03:30–03:30, so it keeps the first occurrence's length instead.
    expect(occurrences[1]).toEqual({
      eventId: 'g',
      start: at('2026-03-08T03:30-04:00'),
      end: at('2026-03-08T04:30-04:00'),
    });
  });

  it('uses the first of the two 01:30s at fall-back', () => {
    const start = at('2026-10-25T01:30-04:00');
    const event = { id: 'f', start, end: start + HOUR_MS / 2, rrule: 'FREQ=WEEKLY;COUNT=2' };
    const [, fallBack] = expandEvent(event, range, NY);
    expect(fallBack).toEqual({
      eventId: 'f',
      start: at('2026-11-01T01:30-04:00'),
      end: at('2026-11-01T02:00-05:00'),
    });
  });

  it('matches EXDATEs on DST days', () => {
    const start = at('2026-03-02T09:00-05:00');
    const event = {
      id: 'c',
      start,
      end: start + HOUR_MS,
      rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=3',
      exdates: [at('2026-03-09T09:00-04:00')],
    };
    expect(dates(expandEvent(event, range, NY), NY)).toEqual(['2026-03-02', '2026-03-16']);
  });
});

describe('eventTimesFromDraft', () => {
  const draft = (when: EventDraft['when'], start = '09:00', end = '10:00') => ({
    start,
    end,
    when,
  });
  const weekly = (days: DayOfWeek[], pattern: WeekPattern) =>
    draft({ kind: 'weekly', days, pattern });

  it('turns a dated draft into a one-off event, overnight if the end is earlier', () => {
    expect(eventTimesFromDraft(draft({ kind: 'date', date: '2026-10-03' }), semester, JM)).toEqual({
      start: jm('2026-10-03T09:00'),
      end: jm('2026-10-03T10:00'),
      rrule: null,
      exdates: [],
    });
    expect(
      eventTimesFromDraft(
        draft({ kind: 'date', date: '2026-10-03' }, '22:00', '06:00'),
        semester,
        JM,
      ),
    ).toMatchObject({ start: jm('2026-10-03T22:00'), end: jm('2026-10-04T06:00') });
  });

  it('encodes "every week" as a weekly rule starting on the first matching day', () => {
    // The semester starts on a Monday; Wednesday's class starts on the 9th.
    expect(eventTimesFromDraft(weekly(['fri', 'wed'], { type: 'every' }), semester, JM)).toEqual({
      start: jm('2026-09-09T09:00'),
      end: jm('2026-09-09T10:00'),
      rrule: 'FREQ=WEEKLY;WKST=MO;BYDAY=WE,FR',
      exdates: [],
    });
  });

  it('encodes alternating weeks as INTERVAL=2, anchored on a week of the right parity', () => {
    // A period starting on a Thursday: week 1 is that partial week (Mon 7 – Sun 13 Sep).
    const midWeek = period('2026-09-10', '2026-10-11');
    const odd = eventTimesFromDraft(
      weekly(['mon', 'fri'], { type: 'alternating', parity: 'odd' }),
      midWeek,
      JM,
    );
    expect(odd).toEqual({
      start: jm('2026-09-11T09:00'),
      end: jm('2026-09-11T10:00'),
      rrule: 'FREQ=WEEKLY;INTERVAL=2;WKST=MO;BYDAY=MO,FR',
      exdates: [],
    });
    const even = eventTimesFromDraft(
      weekly(['mon'], { type: 'alternating', parity: 'even' }),
      midWeek,
      JM,
    );
    expect(even?.start).toBe(jm('2026-09-14T09:00'));
  });

  it('encodes specific weeks as a weekly rule with UNTIL and EXDATEs for the other weeks', () => {
    const stored = eventTimesFromDraft(
      weekly(['tue'], { type: 'weeks', weeks: [5, 1, 2, 4] }),
      semester,
      JM,
    );
    expect(stored).toEqual({
      start: jm('2026-09-08T09:00'),
      end: jm('2026-09-08T10:00'),
      rrule: `FREQ=WEEKLY;WKST=MO;BYDAY=TU;UNTIL=${'20261006T140000Z'}`,
      exdates: [jm('2026-09-22T09:00')],
    });
  });

  it('returns null when nothing happens in the period', () => {
    expect(
      eventTimesFromDraft(weekly(['mon'], { type: 'weeks', weeks: [30] }), semester, JM),
    ).toBeNull();
    expect(
      eventTimesFromDraft(
        weekly(['sat'], { type: 'every' }),
        period('2026-09-07', '2026-09-09'),
        JM,
      ),
    ).toBeNull();
  });

  it('round-trips the examples from FR-IMP-5 onto exactly the right dates', () => {
    // "Weeks 1–6, 8–12", Mondays and Thursdays, in the semester with its breaks.
    const weeks = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
    const stored = eventTimesFromDraft(
      weekly(['mon', 'thu'], { type: 'weeks', weeks }),
      semester,
      JM,
    );
    expect(stored).not.toBeNull();
    const event = { id: 'x', ...(stored as NonNullable<typeof stored>) };
    const expanded = dates(
      expandEvent(event, { start: 0, end: at('2030-01-01') }, JM, semester),
      JM,
    );
    expect(expanded).toEqual([
      '2026-09-07',
      '2026-09-10',
      '2026-09-14',
      '2026-09-17',
      '2026-09-21',
      '2026-09-24',
      '2026-09-28',
      '2026-10-01',
      '2026-10-05',
      '2026-10-08',
      // Week 6 (Oct 12–16) is reading week. Week 7 (Oct 19–25) isn't chosen.
      '2026-10-26',
      '2026-10-29',
      '2026-11-02',
      '2026-11-05',
      '2026-11-09',
      '2026-11-12',
      '2026-11-16',
      '2026-11-19',
      '2026-11-23',
      '2026-11-26',
    ]);
  });
});

// Round trip: draft → stored form → expansion must land on exactly the dates a direct reading
// of the draft gives, at the draft's local times, in zones with and without DST.
describe('draft → stored → expand round trip', () => {
  const dayNumber = (date: string) => at(`${date}T00:00:00Z`) / DAY_MS;
  const dateOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
  // Avoid 01:00–03:00, where DST makes wall times skip or repeat (tested separately above).
  const time = fc
    .integer({ min: 0, max: 24 * 4 - 1 })
    .filter((q) => q < 4 || q >= 12)
    .map(
      (q) =>
        `${String(Math.floor(q / 4)).padStart(2, '0')}:${String((q % 4) * 15).padStart(2, '0')}`,
    );
  const pattern: fc.Arbitrary<WeekPattern> = fc.oneof(
    fc.constant({ type: 'every' as const }),
    fc
      .constantFrom('odd' as const, 'even' as const)
      .map((parity) => ({ type: 'alternating' as const, parity })),
    fc
      .uniqueArray(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 8 })
      .map((weeks) => ({
        type: 'weeks' as const,
        weeks,
      })),
  );
  const scenario = fc.record({
    timeZone: fc.constantFrom(JM, NY, 'Europe/London', 'Australia/Sydney'),
    startDay: fc.integer({ min: dayNumber('2026-01-01'), max: dayNumber('2027-12-31') }),
    length: fc.integer({ min: 0, max: 130 }),
    exceptions: fc.array(
      fc.record({
        offset: fc.integer({ min: 0, max: 130 }),
        length: fc.integer({ min: 0, max: 10 }),
      }),
      {
        maxLength: 3,
      },
    ),
    days: fc.uniqueArray(fc.constantFrom(...DAYS_OF_WEEK), { minLength: 1, maxLength: 7 }),
    pattern,
    start: time,
    end: time,
  });

  test.prop([scenario], { numRuns: 150 })('lands on exactly the right dates and times', (s) => {
    fc.pre(s.start !== s.end);
    const p: SchedulePeriod = {
      start: dateOf(s.startDay),
      end: dateOf(s.startDay + s.length),
      exceptions: s.exceptions.map((e) => ({
        start: dateOf(s.startDay + e.offset),
        end: dateOf(s.startDay + e.offset + e.length),
      })),
    };
    const when = { kind: 'weekly' as const, days: s.days, pattern: s.pattern };

    // Direct reading of the draft: weekday, week number from the period's first Monday, breaks.
    const monday = s.startDay - ((((s.startDay + 3) % 7) + 7) % 7);
    const expected: string[] = [];
    for (let day = s.startDay; day <= s.startDay + s.length; day++) {
      const week = Math.floor((day - monday) / 7) + 1;
      const weekday = DAYS_OF_WEEK[(((day + 3) % 7) + 7) % 7] as DayOfWeek;
      const chosen =
        s.pattern.type === 'every' ||
        (s.pattern.type === 'alternating' && week % 2 === (s.pattern.parity === 'odd' ? 1 : 0)) ||
        (s.pattern.type === 'weeks' && s.pattern.weeks.includes(week));
      const date = dateOf(day);
      const inBreak = p.exceptions.some((e) => e.start <= date && date <= e.end);
      if (chosen && s.days.includes(weekday) && !inBreak) expected.push(date);
    }

    const stored = eventTimesFromDraft({ start: s.start, end: s.end, when }, p, s.timeZone);
    if (stored === null) {
      expect(expected).toEqual([]);
      return;
    }
    const range = {
      start: at(`${p.start}T00:00Z`) - 2 * DAY_MS,
      end: at(`${p.end}T00:00Z`) + 3 * DAY_MS,
    };
    const occurrences = expandEvent({ id: 'e', ...stored }, range, s.timeZone, p);
    expect(dates(occurrences, s.timeZone)).toEqual(expected);
    for (const o of occurrences) {
      expect(localTime(o.start, s.timeZone)).toBe(s.start);
      expect(localTime(o.end, s.timeZone)).toBe(s.end);
      expect(o.end).toBeGreaterThan(o.start);
    }
  });
});
