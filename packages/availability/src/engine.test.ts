import { fc, test } from '@fast-check/vitest';
import {
  DAYS_OF_WEEK,
  MANUAL_STATUSES,
  MANUAL_STATUS_TO_STATUS,
  type AvailableHours,
  type Status,
} from '@whosfree/shared';
import { describe, expect, it } from 'vitest';
import { busyIntervals, DEFAULT_UNTIL_HORIZON_MS, statusAt, timeline } from './engine';
import { DAY_MS, HOUR_MS, MINUTE_MS, msFromLocalTime } from './time';
import type { AvailabilityInput, ScheduleEvent, StatusOverride } from './types';

/** A Jamaica wall time (UTC−5 all year), e.g. `jm('2026-09-30T09:00')`. */
const jm = (local: string) => Date.parse(`${local}-05:00`);
const event = (id: string, start: string, end: string, extra: Partial<ScheduleEvent> = {}) => ({
  id,
  start: jm(start),
  end: jm(end),
  ...extra,
});
const withEvents = (
  events: ScheduleEvent[],
  extra: Partial<AvailabilityInput> = {},
): AvailabilityInput => ({ sources: [{ id: 'upload', events }], ...extra });

describe('statusAt precedence (PRD §6.6)', () => {
  const lecture = event('lecture', '2026-09-30T10:00', '2026-09-30T12:00');

  it('is free inside available hours with nothing on', () => {
    const now = jm('2026-09-30T09:00');
    expect(statusAt(withEvents([lecture]), now)).toEqual({
      status: 'free',
      cause: { type: 'available' },
      until: jm('2026-09-30T10:00'),
      nextStatus: 'busy',
    });
  });

  it('is busy during an event and says which one', () => {
    expect(statusAt(withEvents([lecture]), jm('2026-09-30T11:00'))).toEqual({
      status: 'busy',
      cause: { type: 'events', eventIds: ['lecture'] },
      until: jm('2026-09-30T12:00'),
      nextStatus: 'free',
    });
  });

  it('is away outside available hours, until they start', () => {
    expect(statusAt(withEvents([]), jm('2026-09-30T23:00'))).toEqual({
      status: 'away',
      cause: { type: 'outside_hours' },
      until: jm('2026-10-01T08:00'),
      nextStatus: 'free',
    });
  });

  it('is free until available hours end, then away', () => {
    const status = statusAt(withEvents([]), jm('2026-09-30T20:00'));
    expect(status.until).toBe(jm('2026-09-30T22:00'));
    expect(status.nextStatus).toBe('away');
  });

  it('puts busy events above available hours', () => {
    const late = event('late-shift', '2026-09-30T21:00', '2026-09-30T23:30');
    const status = statusAt(withEvents([late]), jm('2026-09-30T22:30'));
    expect(status.status).toBe('busy');
    expect(status.until).toBe(jm('2026-09-30T23:30'));
    expect(status.nextStatus).toBe('away');
  });

  it('shows no_schedule for a user with no sources, even outside hours', () => {
    const noSources: AvailabilityInput = { sources: [] };
    for (const time of ['2026-09-30T03:00', '2026-09-30T12:00']) {
      expect(statusAt(noSources, jm(time))).toEqual({
        status: 'no_schedule',
        cause: { type: 'no_schedule' },
        until: null,
        nextStatus: null,
      });
    }
  });

  it('counts a source with no events as a schedule', () => {
    expect(statusAt(withEvents([]), jm('2026-09-30T12:00')).status).toBe('free');
  });

  it('puts a manual override above no_schedule, events and hours', () => {
    const free = {
      status: 'free',
      startsAt: jm('2026-09-30T09:00'),
      endsAt: jm('2026-09-30T11:00'),
    } as const;
    expect(statusAt({ sources: [], overrides: [free] }, jm('2026-09-30T10:00'))).toMatchObject({
      status: 'free',
      cause: { type: 'override', manualStatus: 'free' },
      until: jm('2026-09-30T11:00'),
      nextStatus: 'no_schedule',
    });
    expect(
      statusAt(withEvents([lecture], { overrides: [free] }), jm('2026-09-30T10:30')),
    ).toMatchObject({
      status: 'free',
      until: jm('2026-09-30T11:00'),
      nextStatus: 'busy',
    });
    const dnd = { ...free, status: 'dnd' } as const;
    expect(statusAt(withEvents([], { overrides: [dnd] }), jm('2026-09-30T10:00')).status).toBe(
      'dnd',
    );
  });

  it('puts paused above everything, with no "until"', () => {
    const input = withEvents([lecture], {
      sharingPaused: true,
      overrides: [{ status: 'free', startsAt: jm('2026-09-30T00:00') }],
    });
    expect(statusAt(input, jm('2026-09-30T11:00'))).toEqual({
      status: 'paused',
      cause: { type: 'paused' },
      until: null,
      nextStatus: null,
    });
    expect(statusAt({ sources: [], sharingPaused: true }, 0).status).toBe('paused');
  });

  it('shows "Studying/Focused" as busy but keeps the manual status in the cause', () => {
    const focused = { id: 'o1', status: 'focused', startsAt: jm('2026-09-30T13:00') } as const;
    expect(statusAt(withEvents([], { overrides: [focused] }), jm('2026-09-30T14:00'))).toEqual({
      status: 'busy',
      cause: { type: 'override', manualStatus: 'focused', overrideId: 'o1' },
      until: null,
      nextStatus: null,
    });
  });

  it('maps every manual status as the shared constants say', () => {
    for (const manual of MANUAL_STATUSES) {
      const input = withEvents([], { overrides: [{ status: manual, startsAt: 0 }] });
      expect(statusAt(input, jm('2026-09-30T12:00')).status).toBe(MANUAL_STATUS_TO_STATUS[manual]);
    }
  });
});

