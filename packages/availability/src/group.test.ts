import { fc, test } from '@fast-check/vitest';
import {
  DAYS_OF_WEEK,
  MANUAL_STATUSES,
  type DayOfWeek,
  type SchedulePeriod,
  type WeekPattern,
} from '@whosfree/shared';
import { describe, expect, it } from 'vitest';
import { statusAt } from './engine';
import { freeIntervals, userFreeIntervals, type UserAvailability } from './group';
import { eventTimesFromDraft } from './recurrence';
import { DAY_MS, HOUR_MS, MINUTE_MS } from './time';
import type { ScheduleEvent, StatusOverride } from './types';

const jm = (local: string) => Date.parse(`${local}-05:00`);
const day = { start: jm('2026-09-30T00:00'), end: jm('2026-10-01T00:00') };
const user = (
  userId: string,
  events: ScheduleEvent[] = [],
  extra: Partial<UserAvailability> = {},
) => ({
  userId,
  sources: [{ events }],
  ...extra,
});
const busy = (id: string, start: string, end: string) => ({
  id,
  start: jm(`2026-09-30T${start}`),
  end: jm(`2026-09-30T${end}`),
});

describe('freeIntervals', () => {
  it('splits the range by who is free', () => {
    const users = [
      user('ana', [busy('a', '10:00', '12:00')]),
      user('ben', [busy('b', '11:00', '13:00')]),
    ];
    const segments = freeIntervals(users, day);
    expect(segments.map((s) => [s.start, s.end, s.freeUserIds, s.notFreeUserIds])).toEqual([
      [jm('2026-09-30T00:00'), jm('2026-09-30T08:00'), [], ['ana', 'ben']],
      [jm('2026-09-30T08:00'), jm('2026-09-30T10:00'), ['ana', 'ben'], []],
      [jm('2026-09-30T10:00'), jm('2026-09-30T11:00'), ['ben'], ['ana']],
      [jm('2026-09-30T11:00'), jm('2026-09-30T12:00'), [], ['ana', 'ben']],
      [jm('2026-09-30T12:00'), jm('2026-09-30T13:00'), ['ana'], ['ben']],
      [jm('2026-09-30T13:00'), jm('2026-09-30T22:00'), ['ana', 'ben'], []],
      [jm('2026-09-30T22:00'), jm('2026-10-01T00:00'), [], ['ana', 'ben']],
    ]);
  });

  it('never counts paused or no-schedule users as free, unless they set "Free" by hand', () => {
    const freeOverride = {
      status: 'free',
      startsAt: jm('2026-09-30T15:00'),
      endsAt: jm('2026-09-30T16:00'),
    } as const;
    const users = [
      user('paused', [], { sharingPaused: true }),
      { userId: 'new', sources: [] },
      { userId: 'new-but-free', sources: [], overrides: [freeOverride] },
    ];
    const segments = freeIntervals(users, day);
    expect(segments.map((s) => s.freeUserIds)).toEqual([[], ['new-but-free'], []]);
    expect(segments[1]).toMatchObject({ start: freeOverride.startsAt, end: freeOverride.endsAt });
  });

  it('covers the range with one segment when there are no users, and returns [] for an empty range', () => {
    expect(freeIntervals([], day)).toEqual([{ ...day, freeUserIds: [], notFreeUserIds: [] }]);
    expect(freeIntervals([user('a')], { start: 5, end: 5 })).toEqual([]);
  });

  it('rejects duplicate user ids', () => {
    expect(() => freeIntervals([user('a'), user('a')], day)).toThrow(RangeError);
  });

  it('userFreeIntervals merges free time with different causes', () => {
    const override = {
      status: 'free',
      startsAt: jm('2026-09-30T22:00'),
      endsAt: jm('2026-09-30T23:00'),
    } as const;
    expect(userFreeIntervals(user('a', [], { overrides: [override] }), day)).toEqual([
      { start: jm('2026-09-30T08:00'), end: jm('2026-09-30T23:00') },
    ]);
  });

  // Property: segments tile the range, neighbours differ, and each user is listed as free in
  // a segment exactly when statusAt says they're free at its start.
  const SLOT = 15 * MINUTE_MS;
  const slot = fc.integer({ min: 0, max: 96 * 2 }).map((k) => day.start + k * SLOT);
  const randomUser = fc.record({
    sharingPaused: fc.integer({ min: 0, max: 9 }).map((n) => n === 0),
    overrides: fc.array(
      fc
        .record({
          status: fc.constantFrom(...MANUAL_STATUSES),
          startsAt: slot,
          length: fc.integer({ min: 1, max: 20 }),
        })
        .map(({ status, startsAt, length }): StatusOverride => ({
          status,
          startsAt,
          endsAt: startsAt + length * SLOT,
        })),
      { maxLength: 2 },
    ),
    sources: fc.array(
      fc.record({
        events: fc.array(
          fc
            .record({ start: slot, length: fc.integer({ min: 1, max: 12 }) })
            .map(({ start, length }) => ({
              id: `e${start}`,
              start,
              end: start + length * SLOT,
            })),
          { maxLength: 6 },
        ),
      }),
      { maxLength: 2 },
    ),
  });

  test.prop([fc.array(randomUser, { maxLength: 6 })], { numRuns: 100 })(
    'agrees with statusAt',
    (inputs) => {
      const users = inputs.map((input, i) => ({ ...input, userId: `u${i}` }));
      const range = { start: day.start, end: day.start + 2 * DAY_MS };
      const segments = freeIntervals(users, range);
      expect(segments[0]?.start).toBe(range.start);
      expect(segments.at(-1)?.end).toBe(range.end);
      for (const [i, segment] of segments.entries()) {
        const next = segments[i + 1];
        if (next) {
          expect(next.start).toBe(segment.end);
          expect(next.freeUserIds).not.toEqual(segment.freeUserIds);
        }
        expect([...segment.freeUserIds, ...segment.notFreeUserIds].sort()).toEqual(
          users.map((u) => u.userId).sort(),
        );
        for (const u of users) {
          const free = statusAt(u, segment.start, { horizonMs: HOUR_MS }).status === 'free';
          expect(segment.freeUserIds.includes(u.userId)).toBe(free);
        }
      }
    },
  );
});

