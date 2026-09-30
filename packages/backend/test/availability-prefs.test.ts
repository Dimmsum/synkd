// WF-062: available hours and availability settings (PRD §9
// availabilityPrefs, FR-AVL-2, D24).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AvailableHours, DAYS_OF_WEEK, DEFAULT_AVAILABLE_HOURS } from '@whosfree/shared';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import { addUser } from './harness/seed';

const DEFAULT_WEEK = DAYS_OF_WEEK.map((day) => ({ day, ...DEFAULT_AVAILABLE_HOURS }));
const Week = AvailableHours.array();

let db: TestDb;
let alice: string;
let bob: string;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.reset();
  alice = await addUser(db, 'user_alice');
  bob = await addUser(db, 'user_bob');
});

async function weeklyOf(userId: string): Promise<unknown> {
  const { rows } = await db.admin.query<{ weekly: unknown }>(
    `select weekly from public.availability_prefs where user_id = $1`,
    [userId],
  );
  return rows[0]?.weekly;
}

const setWeekly = (clerkId: string, weekly: unknown) =>
  db
    .asUser(clerkId)
    .query(`update public.availability_prefs set weekly = $1::jsonb`, [JSON.stringify(weekly)]);

const setDay = (clerkId: string, day: unknown, start: unknown = null, end: unknown = null) =>
  db
    .asUser(clerkId)
    .query<{ weekly: unknown }>(`select public.set_day_hours($1, $2, $3) as weekly`, [
      day,
      start,
      end,
    ])
    .then((rows) => rows[0]?.weekly);

describe('default row', () => {
  it('ensure_current_user creates it with the user, in the same transaction', async () => {
    const rows = await db.asUser('user_new').run(async (tx) => {
      await tx.query(`select public.ensure_current_user('New')`);
      return (
        await tx.query(
          `select weekly, min_gap_minutes, count_all_day_events from public.availability_prefs`,
        )
      ).rows;
    });
    expect(rows).toEqual([
      { weekly: DEFAULT_WEEK, min_gap_minutes: 15, count_all_day_events: false },
    ]);
  });

  it('is 08:00-22:00 every day (D24), matching @whosfree/shared', async () => {
    const weekly = await weeklyOf(alice);
    expect(weekly).toEqual(DEFAULT_WEEK);
    expect(Week.parse(weekly)).toEqual(DEFAULT_WEEK);
  });

  it('every user has exactly one', async () => {
    const { rows } = await db.admin.query(
      `select count(*)::int as n, count(distinct user_id)::int as users from public.availability_prefs`,
    );
    expect(rows).toEqual([{ n: 2, users: 2 }]);
    await expect(
      db.admin.query(`insert into public.availability_prefs (user_id) values ($1)`, [alice]),
    ).rejects.toThrow(/availability_prefs_user_id_key/);
  });

  it('is deleted with the user', async () => {
    await db.admin.query(`delete from public.users where id = $1`, [alice]);
    expect(await weeklyOf(alice)).toBeUndefined();
    expect(await weeklyOf(bob)).toEqual(DEFAULT_WEEK);
  });
});

describe('RLS and privileges', () => {
  it('the owner reads only their own row', async () => {
    const rows = await db
      .asUser('user_alice')
      .query(`select user_id from public.availability_prefs`);
    expect(rows).toEqual([{ user_id: alice }]);
  });

  it('other users’ hours are not readable, even by id', async () => {
    const rows = await db
      .asUser('user_alice')
      .query(`select * from public.availability_prefs where user_id = $1`, [bob]);
    expect(rows).toEqual([]);
  });

  it('a user can’t change someone else’s hours', async () => {
    await db
      .asUser('user_alice')
      .query(
        `update public.availability_prefs set weekly = '[]', min_gap_minutes = 0 where user_id = $1`,
        [bob],
      );
    expect(await weeklyOf(bob)).toEqual(DEFAULT_WEEK);
  });

  it('a user can’t insert, delete, or move their row to another user', async () => {
    await expect(
      db
        .asUser('user_alice')
        .query(`insert into public.availability_prefs (user_id) values ($1)`, [alice]),
    ).rejects.toThrow(/permission denied for table availability_prefs/);
    await expect(
      db.asUser('user_alice').query(`delete from public.availability_prefs`),
    ).rejects.toThrow(/permission denied for table availability_prefs/);
    await expect(
      db.asUser('user_alice').query(`update public.availability_prefs set user_id = $1`, [bob]),
    ).rejects.toThrow(/permission denied for table availability_prefs/);
  });

  it('anon can’t read or write it, or call set_day_hours', async () => {
    await expect(db.asAnon().query(`select * from public.availability_prefs`)).rejects.toThrow(
      /permission denied for table availability_prefs/,
    );
    await expect(
      db.asAnon().query(`update public.availability_prefs set weekly = '[]'`),
    ).rejects.toThrow(/permission denied/);
    await expect(db.asAnon().query(`select public.set_day_hours('mon')`)).rejects.toThrow(
      /permission denied for function set_day_hours/,
    );
  });
});

