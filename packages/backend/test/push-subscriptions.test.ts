// WF-091: Web Push subscriptions, the database half. Saving and deleting through the
// functions, validation, the per-user cap and rate limit, moving a browser between accounts,
// and isolation: nobody but the owner can read or change a subscription through the Data API
// (FR-PWA-4, FR-PING-3, NFR-SEC-2, NFR-SEC-9, D41).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_PUSH_SUBSCRIPTIONS, PUSH_DEVICE_LABEL_MAX_LENGTH } from '@synkd/shared';
import { PUSH_SUBSCRIPTION_ERRORS } from '../src/index';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import { codeOf } from './harness/errors';
import { expectNoExecute, expectPgError, setRateCount } from './harness/groups';
import { addUser, befriend } from './harness/seed';

// Shaped like a browser's PushSubscription.toJSON(): a 65-byte key and a 16-byte secret, base64url.
const P256DH = `B${'a'.repeat(86)}`;
const AUTH = 'abcdefghijklmnopqrstuv';
const endpointOf = (n: number | string) => `https://push.example.test/send/device-${n}`;

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
  // Friends: being connected must not give access to each other's devices.
  await befriend(db, alice, bob);
});

async function save(
  clerkId: string,
  endpoint: string | null,
  opts: { p256dh?: string | null; auth?: string | null; label?: string | null } = {},
): Promise<string> {
  const [row] = await db
    .asUser(clerkId)
    .query<{ id: string }>(`select public.save_push_subscription($1, $2, $3, $4) as id`, [
      endpoint,
      opts.p256dh === undefined ? P256DH : opts.p256dh,
      opts.auth === undefined ? AUTH : opts.auth,
      opts.label ?? null,
    ]);
  if (row === undefined) throw new Error('save_push_subscription returned no row');
  return row.id;
}

async function remove(clerkId: string, endpoint: string): Promise<boolean> {
  const [row] = await db
    .asUser(clerkId)
    .query<{ ok: boolean }>(`select public.delete_push_subscription($1) as ok`, [endpoint]);
  return row?.ok ?? false;
}

async function rowsOf(userId: string) {
  const { rows } = await db.admin.query<{
    endpoint: string;
    p256dh: string;
    auth: string;
    device_label: string | null;
  }>(
    `select endpoint, p256dh, auth, device_label from public.push_subscriptions
     where user_id = $1 order by endpoint`,
    [userId],
  );
  return rows;
}

async function total(): Promise<number> {
  const { rows } = await db.admin.query<{ n: number }>(
    `select count(*)::integer as n from public.push_subscriptions`,
  );
  return rows[0]?.n ?? -1;
}