describe('statusAt "until X" (D18)', () => {
  it('runs back-to-back classes together', () => {
    const input = withEvents([
      event('a', '2026-09-30T09:00', '2026-09-30T10:00'),
      event('b', '2026-09-30T10:00', '2026-09-30T11:00'),
      event('c', '2026-09-30T11:00', '2026-09-30T12:30'),
    ]);
    expect(statusAt(input, jm('2026-09-30T09:15'))).toEqual({
      status: 'busy',
      cause: { type: 'events', eventIds: ['a'] },
      until: jm('2026-09-30T12:30'),
      nextStatus: 'free',
    });
  });

  it('merges overlapping events from different sources', () => {
    const input: AvailabilityInput = {
      sources: [
        { id: 'upload', events: [event('class', '2026-09-30T09:00', '2026-09-30T11:00')] },
        { id: 'gcal', events: [event('meeting', '2026-09-30T10:00', '2026-09-30T13:00')] },
      ],
    };
    const status = statusAt(input, jm('2026-09-30T10:30'));
    expect(status.cause).toEqual({ type: 'events', eventIds: ['class', 'meeting'] });
    expect(status.until).toBe(jm('2026-09-30T13:00'));
    expect(
      busyIntervals(input, { start: jm('2026-09-30T00:00'), end: jm('2026-10-01T00:00') }),
    ).toEqual([{ start: jm('2026-09-30T09:00'), end: jm('2026-09-30T13:00') }]);
  });

  it('continues through a busy event followed by a "focused" override', () => {
    const input = withEvents([event('class', '2026-09-30T09:00', '2026-09-30T10:00')], {
      overrides: [
        { status: 'focused', startsAt: jm('2026-09-30T10:00'), endsAt: jm('2026-09-30T12:00') },
      ],
    });
    expect(statusAt(input, jm('2026-09-30T09:30')).until).toBe(jm('2026-09-30T12:00'));
  });

  it('continues free across midnight when available hours do', () => {
    const allDay = DAYS_OF_WEEK.map((day) => ({ day, start: '00:00', end: '23:59' }));
    const input = withEvents([], { availableHours: allDay });
    const status = statusAt(input, jm('2026-09-30T12:00'));
    expect(status).toMatchObject({
      status: 'free',
      until: jm('2026-09-30T23:59'),
      nextStatus: 'away',
    });
  });

  it('ends an "until I change it" override only if a later override starts', () => {
    const dnd = { status: 'dnd', startsAt: jm('2026-09-30T08:00') } as const;
    expect(statusAt(withEvents([], { overrides: [dnd] }), jm('2026-09-30T09:00')).until).toBeNull();
    const later = {
      status: 'away',
      startsAt: jm('2026-09-30T18:00'),
      endsAt: jm('2026-09-30T19:00'),
    } as const;
    expect(
      statusAt(withEvents([], { overrides: [dnd, later] }), jm('2026-09-30T09:00')),
    ).toMatchObject({
      status: 'dnd',
      until: jm('2026-09-30T18:00'),
      nextStatus: 'away',
    });
  });

  it('is null when nothing changes within the horizon', () => {
    const neverAvailable = withEvents([], { availableHours: [] });
    expect(statusAt(neverAvailable, jm('2026-09-30T12:00'))).toMatchObject({
      status: 'away',
      until: null,
    });
    expect(DEFAULT_UNTIL_HORIZON_MS).toBe(7 * DAY_MS);
    // A change 6 days out is found; one 8 days out is not.
    const sixDays = withEvents([event('x', '2026-10-06T12:00', '2026-10-06T13:00')], {
      availableHours: [],
    });
    expect(statusAt(sixDays, jm('2026-09-30T12:00')).until).toBe(jm('2026-10-06T12:00'));
    const eightDays = withEvents([event('x', '2026-10-08T12:00', '2026-10-08T13:00')], {
      availableHours: [],
    });
    expect(statusAt(eightDays, jm('2026-09-30T12:00')).until).toBeNull();
  });

  it('accepts a custom horizon and rejects a non-positive one', () => {
    const input = withEvents([event('x', '2026-09-30T15:00', '2026-09-30T16:00')]);
    expect(statusAt(input, jm('2026-09-30T12:00'), { horizonMs: HOUR_MS }).until).toBeNull();
    expect(statusAt(input, jm('2026-09-30T12:00'), { horizonMs: 4 * HOUR_MS }).until).toBe(
      jm('2026-09-30T15:00'),
    );
    expect(() => statusAt(input, 0, { horizonMs: 0 })).toThrow(RangeError);
    expect(() => statusAt(input, 0, { horizonMs: Number.NaN })).toThrow(RangeError);
  });

  it('ignores events that are not busy and events that have ended', () => {
    const input = withEvents([
      event('transparent', '2026-09-30T09:00', '2026-09-30T10:00', { busy: false }),
      event('done', '2026-09-30T07:00', '2026-09-30T09:00'),
      event('empty', '2026-09-30T09:30', '2026-09-30T09:30'),
    ]);
    expect(statusAt(input, jm('2026-09-30T09:00'))).toMatchObject({
      status: 'free',
      until: jm('2026-09-30T22:00'),
    });
  });

  it('includes an event that started before now', () => {
    const input = withEvents([event('shift', '2026-09-29T20:00', '2026-09-30T04:00')]);
    expect(statusAt(input, jm('2026-09-30T01:00'))).toMatchObject({
      status: 'busy',
      cause: { type: 'events', eventIds: ['shift'] },
      until: jm('2026-09-30T04:00'),
      nextStatus: 'away',
    });
  });
});