// NFR-PERF-5 / WF-061: 20 people over 14 days in ≤ 1 s. The fixture is deliberately heavier
// than a typical student: 25 recurring classes each (mixed week patterns), a Google calendar,
// overrides, custom hours, and half the group in a DST zone with the range spanning fall-back.
describe('freeIntervals performance', () => {
  /** Small deterministic PRNG (mulberry32), so the fixture is the same on every run. */
  function prng(seed: number) {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildUsers(count: number): UserAvailability[] {
    const random = prng(2026);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
    const time = (minutes: number) =>
      `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    const period: SchedulePeriod = {
      start: '2026-08-31',
      end: '2026-12-11',
      exceptions: [
        { start: '2026-10-19', end: '2026-10-23', label: 'Reading week' },
        { start: '2026-11-02', end: '2026-11-02' },
      ],
    };
    const weekdays: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

    return Array.from({ length: count }, (_, u) => {
      const timeZone = u % 2 === 0 ? 'America/Jamaica' : 'America/New_York';
      const classes: ScheduleEvent[] = [];
      for (let c = 0; c < 25; c++) {
        const roll = random();
        const pattern: WeekPattern =
          roll < 0.7
            ? { type: 'every' }
            : roll < 0.85
              ? { type: 'alternating', parity: pick(['odd', 'even'] as const) }
              : {
                  type: 'weeks',
                  weeks: [...new Set(Array.from({ length: 8 }, () => between(1, 15)))],
                };
        const days = [...new Set(Array.from({ length: between(1, 3) }, () => pick(weekdays)))];
        const start = between(7 * 2, 19 * 2) * 30;
        const draft = {
          start: time(start),
          end: time(start + between(1, 3) * 60),
          when: { kind: 'weekly' as const, days, pattern },
        };
        const stored = eventTimesFromDraft(draft, period, timeZone);
        if (stored) classes.push({ id: `u${u}-c${c}`, ...stored });
      }
      const googleEvents: ScheduleEvent[] = Array.from({ length: 20 }, (_, g) => {
        const start = jm('2026-10-26T00:00') + between(0, 14 * 48) * 30 * MINUTE_MS;
        return {
          id: `u${u}-g${g}`,
          start,
          end: start + between(1, 4) * 30 * MINUTE_MS,
          busy: g % 5 !== 0,
        };
      });
      const overrides: StatusOverride[] = [
        { status: 'dnd', startsAt: jm('2026-10-27T19:00'), endsAt: jm('2026-10-27T21:00') },
        {
          status: pick(MANUAL_STATUSES),
          startsAt: jm('2026-11-03T12:00') + u * HOUR_MS,
          endsAt: jm('2026-11-03T14:00') + u * HOUR_MS,
        },
      ];
      const availableHours = DAYS_OF_WEEK.map((d) => ({
        day: d,
        start: time(between(7, 9) * 60),
        end: time(between(21, 23) * 60),
      }));
      return {
        userId: `user-${u}`,
        timeZone,
        availableHours,
        overrides,
        sources: [
          { id: 'upload', period, events: classes },
          { id: 'gcal', events: googleEvents },
        ],
      };
    });
  }

  it('handles 20 users over 14 days in well under 1 s', () => {
    const users = buildUsers(20);
    expect(users.every((u) => (u.sources[0]?.events.length ?? 0) >= 20)).toBe(true);
    const range = { start: jm('2026-10-26T00:00'), end: jm('2026-11-09T00:00') };

    const timings: number[] = [];
    let segments: ReturnType<typeof freeIntervals> = [];
    for (let run = 0; run < 3; run++) {
      const started = Date.now();
      segments = freeIntervals(users, range);
      timings.push(Date.now() - started);
    }
    // Every run, including the first one, must meet the budget. When this was written it took
    // about 40 ms for the first run and 25 ms after that on a developer laptop (the later runs
    // reuse remembered timezone conversions).
    expect(Math.max(...timings)).toBeLessThanOrEqual(1000);
    // Sanity: the fixture really is a busy fortnight, not a trivial one (400 segments).
    expect(segments.length).toBeGreaterThan(300);
    expect(segments.some((s) => s.freeUserIds.length >= 10)).toBe(true);
  });
});
