// WF-030: commit_schedule saves a confirmed schedule as one source with its
// period plus RRULE/EXDATE events (FR-IMP-7, FR-IMP-8, FR-IMP-12, §9
// modelling decision, D35, D42, D44). Covers the draft checks, the encoding
// (identical to eventTimesFromDraft in @synkd/availability), an engine
// round trip of what the user reads back under RLS, replacing a schedule,
// the offline-friend target, the rate limit and who can call it.

import fc from 'fast-check';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { busyIntervals, eventTimesFromDraft } from '@synkd/availability';
import type { AvailabilityInput, ScheduleSource } from '@synkd/availability';
import {
  DAYS_OF_WEEK,
  EVENT_TITLE_MAX_LENGTH,
  SCHEDULE_COMMITS_PER_DAY,
  SCHEDULE_MAX_EVENTS,
  SCHEDULE_MAX_EXCEPTIONS,
  ScheduleCommit,
  SchedulePeriod,
} from '@synkd/shared';
import type { DayOfWeek, EventDraft, WeekPattern } from '@synkd/shared';
import { DB_ERROR, OFFLINE_FRIEND_ERRORS } from '../src/index';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import { codeOf, errorOf } from './harness/errors';
import { expectNoExecute, setRateCount } from './harness/groups';
import { addEvent, addSource, addUser, befriend } from './harness/seed';

const DAY_MS = 86_400_000;
const JM = 'America/Jamaica';
const NY = 'America/New_York';

/** An instant at a Jamaican wall-clock time (UTC-5 all year). */
const jm = (date: string, time: string) => Date.parse(`${date}T${time}:00-05:00`);

let db: TestDb;
let alice: string;
let bob: string;
let tashId: string;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.close());

beforeEach(async () => {
  await db.reset();
  alice = await addUser(db, 'user_alice');
  bob = await addUser(db, 'user_bob');
  const [row] = await db
    .asUser('user_alice')
    .query<{ id: string }>(`select public.create_offline_friend('Tash', null, true) as id`);
  tashId = row?.id as string;
});

type Draft = Record<string, unknown>;

const lecture = {
  title: 'COMP2140 Lecture',
  category: 'class',
  start: '10:00',
  end: '12:00',
  when: { kind: 'weekly', days: ['mon', 'wed'], pattern: { type: 'every' } },
  confidence: 1,
};
const semester = { start: '2026-08-31', end: '2026-12-12', exceptions: [] as unknown[] };
const simple = (): Draft => ({ events: [lecture], period: semester });

function commit(
  clerkId: string,
  draft: unknown,
  sourceType: string | null = 'manual',
  offlineFriendId: string | null = null,
): Promise<string> {
  return db
    .asUser(clerkId)
    .query<{ id: string }>(`select public.commit_schedule($1::jsonb, $2, $3) as id`, [
      JSON.stringify(draft),
      sourceType,
      offlineFriendId,
    ])
    .then((rows) => rows[0]?.id as string);
}

interface SourceRow {
  id: string;
  type: string;
  offline_friend_id: string | null;
  period_start: string | null;
  period_end: string | null;
  period_exceptions: { start: string; end: string; label?: string }[];
}

interface EventRow {
  id: string;
  source_id: string;
  offline_friend_id: string | null;
  title: string | null;
  category: string | null;
  starts_at: Date;
  ends_at: Date;
  rrule: string | null;
  exdates: Date[];
  busy: boolean;
  is_private: boolean;
}

async function sourcesOf(userId: string): Promise<SourceRow[]> {
  const { rows } = await db.admin.query<SourceRow>(
    `select id, type, offline_friend_id, period_start::text, period_end::text, period_exceptions
     from public.sources where user_id = $1 order by created_at, id`,
    [userId],
  );
  return rows;
}

async function eventsOf(sourceId: string): Promise<EventRow[]> {
  const { rows } = await db.admin.query<EventRow>(
    `select id, source_id, offline_friend_id, title, category, starts_at, ends_at, rrule, exdates,
            busy, is_private
     from public.events where source_id = $1 order by starts_at, id`,
    [sourceId],
  );
  return rows;
}