describe('save_push_subscription (FR-PWA-4)', () => {
  it('stores the device for the caller, trimming the label', async () => {
    const id = await save('user_alice', endpointOf(1), { label: '  Chrome on Android ' });
    const { rows } = await db.admin.query(
      `select user_id, endpoint, p256dh, auth, device_label, last_used_at
       from public.push_subscriptions where id = $1`,
      [id],
    );
    expect(rows).toEqual([
      {
        user_id: alice,
        endpoint: endpointOf(1),
        p256dh: P256DH,
        auth: AUTH,
        device_label: 'Chrome on Android',
        last_used_at: null,
      },
    ]);
  });

  it('a blank label means none; padded base64url keys are accepted', async () => {
    await save('user_alice', endpointOf(1), {
      label: '   ',
      p256dh: `${P256DH}=`,
      auth: `${AUTH}==`,
    });
    expect(await rowsOf(alice)).toEqual([
      { endpoint: endpointOf(1), p256dh: `${P256DH}=`, auth: `${AUTH}==`, device_label: null },
    ]);
  });

  it('is idempotent per endpoint: re-saving updates the keys in place and costs no allowance', async () => {
    const first = await save('user_alice', endpointOf(1));
    await db.admin.query(
      `update public.push_subscriptions set updated_at = updated_at - interval '1 day'`,
    );
    await setRateCount(db, alice, 'push_subscribe', 20);
    const second = await save('user_alice', endpointOf(1), {
      p256dh: `C${'b'.repeat(86)}`,
      label: 'Safari on iPhone',
    });
    expect(second).toBe(first);
    expect(await rowsOf(alice)).toEqual([
      {
        endpoint: endpointOf(1),
        p256dh: `C${'b'.repeat(86)}`,
        auth: AUTH,
        device_label: 'Safari on iPhone',
      },
    ]);
    const { rows } = await db.admin.query(
      `select updated_at > created_at as bumped from public.push_subscriptions where id = $1`,
      [first],
    );
    expect(rows).toEqual([{ bumped: true }]);
  });

  it('validates the endpoint, the keys and the label', async () => {
    for (const bad of [
      null,
      '',
      'http://push.example.test/insecure',
      'https://push.example.test/with space',
      'javascript:alert(1)',
      `https://push.example.test/${'x'.repeat(2048)}`,
    ])
      await expectPgError(
        save('user_alice', bad),
        PUSH_SUBSCRIPTION_ERRORS.invalidEndpoint,
        '22023',
      );
    for (const keys of [
      { p256dh: null },
      { auth: null },
      { p256dh: 'short' },
      { p256dh: `${P256DH.slice(1)}+` },
      { auth: 'abc' },
      { auth: `${AUTH.slice(1)}/` },
    ])
      await expectPgError(
        save('user_alice', endpointOf(1), keys),
        PUSH_SUBSCRIPTION_ERRORS.invalidKeys,
        '22023',
      );
    for (const label of ['x'.repeat(PUSH_DEVICE_LABEL_MAX_LENGTH + 1), 'Chrome\non Android'])
      await expectPgError(
        save('user_alice', endpointOf(1), { label }),
        PUSH_SUBSCRIPTION_ERRORS.invalidDeviceLabel,
        '22023',
      );
    await save('user_alice', endpointOf(1), { label: 'x'.repeat(PUSH_DEVICE_LABEL_MAX_LENGTH) });
    expect(await rowsOf(alice)).toHaveLength(1);
  });

  it('the table itself refuses bad values', async () => {
    const insert = (endpoint: string, p256dh: string, auth: string, label: string | null) =>
      codeOf(
        db.admin.query(
          `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device_label)
           values ($1, $2, $3, $4, $5)`,
          [alice, endpoint, p256dh, auth, label],
        ),
      );
    expect(await insert('http://x.test/abcdef', P256DH, AUTH, null)).toBe('23514');
    expect(await insert(endpointOf(1), 'short', AUTH, null)).toBe('23514');
    expect(await insert(endpointOf(1), P256DH, 'a', null)).toBe('23514');
    expect(await insert(endpointOf(1), P256DH, AUTH, ' padded')).toBe('23514');
    expect(await insert(endpointOf(1), P256DH, AUTH, null)).toBe('ok');
    expect(await insert(endpointOf(1), P256DH, AUTH, null)).toBe('23505');
  });

  it('moves a browser to the account that turned notifications on last', async () => {
    await save('user_alice', endpointOf('shared'));
    await save('user_alice', endpointOf('alice-only'));
    await save('user_bob', endpointOf('shared'), { label: 'Bob now' });
    expect((await rowsOf(alice)).map((r) => r.endpoint)).toEqual([endpointOf('alice-only')]);
    expect(await rowsOf(bob)).toEqual([
      { endpoint: endpointOf('shared'), p256dh: P256DH, auth: AUTH, device_label: 'Bob now' },
    ]);
  });

  it(`keeps at most MAX_PUSH_SUBSCRIPTIONS (${MAX_PUSH_SUBSCRIPTIONS}) per user, dropping the least recently used`, async () => {
    for (let i = 1; i <= MAX_PUSH_SUBSCRIPTIONS; i++) await save('user_alice', endpointOf(i));
    // Device 1 is the oldest by save time but delivered to recently; device 2 is the stalest.
    await db.admin.query(
      `update public.push_subscriptions
       set updated_at = now() - (interval '1 day' * (20 - substring(endpoint from 'device-(\\d+)$')::integer))`,
    );
    await db.admin.query(
      `update public.push_subscriptions set last_used_at = now() where endpoint = $1`,
      [endpointOf(1)],
    );
    await save('user_alice', endpointOf('new'));

    const endpoints = (await rowsOf(alice)).map((r) => r.endpoint);
    expect(endpoints).toHaveLength(MAX_PUSH_SUBSCRIPTIONS);
    expect(endpoints).toContain(endpointOf('new'));
    expect(endpoints).toContain(endpointOf(1));
    expect(endpoints).not.toContain(endpointOf(2));
    // Per user: Bob's devices are untouched and don't count towards Alice's cap.
    await save('user_bob', endpointOf('bob'));
    expect(await rowsOf(bob)).toHaveLength(1);
    expect(await rowsOf(alice)).toHaveLength(MAX_PUSH_SUBSCRIPTIONS);
  });

  it('checks the cap while holding the caller’s users row lock', async () => {
    const locked = await db.asUser('user_alice').run(async (tx) => {
      await tx.query(`select public.save_push_subscription($1, $2, $3)`, [
        endpointOf(1),
        P256DH,
        AUTH,
      ]);
      await tx.query(`reset role`);
      const { rows } = await tx.query<{ locked: boolean }>(
        `select pg_current_xact_id()::text in (u.xmax::text, u.xmin::text) as locked
         from public.users u where u.id = $1`,
        [alice],
      );
      return rows[0]?.locked ?? false;
    });
    expect(locked).toBe(true);
  });

  it('is rate limited to 20 new devices a day (NFR-SEC-9); a refused call uses nothing', async () => {
    await setRateCount(db, alice, 'push_subscribe', 19);
    await expectPgError(
      save('user_alice', 'http://bad.test/x'),
      PUSH_SUBSCRIPTION_ERRORS.invalidEndpoint,
    );
    await save('user_alice', endpointOf(1));
    await expectPgError(
      save('user_alice', endpointOf(2)),
      PUSH_SUBSCRIPTION_ERRORS.rateLimited,
      'PT429',
    );
    expect((await rowsOf(alice)).map((r) => r.endpoint)).toEqual([endpointOf(1)]);
  });

  it('needs an account', async () => {
    await expectPgError(
      save('user_no_row', endpointOf(1)),
      PUSH_SUBSCRIPTION_ERRORS.noAccount,
      'WF001',
    );
    expect(await total()).toBe(0);
  });
});