describe('editing the week', () => {
  it('the owner can replace the whole week; it is stored mon..sun', async () => {
    await setWeekly('user_alice', [
      { end: '23:00', start: '10:00', day: 'sat' },
      { day: 'mon', start: '07:30', end: '21:00' },
    ]);
    expect(await weeklyOf(alice)).toEqual([
      { day: 'mon', start: '07:30', end: '21:00' },
      { day: 'sat', start: '10:00', end: '23:00' },
    ]);
  });

  it('an empty week (always away) is allowed', async () => {
    await setWeekly('user_alice', []);
    expect(await weeklyOf(alice)).toEqual([]);
  });

  it('min_gap_minutes and count_all_day_events are editable within bounds', async () => {
    await db
      .asUser('user_alice')
      .query(
        `update public.availability_prefs set min_gap_minutes = 30, count_all_day_events = true`,
      );
    const { rows } = await db.admin.query(
      `select min_gap_minutes, count_all_day_events from public.availability_prefs where user_id = $1`,
      [alice],
    );
    expect(rows).toEqual([{ min_gap_minutes: 30, count_all_day_events: true }]);
    for (const bad of [-1, 241]) {
      await expect(
        db
          .asUser('user_alice')
          .query(`update public.availability_prefs set min_gap_minutes = $1`, [bad]),
      ).rejects.toThrow(/availability_prefs_min_gap_minutes_check/);
    }
  });

  it.each([
    ['not an array', { day: 'mon', start: '08:00', end: '22:00' }, /must be an array/],
    ['null', null, /must be an array|null value/],
    ['a string entry', ['mon 08:00-22:00'], /exactly \{day, start, end\}/],
    ['a missing key', [{ day: 'mon', start: '08:00' }], /exactly \{day, start, end\}/],
    [
      'an extra key',
      [{ day: 'mon', start: '08:00', end: '22:00', location: 'UWI' }],
      /exactly \{day, start, end\}/,
    ],
    ['a numeric time', [{ day: 'mon', start: 800, end: '22:00' }], /with string values/],
    ['an unknown day', [{ day: 'monday', start: '08:00', end: '22:00' }], /Unknown day: monday/],
    ['an upper-case day', [{ day: 'MON', start: '08:00', end: '22:00' }], /Unknown day: MON/],
    [
      'a duplicate day',
      [
        { day: 'mon', start: '08:00', end: '12:00' },
        { day: 'mon', start: '13:00', end: '22:00' },
      ],
      /Duplicate day: mon/,
    ],
    ['24:00', [{ day: 'mon', start: '08:00', end: '24:00' }], /Invalid end time on mon: 24:00/],
    ['9:00', [{ day: 'tue', start: '9:00', end: '22:00' }], /Invalid start time on tue: 9:00/],
    ['12:60', [{ day: 'mon', start: '08:00', end: '12:60' }], /Invalid end time/],
    ['seconds', [{ day: 'mon', start: '08:00:00', end: '22:00' }], /Invalid start time/],
    [
      'end before start',
      [{ day: 'wed', start: '22:00', end: '08:00' }],
      /End must be after start on wed/,
    ],
    [
      'end equal to start',
      [{ day: 'mon', start: '08:00', end: '08:00' }],
      /End must be after start/,
    ],
  ])('rejects %s', async (_case, weekly, error) => {
    await expect(setWeekly('user_alice', weekly)).rejects.toThrow(error);
    expect(await weeklyOf(alice)).toEqual(DEFAULT_WEEK);
  });

  it('whatever it accepts parses as AvailableHours[] from @whosfree/shared', async () => {
    await setWeekly('user_alice', [
      { day: 'sun', start: '00:00', end: '23:59' },
      { day: 'thu', start: '12:00', end: '12:01' },
    ]);
    expect(Week.safeParse(await weeklyOf(alice)).success).toBe(true);
  });
});

describe('set_day_hours()', () => {
  it('changes one day and leaves the rest of the week alone', async () => {
    const weekly = await setDay('user_alice', 'wed', '10:00', '18:30');
    const expected = DEFAULT_WEEK.map((h) =>
      h.day === 'wed' ? { day: 'wed', start: '10:00', end: '18:30' } : h,
    );
    expect(weekly).toEqual(expected);
    expect(await weeklyOf(alice)).toEqual(expected);
    expect(await weeklyOf(bob)).toEqual(DEFAULT_WEEK);
  });

  it('with no times, marks the day unavailable; setting it again adds it back in order', async () => {
    await setDay('user_alice', 'sun');
    expect(await weeklyOf(alice)).toEqual(DEFAULT_WEEK.filter((h) => h.day !== 'sun'));
    await setDay('user_alice', 'mon');
    await setDay('user_alice', 'mon', '09:00', '17:00');
    const weekly = Week.parse(await weeklyOf(alice));
    expect(weekly.map((h) => h.day)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
    expect(weekly[0]).toEqual({ day: 'mon', start: '09:00', end: '17:00' });
  });

  it('validates the times through the same rules', async () => {
    await expect(setDay('user_alice', 'fri', '18:00', '09:00')).rejects.toThrow(
      /End must be after start on fri/,
    );
    await expect(setDay('user_alice', 'fri', '9am', '5pm')).rejects.toThrow(
      /Invalid start time on fri/,
    );
    expect(await weeklyOf(alice)).toEqual(DEFAULT_WEEK);
  });

  it('rejects an unknown day and a lone start or end time', async () => {
    await expect(setDay('user_alice', 'funday', '08:00', '09:00')).rejects.toThrow(
      /Unknown day: funday/,
    );
    await expect(setDay('user_alice', null)).rejects.toThrow(/Unknown day: NULL/);
    await expect(setDay('user_alice', 'mon', '08:00', null)).rejects.toThrow(
      /Give both start and end times, or neither/,
    );
  });

  it('refuses a caller with no users row yet', async () => {
    await expect(setDay('user_nobody', 'mon', '08:00', '09:00')).rejects.toThrow(
      /User profile not found: call ensure_current_user first/,
    );
  });
});