async function count(table: 'sources' | 'events'): Promise<number> {
  const { rows } = await db.admin.query<{ n: number }>(
    `select count(*)::integer as n from public.${table}`,
  );
  return rows[0]?.n ?? -1;
}

async function setTimezone(userId: string, timeZone: string): Promise<void> {
  await db.admin.query(`update public.users set timezone = $2 where id = $1`, [userId, timeZone]);
}

/**
 * What a server reading the caller's own schedule passes to the engine: their sources (not an
 * offline friend's, D44) with period and events, read under RLS.
 */
async function ownEngineInput(clerkId: string): Promise<AvailabilityInput> {
  return db.asUser(clerkId).run(async (tx) => {
    const [user] = (await tx.query<{ timezone: string }>(`select timezone from public.users`)).rows;
    const sources = (
      await tx.query<SourceRow>(
        `select id, period_start::text, period_end::text, period_exceptions
         from public.sources where offline_friend_id is null`,
      )
    ).rows;
    const events = (
      await tx.query<EventRow>(
        `select id, source_id, starts_at, ends_at, rrule, exdates, busy
         from public.events where offline_friend_id is null`,
      )
    ).rows;
    return {
      timeZone: user?.timezone,
      sources: sources.map((s): ScheduleSource => ({
        id: s.id,
        period:
          s.period_start && s.period_end
            ? SchedulePeriod.parse({
                start: s.period_start,
                end: s.period_end,
                exceptions: s.period_exceptions,
              })
            : null,
        events: events
          .filter((e) => e.source_id === s.id)
          .map((e) => ({
            id: e.id,
            start: e.starts_at.getTime(),
            end: e.ends_at.getTime(),
            rrule: e.rrule,
            exdates: e.exdates.map((d) => new Date(d).getTime()),
            busy: e.busy,
          })),
      })),
    };
  });
}

/** Busy intervals as local Jamaican `YYYY-MM-DD HH:MM–HH:MM` strings, for readable expectations. */
function jmIntervals(intervals: { start: number; end: number }[]): string[] {
  const local = (t: number) => new Date(t - 5 * 3_600_000).toISOString().slice(0, 16);
  return intervals.map((i) => `${local(i.start).replace('T', ' ')}–${local(i.end).slice(11)}`);
}