describe('manual overrides', () => {
  const t = (time: string) => jm(`2026-09-30T${time}`);

  it('lets the override that started last win, ties going to the later entry', () => {
    const overrides: StatusOverride[] = [
      { id: 'old', status: 'dnd', startsAt: t('08:00') },
      { id: 'new', status: 'free', startsAt: t('09:00'), endsAt: t('10:00') },
      { id: 'tie', status: 'away', startsAt: t('09:00'), endsAt: t('09:30') },
    ];
    const input = withEvents([], { overrides });
    expect(statusAt(input, t('09:15')).cause).toEqual({
      type: 'override',
      manualStatus: 'away',
      overrideId: 'tie',
    });
    expect(statusAt(input, t('09:45')).cause).toMatchObject({ overrideId: 'new' });
    // Once the newer overrides end, the older open-ended one applies again.
    expect(statusAt(input, t('10:00')).cause).toMatchObject({ overrideId: 'old' });
  });

  it('ignores overrides that have not started, have ended, or are empty', () => {
    const input = withEvents([], {
      overrides: [
        { status: 'dnd', startsAt: t('13:00') },
        { status: 'dnd', startsAt: t('08:00'), endsAt: t('09:00') },
        { status: 'dnd', startsAt: t('11:00'), endsAt: t('11:00') },
        { status: 'dnd', startsAt: t('11:30'), endsAt: t('11:00') },
      ],
    });
    expect(statusAt(input, t('11:00'))).toMatchObject({
      status: 'free',
      until: t('13:00'),
      nextStatus: 'dnd',
    });
  });

  it('keeps two back-to-back overrides with the same status as separate segments if they have ids', () => {
    const input = withEvents([], {
      overrides: [
        { id: 'a', status: 'busy', startsAt: t('09:00'), endsAt: t('10:00') },
        { id: 'b', status: 'busy', startsAt: t('10:00'), endsAt: t('11:00') },
      ],
    });
    const segments = timeline(input, { start: t('09:00'), end: t('11:00') });
    expect(segments.map((s) => s.cause)).toEqual([
      { type: 'override', manualStatus: 'busy', overrideId: 'a' },
      { type: 'override', manualStatus: 'busy', overrideId: 'b' },
    ]);
    expect(statusAt(input, t('09:00')).until).toBe(t('11:00'));
  });
});

