// NFR-SEC-9: the rate-limit table and helpers that write functions reuse.
// The helpers are private (clients can't call them), so these tests call
// them as the superuser, the way a security definer function would.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import { addUser } from './harness/seed';

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

async function tryConsume(
  tx: Transaction,
  user: string,
  action: string,
  max: number,
  window = '1 day',
): Promise<boolean> {
  const { rows } = await tx.query<{ ok: boolean }>(
    `select private.try_consume_rate_limit($1, $2, $3, $4::interval) as ok`,
    [user, action, max, window],
  );
  return rows[0]?.ok ?? false;
}

async function counters(): Promise<{ user_id: string; action: string; count: number }[]> {
  const { rows } = await db.admin.query<{ user_id: string; action: string; count: number }>(
    `select user_id, action, count from public.rate_limits order by action, user_id`,
  );
  return rows;
}

/** Runs `fn` in one admin transaction, so now() (and so the window) is fixed throughout. */
function inOneTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.admin.transaction(fn);
}

describe('private.try_consume_rate_limit', () => {
  it('allows max_count attempts per window, then refuses without counting', async () => {
    const results = await inOneTransaction(async (tx) => {
      const out: boolean[] = [];
      for (let i = 0; i < 5; i++) out.push(await tryConsume(tx, alice, 'friend_request', 3));
      return out;
    });
    expect(results).toEqual([true, true, true, false, false]);
    expect(await counters()).toEqual([{ user_id: alice, action: 'friend_request', count: 3 }]);
  });

  it('keeps separate counters per user, per action and per scope', async () => {
    const results = await inOneTransaction(async (tx) => [
      await tryConsume(tx, alice, 'friend_request', 1),
      await tryConsume(tx, alice, 'friend_request', 1),
      await tryConsume(tx, bob, 'friend_request', 1),
      await tryConsume(tx, alice, 'handle_set', 1),
      await tryConsume(tx, alice, `friend_request_to:${bob}`, 1),
      await tryConsume(tx, alice, `friend_request_to:${alice}`, 1),
    ]);
    expect(results).toEqual([true, false, true, true, true, true]);
  });

  it('aligns windows to multiples of their length (UTC) and records when they end', async () => {
    const rows = await inOneTransaction(async (tx) => {
      await tryConsume(tx, alice, 'x', 5, '1 hour');
      await tryConsume(tx, alice, 'y', 5, '1 day');
      return (
        await tx.query(
          `select action,
                  window_start = date_trunc($1, now() at time zone 'UTC') at time zone 'UTC' as aligned,
                  window_end - window_start as length
           from public.rate_limits order by action`,
          ['hour'],
        )
      ).rows;
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ action: 'x', aligned: true });
    expect(rows[1]).toMatchObject({ action: 'y' });
    const {
      rows: [day],
    } = await db.admin.query<{ aligned: boolean }>(
      `select window_start = date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' as aligned
       from public.rate_limits where action = 'y'`,
    );
    expect(day?.aligned).toBe(true);
  });

  it('ignores counters from earlier windows', async () => {
    await db.admin.query(
      `insert into public.rate_limits (user_id, action, window_start, window_end, count)
       values ($1, 'friend_request', now() - interval '2 days', now() - interval '1 day', 99)`,
      [alice],
    );
    expect(await inOneTransaction((tx) => tryConsume(tx, alice, 'friend_request', 1))).toBe(true);
  });

  it('respects a counter written by another (committed) transaction', async () => {
    // What a concurrent caller that got in first leaves behind. The upsert
    // takes the row lock and re-reads it, so it can't double-spend.
    await inOneTransaction((tx) => tryConsume(tx, alice, 'ping', 2));
    await inOneTransaction((tx) => tryConsume(tx, alice, 'ping', 2));
    expect(await inOneTransaction((tx) => tryConsume(tx, alice, 'ping', 2))).toBe(false);
    expect(await counters()).toEqual([{ user_id: alice, action: 'ping', count: 2 }]);
  });

  it.each([
    [`null::uuid, 'x', 1, interval '1 day'`, '22004'],
    [`$1, null, 1, interval '1 day'`, '22004'],
    [`$1, 'x', 0, interval '1 day'`, '22023'],
    [`$1, 'x', 1, interval '0'`, '22023'],
    [`$1, 'x', 1, interval '-1 hour'`, '22023'],
    [`$1, 'x', 1, interval '400 days'`, '22023'],
  ])('rejects bad arguments (%s)', async (args, code) => {
    await expect(
      db.admin.query(
        `select private.try_consume_rate_limit(${args})`,
        args.includes('$1') ? [alice] : [],
      ),
    ).rejects.toMatchObject({ code });
  });

  it.each(['Friend', 'friend request', ':x', 'x:', 'x:a:b', 'a'.repeat(101)])(
    'rejects malformed action names (%j)',
    async (action) => {
      await expect(
        db.admin.query(`select private.try_consume_rate_limit($1, $2, 1, interval '1 day')`, [
          alice,
          action,
        ]),
      ).rejects.toThrow(/rate_limits_action_check/);
    },
  );
});