describe('commit_schedule: what it writes (FR-IMP-7, FR-IMP-8, §9)', () => {
  it('creates one source with the period and one RRULE event per draft event', async () => {
    const draft = {
      events: [lecture],
      period: {
        ...semester,
        exceptions: [
          { start: '2026-10-19', end: '2026-10-19', label: '  National Heroes Day ' },
          { start: '2026-10-12', end: '2026-10-16', label: '   ' },
        ],
      },
    };
    const sourceId = await commit('user_alice', draft);
    expect(await sourcesOf(alice)).toEqual([
      {
        id: sourceId,
        type: 'manual',
        offline_friend_id: null,
        period_start: '2026-08-31',
        period_end: '2026-12-12',
        // Labels trimmed; an empty one dropped.
        period_exceptions: [
          { start: '2026-10-19', end: '2026-10-19', label: 'National Heroes Day' },
          { start: '2026-10-12', end: '2026-10-16' },
        ],
      },
    ]);
    const [event, ...rest] = await eventsOf(sourceId);
    expect(rest).toEqual([]);
    expect(event).toMatchObject({
      offline_friend_id: null,
      title: 'COMP2140 Lecture',
      category: 'class',
      busy: true,
      is_private: false,
      // The first occurrence: Monday 31 August, 10:00–12:00 in Jamaica.
      starts_at: new Date(jm('2026-08-31', '10:00')),
      ends_at: new Date(jm('2026-08-31', '12:00')),
      // Ends at the last occurrence (Wednesday 9 December), inside period_end.
      rrule: 'FREQ=WEEKLY;WKST=MO;BYDAY=MO,WE;UNTIL=20261209T150000Z',
      exdates: [],
    });
  });

  it('accepts an upload source too (the parse pipeline, WF-027)', async () => {
    await commit('user_alice', simple(), 'upload');
    expect((await sourcesOf(alice)).map((s) => s.type)).toEqual(['upload']);
  });

  it('encodes alternating weeks, chosen weeks, overnight and dated events', async () => {
    const sourceId = await commit('user_alice', {
      period: semester,
      events: [
        {
          ...lecture,
          title: 'Lab',
          start: '09:00',
          end: '12:00',
          when: {
            kind: 'weekly',
            days: ['tue'],
            pattern: { type: 'alternating', parity: 'odd' },
          },
        },
        {
          ...lecture,
          title: 'Tutorial',
          start: '13:00',
          end: '14:00',
          when: { kind: 'weekly', days: ['thu'], pattern: { type: 'weeks', weeks: [5, 2, 3] } },
        },
        {
          ...lecture,
          title: 'Shift',
          category: 'work',
          start: '22:00',
          end: '02:00',
          when: { kind: 'weekly', days: ['fri'], pattern: { type: 'every' } },
        },
        {
          ...lecture,
          title: 'Exam',
          start: '09:00',
          end: '17:00',
          when: { kind: 'date', date: '2026-11-07' },
        },
      ],
    });
    const byTitle = new Map((await eventsOf(sourceId)).map((e) => [e.title, e]));
    expect(byTitle.get('Lab')).toMatchObject({
      starts_at: new Date(jm('2026-09-01', '09:00')),
      ends_at: new Date(jm('2026-09-01', '12:00')),
      // Odd weeks: week 15 (Tuesday 8 December) is the last.
      rrule: 'FREQ=WEEKLY;INTERVAL=2;WKST=MO;BYDAY=TU;UNTIL=20261208T140000Z',
      exdates: [],
    });
    expect(byTitle.get('Tutorial')).toMatchObject({
      // Week 2 is 7–13 September; week 4 (24 September) is skipped; week 5 is the last.
      starts_at: new Date(jm('2026-09-10', '13:00')),
      rrule: 'FREQ=WEEKLY;WKST=MO;BYDAY=TH;UNTIL=20261001T180000Z',
      exdates: [new Date(jm('2026-09-24', '13:00'))],
    });
    expect(byTitle.get('Shift')).toMatchObject({
      starts_at: new Date(jm('2026-09-04', '22:00')),
      ends_at: new Date(jm('2026-09-05', '02:00')),
      rrule: 'FREQ=WEEKLY;WKST=MO;BYDAY=FR;UNTIL=20261212T030000Z',
    });
    expect(byTitle.get('Exam')).toMatchObject({
      starts_at: new Date(jm('2026-11-07', '09:00')),
      ends_at: new Date(jm('2026-11-07', '17:00')),
      rrule: null,
      exdates: [],
    });
  });

  it('round-trips through the engine: busy exactly when the draft says (WF-060)', async () => {
    await commit('user_alice', {
      period: {
        ...semester,
        exceptions: [
          { start: '2026-10-12', end: '2026-10-16', label: 'Reading week' },
          { start: '2026-10-19', end: '2026-10-19', label: 'National Heroes Day' },
        ],
      },
      events: [
        lecture,
        {
          ...lecture,
          title: 'Lab',
          start: '09:00',
          end: '12:00',
          when: { kind: 'weekly', days: ['tue'], pattern: { type: 'alternating', parity: 'odd' } },
        },
        {
          ...lecture,
          title: 'Tutorial',
          start: '13:00',
          end: '14:00',
          when: { kind: 'weekly', days: ['thu'], pattern: { type: 'weeks', weeks: [2, 3, 5] } },
        },
        {
          ...lecture,
          title: 'Shift',
          start: '22:00',
          end: '02:00',
          when: { kind: 'weekly', days: ['fri'], pattern: { type: 'every' } },
        },
        { ...lecture, title: 'Exam', when: { kind: 'date', date: '2026-11-07' } },
      ],
    });
    const input = await ownEngineInput('user_alice');
    const week = (monday: string) =>
      jmIntervals(
        busyIntervals(input, {
          start: jm(monday, '00:00'),
          end: jm(monday, '00:00') + 7 * DAY_MS,
        }),
      );

    // Week 1.
    expect(week('2026-08-31')).toEqual([
      '2026-08-31 10:00–12:00',
      '2026-09-01 09:00–12:00',
      '2026-09-02 10:00–12:00',
      '2026-09-04 22:00–02:00',
    ]);
    // Week 2: the tutorial starts; no lab in an even week.
    expect(week('2026-09-07')).toEqual([
      '2026-09-07 10:00–12:00',
      '2026-09-09 10:00–12:00',
      '2026-09-10 13:00–14:00',
      '2026-09-11 22:00–02:00',
    ]);
    // Week 4: no tutorial (EXDATE), no lab.
    expect(week('2026-09-21')).toEqual([
      '2026-09-21 10:00–12:00',
      '2026-09-23 10:00–12:00',
      '2026-09-25 22:00–02:00',
    ]);
    // Reading week (an exception): nothing at all, though week 7 is an odd week.
    expect(week('2026-10-12')).toEqual([]);
    // Heroes Day Monday off; Saturday's exam is a one-off.
    expect(week('2026-10-19')).toEqual(['2026-10-21 10:00–12:00', '2026-10-23 22:00–02:00']);
    expect(week('2026-11-02')).toEqual([
      '2026-11-02 10:00–12:00',
      '2026-11-04 10:00–12:00',
      '2026-11-06 22:00–02:00',
      '2026-11-07 10:00–12:00',
    ]);
    // The last week ends on Saturday 12 December, but Friday's shift may run into it.
    expect(week('2026-12-07')).toEqual([
      '2026-12-07 10:00–12:00',
      '2026-12-08 09:00–12:00',
      '2026-12-09 10:00–12:00',
      '2026-12-11 22:00–02:00',
    ]);
    // Nothing after the period, even with the period left out (UNTIL bounds every rule).
    expect(week('2026-12-14')).toEqual([]);
    const withoutPeriod = {
      ...input,
      sources: input.sources.map((s) => ({ ...s, period: null })),
    };
    expect(
      busyIntervals(withoutPeriod, {
        start: jm('2026-12-12', '03:00'),
        end: jm('2027-06-01', '00:00'),
      }),
    ).toEqual([]);
  });

  it('uses the owner’s timezone and resolves DST like the engine (D42)', async () => {
    await setTimezone(alice, NY);
    // 1 November 2026 is fall-back day in New York: 01:30 happens twice; the first (EDT) wins.
    const period = { start: '2026-11-01', end: '2026-11-30', exceptions: [] };
    const sourceId = await commit('user_alice', {
      period,
      events: [
        {
          ...lecture,
          start: '01:30',
          end: '03:00',
          when: { kind: 'weekly', days: ['sun'], pattern: { type: 'every' } },
        },
      ],
    });
    const [event] = await eventsOf(sourceId);
    expect(event?.starts_at).toEqual(new Date('2026-11-01T05:30:00Z'));
    const expected = eventTimesFromDraft(
      {
        start: '01:30',
        end: '03:00',
        when: { kind: 'weekly', days: ['sun'], pattern: { type: 'every' } },
      },
      period,
      NY,
    );
    expect(event?.starts_at.getTime()).toBe(expected?.start);
    expect(event?.ends_at.getTime()).toBe(expected?.end);
    expect(event?.rrule).toBe(expected?.rrule);
  });

  // Property: for random drafts, periods and timezones (with and without DST), the stored
  // times, RRULE and EXDATEs are exactly what eventTimesFromDraft computes, and an event the
  // engine finds no occurrence for is refused with WF402.
  it('stores exactly what eventTimesFromDraft computes, for any draft (property)', async () => {
    const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
    const dateOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
    const time = fc
      .integer({ min: 0, max: 24 * 4 - 1 })
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
        .uniqueArray(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 6 })
        .map((weeks) => ({ type: 'weeks' as const, weeks })),
    );
    const event = fc
      .record({
        days: fc.uniqueArray(fc.constantFrom(...DAYS_OF_WEEK), { minLength: 1, maxLength: 7 }),
        pattern,
        start: time,
        end: time,
      })
      .filter((e) => e.start !== e.end);
    const scenario = fc.record({
      timeZone: fc.constantFrom(JM, NY, 'Europe/London', 'Australia/Sydney'),
      startDay: fc.integer({ min: dayNumber('2026-01-01'), max: dayNumber('2027-12-31') }),
      length: fc.integer({ min: 0, max: 130 }),
      events: fc.array(event, { minLength: 1, maxLength: 4 }),
    });

    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        await db.admin.query(`delete from public.sources`);
        await setRateCount(db, alice, 'commit_schedule', 0);
        await setTimezone(alice, s.timeZone);
        const period = {
          start: dateOf(s.startDay),
          end: dateOf(s.startDay + s.length),
          exceptions: [],
        };
        const drafts: EventDraft[] = s.events.map((e) => ({
          title: 'Class',
          category: 'class',
          start: e.start,
          end: e.end,
          when: { kind: 'weekly', days: e.days as DayOfWeek[], pattern: e.pattern },
          confidence: 1,
        }));
        const expected = drafts.map((d) => eventTimesFromDraft(d, period, s.timeZone));
        const missing = expected.findIndex((e) => e === null);
        const result = commit('user_alice', { period, events: drafts });
        if (missing >= 0) {
          const error = await errorOf(result);
          expect(error.code).toBe(DB_ERROR.scheduleEventOutsidePeriod);
          return;
        }
        const sourceId = await result;
        const { rows } = await db.admin.query<EventRow & { n: number }>(
          `select starts_at, ends_at, rrule, exdates from public.events
           where source_id = $1 order by created_at, id`,
          [sourceId],
        );
        const stored = rows.map((r) => ({
          start: r.starts_at.getTime(),
          end: r.ends_at.getTime(),
          rrule: r.rrule,
          exdates: r.exdates.map((d) => new Date(d).getTime()),
        }));
        // Rows are inserted in draft order in one statement, but compare as sets to be safe.
        const key = (e: { start: number; rrule: string | null }) => `${e.start}|${e.rrule}`;
        expect([...stored].sort((a, b) => key(a).localeCompare(key(b)))).toEqual(
          [...(expected as NonNullable<(typeof expected)[number]>[])].sort((a, b) =>
            key(a).localeCompare(key(b)),
          ),
        );
      }),
      { numRuns: 40 },
    );
  });
});

