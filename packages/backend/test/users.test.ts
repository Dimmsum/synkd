// WF-003: the users table, current_user_id() and their RLS (PRD §9, D41).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TIMEZONE } from '@whosfree/shared';
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

describe('current_user_id()', () => {
  it('maps the Clerk user ID in the token (sub) to users.id', async () => {
    const rows = await db.asUser('user_alice').query(`select public.current_user_id() as id`);
    expect(rows).toEqual([{ id: alice }]);
  });

  it('is null for a valid token with no users row yet (before WF-004 creates it)', async () => {
    const rows = await db.asUser('user_nobody').query(`select public.current_user_id() as id`);
    expect(rows).toEqual([{ id: null }]);
  });

  it('cannot be called with only the anon key', async () => {
    await expect(db.asAnon().query(`select public.current_user_id()`)).rejects.toThrow(
      /permission denied for function current_user_id/,
    );
  });

  it('documents why auth.uid() must not be used: Clerk IDs are not uuids', async () => {
    await expect(db.asUser('user_alice').query(`select auth.uid()`)).rejects.toThrow(
      /invalid input syntax for type uuid/,
    );
  });
});

describe('users RLS', () => {
  it('a user reads only their own row', async () => {
    const rows = await db.asUser('user_alice').query(`select id, clerk_id from public.users`);
    expect(rows).toEqual([{ id: alice, clerk_id: 'user_alice' }]);
  });

  it("a user cannot read someone else's row, even by id", async () => {
    const rows = await db
      .asUser('user_alice')
      .query(`select * from public.users where id = $1`, [bob]);
    expect(rows).toEqual([]);
  });

  it('a token with no users row sees nothing', async () => {
    expect(await db.asUser('user_nobody').query(`select * from public.users`)).toEqual([]);
  });

  it('anon cannot read or write users at all', async () => {
    await expect(db.asAnon().query(`select * from public.users`)).rejects.toThrow(
      /permission denied for table users/,
    );
    await expect(
      db.asAnon().query(`insert into public.users (clerk_id, name) values ('user_x', 'X')`),
    ).rejects.toThrow(/permission denied/);
  });

  it('a user can update their own profile fields', async () => {
    await db.asUser('user_alice').query(
      `update public.users set name = 'Alice B', avatar_url = 'https://img.example/a.png',
           timezone = 'America/New_York', sharing_paused = true where id = $1`,
      [alice],
    );
    const { rows } = await db.admin.query(
      `select name, avatar_url, timezone, sharing_paused from public.users where id = $1`,
      [alice],
    );
    expect(rows).toEqual([
      {
        name: 'Alice B',
        avatar_url: 'https://img.example/a.png',
        timezone: 'America/New_York',
        sharing_paused: true,
      },
    ]);
  });

  it("a user's update of someone else's row changes nothing", async () => {
    await db
      .asUser('user_alice')
      .query(`update public.users set name = 'pwned' where id = $1`, [bob]);
    const { rows } = await db.admin.query(`select name from public.users where id = $1`, [bob]);
    expect(rows).toEqual([{ name: 'Name of user_bob' }]);
  });

  it.each([
    ['clerk_id', `'user_bob'`],
    ['id', 'gen_random_uuid()'],
    ['handle', `'alice'`],
    ['birth_year', '1990'],
    ['age_confirmed_at', 'now()'],
    ['consent_version', `'v9'`],
    ['consent_at', 'now()'],
    ['created_at', 'now()'],
  ])('a user cannot change their own %s', async (column, value) => {
    await expect(
      db
        .asUser('user_alice')
        .query(`update public.users set ${column} = ${value} where id = $1`, [alice]),
    ).rejects.toThrow(/permission denied for table users/);
  });

  it('a user cannot create or delete users rows directly', async () => {
    await expect(
      db
        .asUser('user_nobody')
        .query(`insert into public.users (clerk_id, name) values ('user_nobody', 'N')`),
    ).rejects.toThrow(/permission denied for table users/);
    await expect(
      db.asUser('user_alice').query(`delete from public.users where id = $1`, [alice]),
    ).rejects.toThrow(/permission denied for table users/);
    await expect(db.asUser('user_alice').query(`truncate public.users`)).rejects.toThrow(
      /permission denied for table users/,
    );
  });

  it('rejects unknown timezones and non-https avatar URLs', async () => {
    await expect(
      db
        .asUser('user_alice')
        .query(`update public.users set timezone = 'Mars/Olympus' where id = $1`, [alice]),
    ).rejects.toThrow(/Unknown timezone/);
    await expect(
      db
        .asUser('user_alice')
        .query(`update public.users set avatar_url = 'javascript:alert(1)' where id = $1`, [alice]),
    ).rejects.toThrow(/users_avatar_url_check/);
  });

  it('the service role (server only) bypasses RLS', async () => {
    const rows = await db.asService().query(`select clerk_id from public.users order by clerk_id`);
    expect(rows).toEqual([{ clerk_id: 'user_alice' }, { clerk_id: 'user_bob' }]);
  });
});

describe('users defaults and constraints', () => {
  it(`defaults the timezone to ${DEFAULT_TIMEZONE} and sharing to on`, async () => {
    const { rows } = await db.admin.query(
      `select timezone, sharing_paused from public.users where id = $1`,
      [alice],
    );
    expect(rows).toEqual([{ timezone: DEFAULT_TIMEZONE, sharing_paused: false }]);
  });

  it('clerk_id is unique, and handles are unique ignoring case', async () => {
    await expect(addUser(db, 'user_alice')).rejects.toThrow(/users_clerk_id_key/);
    await db.admin.query(`update public.users set handle = 'Kemar' where id = $1`, [alice]);
    await expect(
      db.admin.query(`update public.users set handle = 'kemar' where id = $1`, [bob]),
    ).rejects.toThrow(/users_handle_lower_key/);
  });

  it('stores no date of birth, only the birth year (D29)', async () => {
    const { rows } = await db.admin.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'users'`,
    );
    const columns = rows.map((r) => r.column_name);
    expect(columns).toContain('birth_year');
    expect(columns.filter((c) => /birth|dob/.test(c))).toEqual(['birth_year']);
  });
});