describe('timeline', () => {
  it('covers the range with one segment per change of status or cause', () => {
    const input = withEvents([
      event('a', '2026-09-30T09:00', '2026-09-30T11:00'),
      event('b', '2026-09-30T10:00', '2026-09-30T12:00'),
    ]);
    const segments = timeline(input, {
      start: jm('2026-09-30T07:00'),
      end: jm('2026-09-30T23:00'),
    });
    expect(segments).toEqual([
      {
        start: jm('2026-09-30T07:00'),
        end: jm('2026-09-30T08:00'),
        status: 'away',
        cause: { type: 'outside_hours' },
      },
      {
        start: jm('2026-09-30T08:00'),
        end: jm('2026-09-30T09:00'),
        status: 'free',
        cause: { type: 'available' },
      },
      {
        start: jm('2026-09-30T09:00'),
        end: jm('2026-09-30T10:00'),
        status: 'busy',
        cause: { type: 'events', eventIds: ['a'] },
      },
      {
        start: jm('2026-09-30T10:00'),
        end: jm('2026-09-30T11:00'),
        status: 'busy',
        cause: { type: 'events', eventIds: ['a', 'b'] },
      },
      {
        start: jm('2026-09-30T11:00'),
        end: jm('2026-09-30T12:00'),
        status: 'busy',
        cause: { type: 'events', eventIds: ['b'] },
      },
      {
        start: jm('2026-09-30T12:00'),
        end: jm('2026-09-30T22:00'),
        status: 'free',
        cause: { type: 'available' },
      },
      {
        start: jm('2026-09-30T22:00'),
        end: jm('2026-09-30T23:00'),
        status: 'away',
        cause: { type: 'outside_hours' },
      },
    ]);
  });

  it('merges repeated occurrences of the same event id into one cause', () => {
    const input = withEvents([
      event('dup', '2026-09-30T09:00', '2026-09-30T11:00'),
      event('dup', '2026-09-30T10:00', '2026-09-30T12:00'),
    ]);
    const segments = timeline(input, {
      start: jm('2026-09-30T09:00'),
      end: jm('2026-09-30T12:00'),
    });
    expect(segments).toEqual([
      {
        start: jm('2026-09-30T09:00'),
        end: jm('2026-09-30T12:00'),
        status: 'busy',
        cause: { type: 'events', eventIds: ['dup'] },
      },
    ]);
  });

  it('returns [] for an empty range', () => {
    expect(timeline(withEvents([]), { start: 10, end: 10 })).toEqual([]);
    expect(timeline(withEvents([]), { start: 10, end: 5 })).toEqual([]);
  });

  it('throws for an unknown timezone', () => {
    expect(() =>
      timeline(withEvents([], { timeZone: 'Mars/Olympus' }), { start: 0, end: DAY_MS }),
    ).toThrow(RangeError);
  });
});

describe('recurring events (FR-AVL-6)', () => {
  // Mon/Wed 09:00–10:00 and 10:00–11:00, back to back, for a semester with a reading week.
  const semester = {
    start: '2026-09-07',
    end: '2026-12-11',
    exceptions: [{ start: '2026-10-12', end: '2026-10-16' }],
  };
  const input: AvailabilityInput = {
    sources: [
      {
        id: 'upload',
        period: semester,
        events: [
          {
            ...event('maths', '2026-09-07T09:00', '2026-09-07T10:00'),
            rrule: 'FREQ=WEEKLY;BYDAY=MO,WE',
          },
          {
            ...event('physics', '2026-09-07T10:00', '2026-09-07T11:00'),
            rrule: 'FREQ=WEEKLY;BYDAY=MO,WE',
          },
        ],
      },
      { id: 'gcal', events: [event('dentist', '2026-10-14T09:30', '2026-10-14T10:30')] },
    ],
  };

  it('expands classes and runs back-to-back ones together', () => {
    expect(statusAt(input, jm('2026-09-30T09:30'))).toEqual({
      status: 'busy',
      cause: { type: 'events', eventIds: ['maths'] },
      until: jm('2026-09-30T11:00'),
      nextStatus: 'free',
    });
  });

  it('skips classes in the period’s exceptions and after it ends, but not one-off events', () => {
    expect(statusAt(input, jm('2026-10-12T09:30')).status).toBe('free');
    expect(statusAt(input, jm('2026-10-14T09:45'))).toMatchObject({
      cause: { type: 'events', eventIds: ['dentist'] },
      until: jm('2026-10-14T10:30'),
    });
    expect(statusAt(input, jm('2026-12-14T09:30')).status).toBe('free');
    expect(
      busyIntervals(input, { start: jm('2026-12-07T00:00'), end: jm('2026-12-21T00:00') }),
    ).toEqual([
      { start: jm('2026-12-07T09:00'), end: jm('2026-12-07T11:00') },
      { start: jm('2026-12-09T09:00'), end: jm('2026-12-09T11:00') },
    ]);
  });
});