describe('commit_schedule: checks the draft (ScheduleCommit, D35)', () => {
  const withEvent = (patch: Record<string, unknown>): Draft => ({
    events: [{ ...lecture, ...patch }],
    period: semester,
  });
  const withWhen = (when: unknown) => withEvent({ when });
  const withPeriod = (patch: Record<string, unknown>): Draft => ({
    events: [lecture],
    period: { ...semester, ...patch },
  });
  const { title: _title, ...untitled } = lecture;
  const { confidence: _confidence, ...unsure } = lecture;
  const day = { start: '2026-09-07', end: '2026-09-07' };

  const invalid: [string, unknown][] = [
    ['not an object', null],
    ['a location on the draft', { ...simple(), location: 'UWI Mona' }],
    ['a location on an event', withEvent({ location: 'SLT 3' })],
    ['a room on an event', withEvent({ room: 'C2' })],
    ['a location in when', withWhen({ ...lecture.when, location: 'Lab 1' })],
    ['a location in the period', withPeriod({ location: 'Campus' })],
    ['a location on an exception', withPeriod({ exceptions: [{ ...day, location: 'Home' }] })],
    ['no events', { events: [], period: semester }],
    ['events not an array', { events: lecture, period: semester }],
    ['too many events', { events: Array(SCHEDULE_MAX_EVENTS + 1).fill(lecture), period: semester }],
    ['no period', { events: [lecture] }],
    ['a period ending before it starts', withPeriod({ start: '2026-12-12', end: '2026-08-31' })],
    ['a period over 366 days', withPeriod({ start: '2026-01-01', end: '2027-01-02' })],
    ['an impossible date', withPeriod({ end: '2026-02-30' })],
    ['a date in another format', withPeriod({ end: '12/12/2026' })],
    [
      'a backwards exception',
      withPeriod({ exceptions: [{ start: '2026-09-08', end: '2026-09-07' }] }),
    ],
    [
      'too many exceptions',
      withPeriod({ exceptions: Array(SCHEDULE_MAX_EXCEPTIONS + 1).fill(day) }),
    ],
    ['a long exception label', withPeriod({ exceptions: [{ ...day, label: 'x'.repeat(61) }] })],
    ['exceptions not an array', withPeriod({ exceptions: day })],
    ['no title', { events: [untitled], period: semester }],
    ['a blank title', withEvent({ title: '   ' })],
    ['a title too long', withEvent({ title: 'x'.repeat(EVENT_TITLE_MAX_LENGTH + 1) })],
    ['a title that is not a string', withEvent({ title: 42 })],
    ['an unknown category', withEvent({ category: 'party' })],
    ['a 24:00 time', withEvent({ end: '24:00' })],
    ['a time with seconds', withEvent({ start: '10:00:00' })],
    ['no duration', withEvent({ end: '10:00' })],
    ['no confidence', { events: [unsure], period: semester }],
    ['a confidence over 1', withEvent({ confidence: 1.5 })],
    ['an unknown kind', withWhen({ kind: 'monthly', days: ['mon'], pattern: { type: 'every' } })],
    ['no days', withWhen({ kind: 'weekly', days: [], pattern: { type: 'every' } })],
    ['an unknown day', withWhen({ kind: 'weekly', days: ['monday'], pattern: { type: 'every' } })],
    [
      'a repeated day',
      withWhen({ kind: 'weekly', days: ['mon', 'mon'], pattern: { type: 'every' } }),
    ],
    ['an unknown pattern', withWhen({ ...lecture.when, pattern: { type: 'monthly' } })],
    ['a bad parity', withWhen({ ...lecture.when, pattern: { type: 'alternating', parity: 'A' } })],
    ['week 0', withWhen({ ...lecture.when, pattern: { type: 'weeks', weeks: [0] } })],
    ['week 61', withWhen({ ...lecture.when, pattern: { type: 'weeks', weeks: [61] } })],
    ['a fractional week', withWhen({ ...lecture.when, pattern: { type: 'weeks', weeks: [1.5] } })],
    ['a repeated week', withWhen({ ...lecture.when, pattern: { type: 'weeks', weeks: [2, 2] } })],
    ['no weeks', withWhen({ ...lecture.when, pattern: { type: 'weeks', weeks: [] } })],
    ['a dated event with days', withWhen({ kind: 'date', date: '2026-09-07', days: ['mon'] })],
    ['a bad event date', withWhen({ kind: 'date', date: '2026-13-01' })],
  ];

  it.each(invalid)('refuses %s with WF401, writing nothing', async (_name, draft) => {
    await setRateCount(db, alice, 'commit_schedule', SCHEDULE_COMMITS_PER_DAY - 1);
    expect(await codeOf(commit('user_alice', draft))).toBe(DB_ERROR.scheduleInvalid);
    expect(await count('sources')).toBe(0);
    // Nothing was used up: the one commit left today still works.
    await commit('user_alice', simple());
  });

  it('the shared zod schema refuses the same drafts, or drops the unknown field', () => {
    // zod strips unknown keys instead of failing, so those drafts pass with the field gone.
    const unknownKey = /location|room|with days/;
    for (const [name, draft] of invalid) {
      const parsed = ScheduleCommit.safeParse(draft);
      const dated = parsed.success
        ? parsed.data.events.map((e) => e.when).filter((w) => w.kind === 'date')
        : [];
      const kept =
        parsed.success &&
        (/location|room|Mona|SLT|Campus|Home/i.test(JSON.stringify(parsed.data)) ||
          dated.some((w) => 'days' in w));
      expect({ name, accepted: parsed.success, kept }).toEqual({
        name,
        accepted: unknownKey.test(name),
        kept: false,
      });
    }
  });

  it('error messages name the field, never what was typed (NFR-SEC-11)', async () => {
    const error = await errorOf(commit('user_alice', withEvent({ title: 'x'.repeat(200) })));
    expect(error.message).toBe('Invalid schedule: events[0].title must be 1 to 120 characters');
    const located = await errorOf(commit('user_alice', withEvent({ location: 'Secret place' })));
    expect(located.message).not.toMatch(/Secret|location/);
  });

  it('refuses an event that never happens in the period with WF402 and its index', async () => {
    const outside = { ...lecture, when: { kind: 'date', date: '2027-01-05' } };
    const weekAfter = {
      ...lecture,
      when: { kind: 'weekly', days: ['mon'], pattern: { type: 'weeks', weeks: [30] } },
    };
    for (const bad of [outside, weekAfter]) {
      const error = await db
        .asUser('user_alice')
        .query(`select public.commit_schedule($1::jsonb)`, [
          JSON.stringify({ period: semester, events: [lecture, bad] }),
        ])
        .then(
          () => null,
          (e: unknown) => e as { code: string; detail?: string },
        );
      expect(error?.code).toBe(DB_ERROR.scheduleEventOutsidePeriod);
      expect(JSON.parse(error?.detail ?? 'null')).toEqual({ event: 1 });
    }
    expect(await count('sources')).toBe(0);
  });

  it('refuses a source type other than manual or upload', async () => {
    for (const type of ['gcal', 'other', null]) {
      expect(await codeOf(commit('user_alice', simple(), type))).toBe('22023');
    }
    expect(await count('sources')).toBe(0);
  });
});

