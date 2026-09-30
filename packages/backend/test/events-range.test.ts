// Which of the owner's events events_for_viewer returns for a time range.
// Tier handling is covered in visibility.test.ts; here the viewer is the
// owner's T3 friend and only the range rule is under test.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import { addEvent, addSource, addUser, befriend, setRule } from './harness/seed';
import type { EventInput } from './harness/seed';

// Monday 5 October 2026, UTC.
const RANGE_START = '2026-10-05T00:00:00Z';
const RANGE_END = '2026-10-06T00:00:00Z';

let db: TestDb;
let owner: string;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.reset();
  owner = await addUser(db, 'user_owner');
  const viewer = await addUser(db, 'user_viewer');
  await befriend(db, owner, viewer);
  await setRule(db, owner, 'friend', viewer, 3);
});

async function titlesInRange(start = RANGE_START, end = RANGE_END): Promise<string[]> {
  const rows = await db
    .asUser('user_viewer')
    .query<{ title: string }>(`select title from public.events_for_viewer($1, $2, $3)`, [
      owner,
      start,
      end,
    ]);
  return rows.map((r) => r.title);
}

async function seed(
  events: (Omit<EventInput, 'title'> & { title: string })[],
  period?: { periodStart: string; periodEnd: string },
): Promise<void> {
  const source = await addSource(db, owner, period);
  for (const e of events) await addEvent(db, owner, source, { category: 'class', ...e });
}

describe('one-off events', () => {
  it('returns events overlapping the half-open range [start, end)', async () => {
    await seed([
      { title: 'before', startsAt: '2026-10-04T10:00:00Z', endsAt: '2026-10-04T11:00:00Z' },
      { title: 'ends at start', startsAt: '2026-10-04T23:00:00Z', endsAt: RANGE_START },
      { title: 'spans start', startsAt: '2026-10-04T23:00:00Z', endsAt: '2026-10-05T01:00:00Z' },
      { title: 'inside', startsAt: '2026-10-05T10:00:00Z', endsAt: '2026-10-05T11:00:00Z' },
      { title: 'spans end', startsAt: '2026-10-05T23:00:00Z', endsAt: '2026-10-06T01:00:00Z' },
      { title: 'starts at end', startsAt: RANGE_END, endsAt: '2026-10-06T01:00:00Z' },
      { title: 'spans all', startsAt: '2026-10-04T00:00:00Z', endsAt: '2026-10-07T00:00:00Z' },
      { title: 'after', startsAt: '2026-10-07T10:00:00Z', endsAt: '2026-10-07T11:00:00Z' },
    ]);
    expect(await titlesInRange()).toEqual(['spans all', 'spans start', 'inside', 'spans end']);
  });

  it('never returns non-busy events', async () => {
    await seed([
      {
        title: 'free',
        busy: false,
        startsAt: '2026-10-05T10:00:00Z',
        endsAt: '2026-10-05T11:00:00Z',
      },
    ]);
    expect(await titlesInRange()).toEqual([]);
  });
});

describe('recurring events (one row with an RRULE)', () => {
  const weekly = 'FREQ=WEEKLY;BYDAY=MO';

  it('returns a series that started before the range and has no period end', async () => {
    await seed([
      {
        title: 'weekly lecture',
        rrule: weekly,
        startsAt: '2026-09-07T14:00:00Z',
        endsAt: '2026-09-07T16:00:00Z',
      },
    ]);
    expect(await titlesInRange()).toEqual(['weekly lecture']);
  });

  it('returns the RRULE and EXDATEs so the caller can expand the series', async () => {
    await seed([
      {
        title: 'weekly lecture',
        rrule: weekly,
        exdates: ['2026-10-05T14:00:00Z'],
        startsAt: '2026-09-07T14:00:00Z',
        endsAt: '2026-09-07T16:00:00Z',
      },
    ]);
    const rows = await db
      .asUser('user_viewer')
      .query(`select rrule, exdates from public.events_for_viewer($1, $2, $3)`, [
        owner,
        RANGE_START,
        RANGE_END,
      ]);
    expect(rows).toEqual([{ rrule: weekly, exdates: [new Date('2026-10-05T14:00:00Z')] }]);
  });

  it('skips a series that starts after the range', async () => {
    await seed([
      {
        title: 'next term',
        rrule: weekly,
        startsAt: '2026-10-12T14:00:00Z',
        endsAt: '2026-10-12T16:00:00Z',
      },
    ]);
    expect(await titlesInRange()).toEqual([]);
  });

  it('skips a series whose schedule period ended well before the range', async () => {
    await seed(
      [
        {
          title: 'last term',
          rrule: weekly,
          startsAt: '2026-01-12T14:00:00Z',
          endsAt: '2026-01-12T16:00:00Z',
        },
      ],
      { periodStart: '2026-01-12', periodEnd: '2026-04-30' },
    );
    expect(await titlesInRange()).toEqual([]);
  });

  it('includes a series in the period, and one whose period ends on the first day of the range', async () => {
    await seed(
      [
        {
          title: 'this term',
          rrule: weekly,
          startsAt: '2026-09-07T14:00:00Z',
          endsAt: '2026-09-07T16:00:00Z',
        },
      ],
      { periodStart: '2026-09-07', periodEnd: '2026-10-05' },
    );
    expect(await titlesInRange()).toEqual(['this term']);
  });

  it('keeps a series whose period ended the day before, if the last local occurrence could still overlap (UTC+14 to UTC-12)', async () => {
    // period_end 2026-10-04 local. In UTC-12, 23:00 local on the 4th is 11:00Z on the 5th.
    await seed(
      [
        {
          title: 'late local occurrence',
          rrule: 'FREQ=DAILY',
          startsAt: '2026-09-07T11:00:00Z',
          endsAt: '2026-09-07T12:00:00Z',
        },
      ],
      { periodStart: '2026-09-07', periodEnd: '2026-10-04' },
    );
    expect(await titlesInRange()).toEqual(['late local occurrence']);
    // Two days after the period there is no possible occurrence left.
    expect(await titlesInRange('2026-10-06T12:00:00Z', '2026-10-07T00:00:00Z')).toEqual([]);
  });

  it('keeps an overnight series whose last occurrence runs into the range', async () => {
    await seed(
      [
        {
          title: 'night shift',
          rrule: 'FREQ=DAILY',
          startsAt: '2026-09-01T22:00:00Z',
          endsAt: '2026-09-02T10:00:00Z',
        },
      ],
      { periodStart: '2026-09-01', periodEnd: '2026-10-04' },
    );
    expect(await titlesInRange('2026-10-06T05:00:00Z', '2026-10-06T06:00:00Z')).toEqual([
      'night shift',
    ]);
  });
});