describe('timezones and DST (FR-AVL-9)', () => {
  const NY = 'America/New_York';
  const ny = (iso: string) => Date.parse(iso);

  it('defaults to America/Jamaica', () => {
    // 07:30 in Jamaica is away; in New York (EDT, an hour ahead) it would be 08:30 and free.
    expect(statusAt(withEvents([]), jm('2026-09-30T07:30')).status).toBe('away');
    expect(statusAt(withEvents([], { timeZone: NY }), jm('2026-09-30T07:30')).status).toBe('free');
  });

  it('is away until 08:00 local across spring-forward (a 9-hour night)', () => {
    const input = withEvents([], { timeZone: NY });
    const status = statusAt(input, ny('2026-03-07T23:00-05:00'));
    expect(status.until).toBe(ny('2026-03-08T08:00-04:00'));
    expect((status.until ?? 0) - ny('2026-03-07T22:00-05:00')).toBe(9 * HOUR_MS);
  });

  it('is away until 08:00 local across fall-back (an 11-hour night)', () => {
    const input = withEvents([], { timeZone: NY });
    const status = statusAt(input, ny('2026-10-31T23:00-04:00'));
    expect(status.until).toBe(ny('2026-11-01T08:00-05:00'));
    expect((status.until ?? 0) - ny('2026-10-31T22:00-04:00')).toBe(11 * HOUR_MS);
  });

  it('keeps UTC instants for events that span the DST change', () => {
    // A night shift 23:00–07:00 local; the night is an hour shorter at spring-forward.
    const shift = {
      id: 'shift',
      start: ny('2026-03-07T23:00-05:00'),
      end: ny('2026-03-08T07:00-04:00'),
    };
    const input = withEvents([shift], { timeZone: NY });
    expect(statusAt(input, ny('2026-03-08T01:59-05:00'))).toMatchObject({
      status: 'busy',
      until: ny('2026-03-08T07:00-04:00'),
      nextStatus: 'away',
    });
    expect(busyIntervals(input, { start: shift.start, end: shift.end })).toEqual([
      { start: shift.start, end: shift.start + 7 * HOUR_MS },
    ]);
  });

  it('handles an event that crosses midnight in a zone ahead of UTC', () => {
    const tokyo = (local: string) => Date.parse(`${local}+09:00`);
    const input = withEvents(
      [{ id: 'party', start: tokyo('2026-09-30T21:00'), end: tokyo('2026-10-01T01:00') }],
      { timeZone: 'Asia/Tokyo' },
    );
    const segments = timeline(input, {
      start: tokyo('2026-09-30T20:00'),
      end: tokyo('2026-10-01T09:00'),
    });
    expect(segments.map((s) => [s.status, s.end])).toEqual([
      ['free', tokyo('2026-09-30T21:00')],
      ['busy', tokyo('2026-10-01T01:00')],
      ['away', tokyo('2026-10-01T08:00')],
      ['free', tokyo('2026-10-01T09:00')],
    ]);
  });
});

