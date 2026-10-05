// The stored shapes of available hours (WF-062) and manual overrides (WF-063)
// are exactly what @synkd/availability's engine takes: rows read back
// under RLS feed statusAt() directly (FR-AVL-2, FR-AVL-3, D5).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { statusAt } from '@synkd/availability';
import type { AvailabilityInput, StatusOverride } from '@synkd/availability';
import { AvailableHours, DAYS_OF_WEEK, localDateIn, ManualStatus } from '@synkd/shared';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import { addSource } from './harness/seed';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.reset();
  const [row] = await db
    .asUser('user_alice')
    .query<{ id: string }>(`select id from public.ensure_current_user('Alice')`);
  // A schedule source with no events, so the user isn't `no_schedule` (D22).
  await addSource(db, row?.id as string);
});

/** What a server reading the user's own data would pass to the engine. */
async function engineInput(clerkId: string): Promise<AvailabilityInput> {
  return db.asUser(clerkId).run(async (tx) => {
    const [user] = (
      await tx.query<{ timezone: string; sharing_paused: boolean }>(
        `select timezone, sharing_paused from public.users`,
      )
    ).rows;
    const [prefs] = (
      await tx.query<{ weekly: unknown }>(`select weekly from public.availability_prefs`)
    ).rows;
    const overrides = (
      await tx.query<{ id: string; status: string; starts_at: Date; ends_at: Date | null }>(
        `select id, status, starts_at, ends_at from public.status_overrides`,
      )
    ).rows.map((o): StatusOverride => ({
      id: o.id,
      status: ManualStatus.parse(o.status),
      startsAt: o.starts_at.getTime(),
      endsAt: o.ends_at?.getTime() ?? null,
    }));
    // Only the user's own sources: those of their offline friends (D44) are
    // not their schedule and must never make them look busy or "have a schedule".
    const sources = (
      await tx.query<{ id: string }>(
        `select id from public.sources where offline_friend_id is null`,
      )
    ).rows.map((s) => ({ id: s.id, events: [] }));
    return {
      timeZone: user?.timezone,
      sharingPaused: user?.sharing_paused,
      availableHours: AvailableHours.array().parse(prefs?.weekly),
      overrides,
      sources,
    };
  });
}

/** Tomorrow in Jamaica (UTC-5, no DST): its date, weekday, and an instant at a local time. */
function tomorrowInJamaica() {
  const date = localDateIn(Date.now() + DAY_MS);
  const weekday = DAYS_OF_WEEK[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7] as string;
  const at = (hhmm: string) => Date.parse(`${date}T${hhmm}:00-05:00`);
  return { weekday, at };
}

describe('available hours in the engine', () => {
  it('the default week: away at 03:00, free at 12:00, away again at 22:00', async () => {
    const input = await engineInput('user_alice');
    const { at } = tomorrowInJamaica();
    expect(statusAt(input, at('03:00'))).toMatchObject({
      status: 'away',
      cause: { type: 'outside_hours' },
      until: at('08:00'),
    });
    expect(statusAt(input, at('12:00'))).toMatchObject({
      status: 'free',
      until: at('22:00'),
      nextStatus: 'away',
    });
    expect(statusAt(input, at('22:00')).status).toBe('away');
  });

  it('a per-day edit changes only that day', async () => {
    const { weekday, at } = tomorrowInJamaica();
    await db
      .asUser('user_alice')
      .query(`select public.set_day_hours($1, '10:00', '14:00')`, [weekday]);
    const input = await engineInput('user_alice');
    expect(statusAt(input, at('09:00')).status).toBe('away');
    expect(statusAt(input, at('12:00'))).toMatchObject({ status: 'free', until: at('14:00') });
    expect(statusAt(input, at('15:00')).status).toBe('away');
    // The day after is still the default 08:00-22:00.
    expect(statusAt(input, at('15:00') + DAY_MS).status).toBe('free');
  });

  it('a day marked unavailable is away all day', async () => {
    const { weekday, at } = tomorrowInJamaica();
    await db.asUser('user_alice').query(`select public.set_day_hours($1)`, [weekday]);
    const input = await engineInput('user_alice');
    expect(statusAt(input, at('12:00'))).toMatchObject({
      status: 'away',
      cause: { type: 'outside_hours' },
    });
  });
});

describe('manual overrides in the engine', () => {
  it('a set status overrides the calendar and hours now', async () => {
    const [row] = await db
      .asUser('user_alice')
      .query<{ id: string }>(`select id from public.set_status('focused', 'Revising')`);
    const input = await engineInput('user_alice');
    expect(statusAt(input, Date.now())).toEqual({
      status: 'busy',
      cause: { type: 'override', manualStatus: 'focused', overrideId: row?.id },
      until: null,
      nextStatus: null,
    });
  });

  it('an old "until I change it" status does not come back after a newer timed one ends', async () => {
    const [old] = await db
      .asUser('user_alice')
      .query<{ id: string }>(`select id from public.set_status('dnd')`);
    await db.admin.query(
      `update public.status_overrides set starts_at = starts_at - interval '1 hour' where id = $1`,
      [old?.id],
    );
    const [timed] = await db
      .asUser('user_alice')
      .query<{ id: string; ends_at: Date }>(
        `select id, ends_at from public.set_status('away', null, now() + interval '1 hour')`,
      );
    const endsAt = timed?.ends_at.getTime() as number;

    const input = await engineInput('user_alice');
    expect(statusAt(input, Date.now())).toMatchObject({
      status: 'away',
      cause: { type: 'override', manualStatus: 'away', overrideId: timed?.id },
      until: expect.any(Number),
    });
    const after = statusAt(input, endsAt + 60_000);
    expect(after.cause.type).not.toBe('override');

    // Why set_status closes the old one: left open, the engine would bring it back.
    const unclosed: AvailabilityInput = {
      ...input,
      overrides: input.overrides?.map((o) => (o.id === old?.id ? { ...o, endsAt: null } : o)),
    };
    expect(statusAt(unclosed, endsAt + 60_000)).toMatchObject({
      status: 'dnd',
      cause: { type: 'override', manualStatus: 'dnd', overrideId: old?.id },
    });
  });

  it('after clear_status the calendar-based status applies again', async () => {
    const [row] = await db
      .asUser('user_alice')
      .query<{ id: string }>(`select id from public.set_status('dnd')`);
    await db.admin.query(
      `update public.status_overrides set starts_at = starts_at - interval '1 hour' where id = $1`,
      [row?.id],
    );
    await db.asUser('user_alice').query(`select public.clear_status()`);
    const input = await engineInput('user_alice');
    expect(statusAt(input, Date.now() + 1000).cause.type).not.toBe('override');
  });
});

describe('offline friends in the engine (D44)', () => {
  it('an offline friend’s schedule doesn’t give the owner a schedule', async () => {
    await db.admin.query(`delete from public.sources`);
    await db
      .asUser('user_alice')
      .query(`select public.create_offline_friend('Tash', null, true) as id`)
      .then(([row]) =>
        db.admin.query(
          `insert into public.sources (user_id, type, offline_friend_id)
           select user_id, 'upload', id from public.offline_friends where id = $1`,
          [row?.id],
        ),
      );
    const input = await engineInput('user_alice');
    expect(input.sources).toEqual([]);
    expect(statusAt(input, Date.now()).status).toBe('no_schedule');
  });
});