describe('delete_push_subscription', () => {
  it('removes the caller’s device and is idempotent', async () => {
    await save('user_alice', endpointOf(1));
    await save('user_alice', endpointOf(2));
    expect(await remove('user_alice', endpointOf(1))).toBe(true);
    expect(await remove('user_alice', endpointOf(1))).toBe(false);
    expect((await rowsOf(alice)).map((r) => r.endpoint)).toEqual([endpointOf(2)]);
  });

  it('another user’s endpoint is not found and stays', async () => {
    await save('user_alice', endpointOf(1));
    expect(await remove('user_bob', endpointOf(1))).toBe(false);
    expect(await rowsOf(alice)).toHaveLength(1);
  });

  it('needs an account', async () => {
    await expectPgError(
      remove('user_no_row', endpointOf(1)),
      PUSH_SUBSCRIPTION_ERRORS.noAccount,
      'WF001',
    );
  });
});

describe('request_test_push', () => {
  it('returns the caller’s own users.id, at most 10 an hour (NFR-SEC-9)', async () => {
    const call = () =>
      db.asUser('user_alice').query<{ id: string }>(`select public.request_test_push() as id`);
    expect(await call()).toEqual([{ id: alice }]);
    const { rows } = await db.admin.query<{ count: number }>(
      `select count from public.rate_limits where user_id = $1 and action = 'push_test'`,
      [alice],
    );
    expect(rows).toEqual([{ count: 1 }]);
    await db.admin.query(
      `update public.rate_limits set count = 10 where user_id = $1 and action = 'push_test'`,
      [alice],
    );
    await expectPgError(call(), PUSH_SUBSCRIPTION_ERRORS.rateLimited, 'PT429');
  });

  it('needs an account, and anon can’t call it', async () => {
    await expectPgError(
      db.asUser('user_no_row').query(`select public.request_test_push()`),
      PUSH_SUBSCRIPTION_ERRORS.noAccount,
      'WF001',
    );
    await expectNoExecute(
      db.asAnon().query(`select public.request_test_push()`),
      'request_test_push',
    );
  });
});