// Property test: compare the engine with a direct, brute-force reading of the precedence rules.
// Everything sits on a 15-minute grid in Jamaica (fixed UTC−5), so checking each grid point
// checks every piece of the timeline.
describe('timeline and statusAt agree with a reference model', () => {
  const SLOT = 15 * MINUTE_MS;
  const BASE = jm('2026-09-28T00:00'); // a Monday
  const SLOTS_PER_DAY = DAY_MS / SLOT;

  const slot = (max: number) => fc.integer({ min: 0, max }).map((k) => BASE + k * SLOT);
  const scheduleEvent = fc
    .record({
      id: fc.constantFrom('a', 'b', 'c', 'd'),
      start: slot(4 * SLOTS_PER_DAY),
      length: fc.integer({ min: 1, max: 24 }),
    })
    .map(({ id, start, length }): ScheduleEvent => ({ id, start, end: start + length * SLOT }));
  const override = fc
    .record({
      id: fc.option(fc.constantFrom('x', 'y'), { nil: undefined }),
      status: fc.constantFrom(...MANUAL_STATUSES),
      startsAt: slot(4 * SLOTS_PER_DAY),
      length: fc.option(fc.integer({ min: 1, max: 40 }), { nil: undefined }),
    })
    .map(({ id, status, startsAt, length }): StatusOverride => ({
      ...(id === undefined ? {} : { id }),
      status,
      startsAt,
      endsAt: length === undefined ? null : startsAt + length * SLOT,
    }));
  const hour = fc.integer({ min: 0, max: 95 }).map((k) => {
    const minutes = k * 15;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  });
  const hoursEntry = fc
    .record({ day: fc.constantFrom(...DAYS_OF_WEEK), a: hour, b: hour })
    .filter(({ a, b }) => a !== b)
    .map(({ day, a, b }): AvailableHours => ({ day, start: a < b ? a : b, end: a < b ? b : a }));
  const input = fc.record({
    sharingPaused: fc.integer({ min: 0, max: 9 }).map((n) => n === 0),
    availableHours: fc.option(fc.array(hoursEntry, { maxLength: 8 }), { nil: undefined }),
    overrides: fc.array(override, { maxLength: 3 }),
    sources: fc.array(fc.record({ events: fc.array(scheduleEvent, { maxLength: 6 }) }), {
      maxLength: 2,
    }),
  });

  function reference(user: AvailabilityInput, t: number): Status {
    if (user.sharingPaused) return 'paused';
    let active: StatusOverride | undefined;
    for (const o of user.overrides ?? []) {
      if (
        o.startsAt <= t &&
        t < (o.endsAt ?? Infinity) &&
        (!active || o.startsAt >= active.startsAt)
      )
        active = o;
    }
    if (active) return MANUAL_STATUS_TO_STATUS[active.status];
    if (user.sources.length === 0) return 'no_schedule';
    const events = user.sources.flatMap((s) => s.events);
    if (events.some((e) => e.start <= t && t < e.end)) return 'busy';
    const localMs = t - 5 * HOUR_MS;
    const weekday = DAYS_OF_WEEK[(Math.floor(localMs / DAY_MS) + 3) % 7];
    const msOfDay = localMs - Math.floor(localMs / DAY_MS) * DAY_MS;
    const hours =
      user.availableHours ?? DAYS_OF_WEEK.map((day) => ({ day, start: '08:00', end: '22:00' }));
    const inside = hours.some(
      (h) =>
        h.day === weekday &&
        msFromLocalTime(h.start) <= msOfDay &&
        msOfDay < msFromLocalTime(h.end),
    );
    return inside ? 'free' : 'away';
  }

  test.prop([input, fc.integer({ min: 0, max: 3 * SLOTS_PER_DAY })], { numRuns: 200 })(
    'timeline',
    (user, k) => {
      const range = { start: BASE + k * SLOT, end: BASE + (k + 2 * SLOTS_PER_DAY) * SLOT };
      const segments = timeline(user, range);
      expect(segments[0]?.start).toBe(range.start);
      expect(segments[segments.length - 1]?.end).toBe(range.end);
      for (const [i, segment] of segments.entries()) {
        expect(segment.end).toBeGreaterThan(segment.start);
        const next = segments[i + 1];
        if (next) expect(next.start).toBe(segment.end);
        for (let t = segment.start; t < segment.end; t += SLOT) {
          expect(segment.status).toBe(reference(user, t));
        }
      }
    },
  );

  test.prop([input, fc.integer({ min: 0, max: 3 * SLOTS_PER_DAY })], { numRuns: 200 })(
    'statusAt',
    (user, k) => {
      const now = BASE + k * SLOT;
      const horizonMs = 2 * DAY_MS;
      const result = statusAt(user, now, { horizonMs });
      expect(result.status).toBe(reference(user, now));
      const end = result.until ?? now + horizonMs;
      for (let t = now; t < end; t += SLOT) expect(reference(user, t)).toBe(result.status);
      if (result.until !== null) {
        expect(reference(user, result.until)).toBe(result.nextStatus);
        expect(result.nextStatus).not.toBe(result.status);
      }
    },
  );
});