describe('commit_schedule: replacing a schedule (FR-IMP-17, minimal until WF-033)', () => {
  it('replaces the previous upload or manual schedule and its events, nothing else', async () => {
    const gcal = await addSource(db, alice, { type: 'gcal' });
    const gcalEvent = await addEvent(db, alice, gcal, {
      startsAt: '2026-09-01T14:00:00Z',
      endsAt: '2026-09-01T15:00:00Z',
    });
    const tash = await commit('user_alice', simple(), 'manual', tashId);
    const bobs = await commit('user_bob', simple());
    const first = await commit('user_alice', simple(), 'upload');
    const second = await commit('user_alice', {
      events: [{ ...lecture, title: 'New lecture' }],
      period: { start: '2027-01-11', end: '2027-04-30' },
    });

    const sources = await sourcesOf(alice);
    expect(sources.map((s) => s.id).sort()).toEqual([gcal, tash, second].sort());
    expect(sources.some((s) => s.id === first)).toBe(false);
    expect((await eventsOf(first)).length).toBe(0);
    expect((await eventsOf(second)).map((e) => e.title)).toEqual(['New lecture']);
    // Google Calendar, the offline friend's schedule and Bob's are untouched.
    expect((await eventsOf(gcal)).map((e) => e.id)).toEqual([gcalEvent]);
    expect((await eventsOf(tash)).length).toBe(1);
    expect((await sourcesOf(bob)).map((s) => s.id)).toEqual([bobs]);
  });

  it('an offline friend’s new schedule replaces only theirs', async () => {
    const own = await commit('user_alice', simple());
    await commit('user_alice', simple(), 'manual', tashId);
    const tashNew = await commit('user_alice', simple(), 'upload', tashId);
    const sources = await sourcesOf(alice);
    expect(sources.map((s) => [s.id, s.offline_friend_id])).toEqual([
      [own, null],
      [tashNew, tashId],
    ]);
  });

  it('a refused commit replaces nothing', async () => {
    const own = await commit('user_alice', simple());
    expect(await codeOf(commit('user_alice', { ...simple(), events: [] }))).toBe(
      DB_ERROR.scheduleInvalid,
    );
    expect((await sourcesOf(alice)).map((s) => s.id)).toEqual([own]);
    expect((await eventsOf(own)).length).toBe(1);
  });
});