describe('isolation (NFR-SEC-2, D41)', () => {
  beforeEach(async () => {
    await save('user_alice', endpointOf('alice'), { label: 'Alice phone' });
    await save('user_bob', endpointOf('bob'));
  });

  it('each user reads only their own rows, even a friend’s are invisible', async () => {
    const own = await db
      .asUser('user_alice')
      .query(`select endpoint, device_label from public.push_subscriptions`);
    expect(own).toEqual([{ endpoint: endpointOf('alice'), device_label: 'Alice phone' }]);
    const theirs = await db
      .asUser('user_bob')
      .query(`select endpoint from public.push_subscriptions where user_id = $1`, [alice]);
    expect(theirs).toEqual([]);
    expect(await db.asUser('user_no_row').query(`select * from public.push_subscriptions`)).toEqual(
      [],
    );
  });

  it('clients can’t write the table directly, not even their own rows', async () => {
    const s = db.asUser('user_alice');
    const denied = /permission denied for table push_subscriptions/;
    await expect(
      s.query(
        `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
         values (public.current_user_id(), $1, $2, $3)`,
        [endpointOf('direct'), P256DH, AUTH],
      ),
    ).rejects.toThrow(denied);
    await expect(
      s.query(`update public.push_subscriptions set user_id = $1`, [alice]),
    ).rejects.toThrow(denied);
    await expect(s.query(`delete from public.push_subscriptions`)).rejects.toThrow(denied);
    expect(await total()).toBe(2);
  });

  it('signed-out (anon) requests can’t touch the table or the functions', async () => {
    const anon = db.asAnon();
    await expect(anon.query(`select * from public.push_subscriptions`)).rejects.toThrow(
      /permission denied for table/,
    );
    await expectNoExecute(
      anon.query(`select public.save_push_subscription($1, $2, $3)`, [
        endpointOf('anon'),
        P256DH,
        AUTH,
      ]),
      'save_push_subscription',
    );
    await expectNoExecute(
      anon.query(`select public.delete_push_subscription($1)`, [endpointOf('alice')]),
      'delete_push_subscription',
    );
    expect(await total()).toBe(2);
  });

  it('the server-side delivery path (service role) can read a recipient’s rows and drop dead ones', async () => {
    const service = db.asService();
    const rows = await service.query(
      `select endpoint, p256dh, auth from public.push_subscriptions where user_id = $1`,
      [alice],
    );
    expect(rows).toEqual([{ endpoint: endpointOf('alice'), p256dh: P256DH, auth: AUTH }]);
    await service.query(
      `update public.push_subscriptions set last_used_at = now() where user_id = $1`,
      [alice],
    );
    await service.query(`delete from public.push_subscriptions where endpoint = $1`, [
      endpointOf('alice'),
    ]);
    expect(await rowsOf(alice)).toEqual([]);
  });

  it('deleting the account deletes its devices', async () => {
    await db.admin.query(`delete from public.users where id = $1`, [alice]);
    expect(await rowsOf(alice)).toEqual([]);
    expect(await rowsOf(bob)).toHaveLength(1);
  });
});