describe('private.consume_rate_limit', () => {
  it('raises PT429 (HTTP 429 through PostgREST) once the limit is reached', async () => {
    await db.admin.query(`select private.consume_rate_limit($1, $2, 1, interval '1 day')`, [
      alice,
      `friend_request_to:${bob}`,
    ]);
    const error = await db.admin
      .query(`select private.consume_rate_limit($1, $2, 1, interval '1 day')`, [
        alice,
        `friend_request_to:${bob}`,
      ])
      .then(
        () => null,
        (e: unknown) => e as { code: string; message: string; detail: string; hint: string },
      );
    expect(error).toMatchObject({ code: 'PT429', message: 'Too many attempts' });
    // The detail names the action without its scope (no target id leaks).
    const detail = JSON.parse(error?.detail ?? '{}') as Record<string, unknown>;
    expect(detail).toMatchObject({ action: 'friend_request_to', limit: 1 });
    expect(JSON.stringify(detail)).not.toContain(bob);
    const {
      rows: [row],
    } = await db.admin.query<{ ok: boolean }>(
      `select $1::timestamptz
                = (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC') + interval '1 day' as ok`,
      [detail.retry_at],
    );
    expect(row?.ok).toBe(true);
  });

  it('a raised limit aborts the caller’s transaction, so nothing it wrote survives', async () => {
    await db.admin.query(`select private.consume_rate_limit($1, 'x', 1, interval '1 day')`, [
      alice,
    ]);
    await expect(
      db.admin.transaction(async (tx) => {
        await tx.query(`update public.users set name = 'changed' where id = $1`, [alice]);
        await tx.query(`select private.consume_rate_limit($1, 'x', 1, interval '1 day')`, [alice]);
      }),
    ).rejects.toMatchObject({ code: 'PT429' });
    const { rows } = await db.admin.query(`select name from public.users where id = $1`, [alice]);
    expect(rows).toEqual([{ name: 'Name of user_alice' }]);
  });
});

describe('private.purge_expired_rate_limits', () => {
  it('deletes only counters whose window has ended and returns how many', async () => {
    await db.admin.query(
      `insert into public.rate_limits (user_id, action, window_start, window_end, count) values
         ($1, 'old', now() - interval '2 days', now() - interval '1 day', 5),
         ($1, 'just_ended', now() - interval '1 hour', now(), 5),
         ($2, 'current', now() - interval '1 hour', now() + interval '1 hour', 5)`,
      [alice, bob],
    );
    const { rows } = await db.admin.query(`select private.purge_expired_rate_limits() as n`);
    expect(rows).toEqual([{ n: 2 }]);
    expect(await counters()).toEqual([{ user_id: bob, action: 'current', count: 5 }]);
  });
});

describe('rate_limits access', () => {
  it.each([
    ['authenticated', () => db.asUser('user_alice')],
    ['anon', () => db.asAnon()],
  ])('%s cannot read, write or truncate rate_limits', async (_role, as) => {
    await db.admin.query(`select private.consume_rate_limit($1, 'x', 5, interval '1 day')`, [
      alice,
    ]);
    await expect(as().query(`select * from public.rate_limits`)).rejects.toThrow(
      /permission denied for table rate_limits/,
    );
    await expect(
      as().query(
        `insert into public.rate_limits (user_id, action, window_start, window_end)
         values ($1, 'x', now() - interval '1 year', now() - interval '1 day')`,
        [alice],
      ),
    ).rejects.toThrow(/permission denied for table rate_limits/);
    await expect(as().query(`update public.rate_limits set count = 0`)).rejects.toThrow(
      /permission denied for table rate_limits/,
    );
    await expect(as().query(`delete from public.rate_limits`)).rejects.toThrow(
      /permission denied for table rate_limits/,
    );
    await expect(as().query(`truncate public.rate_limits`)).rejects.toThrow(
      /permission denied for table rate_limits/,
    );
  });

  it.each([
    ['authenticated', () => db.asUser('user_alice')],
    ['anon', () => db.asAnon()],
    ['service_role', () => db.asService()],
  ])('%s cannot call the private helpers', async (_role, as) => {
    for (const sql of [
      `select private.try_consume_rate_limit($1, 'x', 5, interval '1 day')`,
      `select private.consume_rate_limit($1, 'x', 5, interval '1 day')`,
      `select private.purge_expired_rate_limits() where $1::uuid is not null`,
    ]) {
      await expect(as().query(sql, [alice])).rejects.toThrow(
        /permission denied for schema private/,
      );
    }
  });

  it('counters are deleted with the user', async () => {
    await db.admin.query(`select private.consume_rate_limit($1, 'x', 5, interval '1 day')`, [
      alice,
    ]);
    await db.admin.query(`delete from public.users where id = $1`, [alice]);
    expect(await counters()).toEqual([]);
  });
});