describe('commit_schedule: offline friends (WF-127, D44)', () => {
  it('saves an offline friend’s schedule under them, never as the owner’s own', async () => {
    const sourceId = await commit('user_alice', simple(), 'manual', tashId);
    expect((await sourcesOf(alice)).map((s) => s.offline_friend_id)).toEqual([tashId]);
    expect((await eventsOf(sourceId)).map((e) => e.offline_friend_id)).toEqual([tashId]);
    // The owner's own schedule (what their status comes from) is still empty.
    expect((await ownEngineInput('user_alice')).sources).toEqual([]);
    const [listed] = await db
      .asUser('user_alice')
      .query<{ has_schedule: boolean }>(`select has_schedule from public.list_offline_friends()`);
    expect(listed?.has_schedule).toBe(true);
  });

  it('refuses someone else’s offline friend, or one that doesn’t exist, as not found', async () => {
    for (const id of [tashId, '00000000-0000-4000-8000-000000000000']) {
      const error = await errorOf(commit('user_bob', simple(), 'manual', id));
      expect(error).toEqual({ code: 'P0002', message: OFFLINE_FRIEND_ERRORS.notFound });
    }
    expect(await count('sources')).toBe(0);
  });

  it('times are in the owner’s timezone', async () => {
    await setTimezone(alice, NY);
    const sourceId = await commit('user_alice', simple(), 'manual', tashId);
    // 10:00 EDT on Monday 31 August.
    expect((await eventsOf(sourceId))[0]?.starts_at).toEqual(new Date('2026-08-31T14:00:00Z'));
  });
});

describe('commit_schedule: who can call it, RLS and the rate limit', () => {
  it('needs an account: WF001 without a users row', async () => {
    expect(await codeOf(commit('user_nobody', simple()))).toBe(DB_ERROR.noAccount);
  });

  it('anon cannot execute it', async () => {
    await expectNoExecute(
      db.asAnon().query(`select public.commit_schedule($1::jsonb)`, [JSON.stringify(simple())]),
      'commit_schedule',
    );
  });

  it('the owner reads the result under RLS; others see it only through redaction', async () => {
    await befriend(db, alice, bob);
    const sourceId = await commit('user_alice', simple());
    const own = await db.asUser('user_alice').query(`select id from public.events`);
    expect(own).toHaveLength(1);
    expect(await db.asUser('user_bob').query(`select id from public.events`)).toEqual([]);
    expect(await db.asUser('user_bob').query(`select id from public.sources`)).toEqual([]);
    // A friend at T1 sees busy times (via the redaction path) but no title or category.
    const seen = await db
      .asUser('user_bob')
      .query<{ title: string | null; category: string | null; rrule: string }>(
        `select title, category, rrule from public.events_for_viewer($1, $2, $3)`,
        [alice, '2026-09-07T00:00:00Z', '2026-09-08T00:00:00Z'],
      );
    expect(seen).toEqual([
      { title: null, category: null, rrule: (await eventsOf(sourceId))[0]?.rrule },
    ]);
  });

  it(`allows ${SCHEDULE_COMMITS_PER_DAY} commits a day (NFR-SEC-9), own and offline friends’ together`, async () => {
    await setRateCount(db, alice, 'commit_schedule', SCHEDULE_COMMITS_PER_DAY - 2);
    await commit('user_alice', simple());
    await commit('user_alice', simple(), 'manual', tashId);
    const error = await errorOf(commit('user_alice', simple()));
    expect(error.code).toBe(DB_ERROR.rateLimited);
    // Bob has his own allowance.
    await commit('user_bob', simple());
  });
});
