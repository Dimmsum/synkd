// WF-005: the age gate stores only the birth year and a confirmation time,
// once (FR-AUTH-6, NFR-COMP-7, D13, D29).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkAge, localDateIn } from '@whosfree/shared';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import { addUser } from './harness/seed';

let db: TestDb;
let alice: string;
let bob: string;

/** The latest calendar year anywhere on Earth right now (UTC+14). */
const latestYear = () => Number(localDateIn(Date.now(), 'Pacific/Kiritimati').slice(0, 4));

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.reset();
  alice = await addUser(db, 'user_alice');
  bob = await addUser(db, 'user_bob');
});

const confirm = (clerkId: string, year: unknown) =>
  db
    .asUser(clerkId)
    .query<{ at: Date }>(`select public.confirm_age($1) as at`, [year])
    .then((rows) => rows[0]?.at);

async function ageFields(id: string) {
  const { rows } = await db.admin.query<{
    birth_year: number | null;
    age_confirmed_at: Date | null;
  }>(`select birth_year, age_confirmed_at from public.users where id = $1`, [id]);
  return rows[0];
}

describe('confirm_age()', () => {
  it('records the birth year and the confirmation time', async () => {
    const before = Date.now();
    const at = await confirm('user_alice', 2000);
    expect(at).toBeInstanceOf(Date);
    expect(at?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(await ageFields(alice)).toEqual({ birth_year: 2000, age_confirmed_at: at });
  });

  it('takes the birth year from checkAge() on the server, end to end', async () => {
    const check = checkAge('2008-09-30', '2026-09-30');
    if (!check.ok) throw new Error('expected an adult');
    await confirm('user_alice', check.birthYear);
    expect((await ageFields(alice))?.birth_year).toBe(2008);
  });

  it('only changes the caller’s own row', async () => {
    await confirm('user_alice', 1999);
    expect(await ageFields(bob)).toEqual({ birth_year: null, age_confirmed_at: null });
  });

  it('the owner can read whether the gate is passed; others can’t', async () => {
    await confirm('user_alice', 1999);
    const own = await db
      .asUser('user_alice')
      .query(`select birth_year, age_confirmed_at is not null as confirmed from public.users`);
    expect(own).toEqual([{ birth_year: 1999, confirmed: true }]);
    const other = await db
      .asUser('user_bob')
      .query(`select birth_year from public.users where id = $1`, [alice]);
    expect(other).toEqual([]);
  });

  it('a repeat call with the same year keeps the original confirmation', async () => {
    const first = await confirm('user_alice', 2000);
    const again = await confirm('user_alice', 2000);
    expect(again).toEqual(first);
    expect(await ageFields(alice)).toEqual({ birth_year: 2000, age_confirmed_at: first });
  });

  it('the birth year can’t be changed after confirmation', async () => {
    const first = await confirm('user_alice', 2000);
    await expect(confirm('user_alice', 1990)).rejects.toThrow(
      /Age is already confirmed; the birth year can't be changed/,
    );
    expect(await ageFields(alice)).toEqual({ birth_year: 2000, age_confirmed_at: first });
  });

  it('not even the service role or the superuser can change a confirmed birth year', async () => {
    await confirm('user_alice', 2000);
    await expect(
      db.asService().query(`update public.users set birth_year = 1990 where id = $1`, [alice]),
    ).rejects.toThrow(/birth_year and age_confirmed_at are write-once/);
    await expect(
      db.admin.query(`update public.users set age_confirmed_at = now() where id = $1`, [alice]),
    ).rejects.toThrow(/birth_year and age_confirmed_at are write-once/);
    await expect(
      db.admin.query(
        `update public.users set birth_year = null, age_confirmed_at = null where id = $1`,
        [alice],
      ),
    ).rejects.toThrow(/birth_year and age_confirmed_at are write-once/);
  });

  it('the user can’t write the age fields directly', async () => {
    await expect(
      db
        .asUser('user_alice')
        .query(`update public.users set birth_year = 2000, age_confirmed_at = now()`),
    ).rejects.toThrow(/permission denied for table users/);
  });

  it(`accepts the latest year that can belong to an adult, and refuses the next`, async () => {
    const maxYear = latestYear() - 18;
    await expect(confirm('user_bob', maxYear + 1)).rejects.toThrow(
      new RegExp(`Birth year must be between 1900 and ${maxYear} \\(18 or over\\)`),
    );
    await confirm('user_alice', maxYear);
    expect((await ageFields(alice))?.birth_year).toBe(maxYear);
  });

  it.each([
    ['a recent year', () => new Date().getUTCFullYear() - 10],
    ['a future year', () => 2999],
    ['a year before 1900', () => 1899],
    ['zero', () => 0],
    ['a negative year', () => -2000],
    ['null', () => null],
  ])('refuses %s', async (_case, year) => {
    await expect(confirm('user_alice', year())).rejects.toThrow(/Birth year must be between 1900/);
    expect(await ageFields(alice)).toEqual({ birth_year: null, age_confirmed_at: null });
  });

  it('accepts 1900, the earliest year the column allows', async () => {
    await confirm('user_alice', 1900);
    expect((await ageFields(alice))?.birth_year).toBe(1900);
  });

  it('refuses a caller with no users row yet', async () => {
    await expect(confirm('user_nobody', 2000)).rejects.toThrow(
      /User profile not found: call ensure_current_user first/,
    );
  });

  it('cannot be called with only the anon key or by the service role', async () => {
    await expect(db.asAnon().query(`select public.confirm_age(2000)`)).rejects.toThrow(
      /permission denied for function confirm_age/,
    );
    await expect(db.asService().query(`select public.confirm_age(2000)`)).rejects.toThrow(
      /permission denied for function confirm_age/,
    );
  });
});

describe('no full date of birth is stored (D29)', () => {
  it('users has no date column other than timestamps, and only birth_year about birth', async () => {
    const { rows } = await db.admin.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'users' order by column_name`,
    );
    expect(rows.filter((r) => /birth|dob|born|age/.test(r.column_name))).toEqual([
      { column_name: 'age_confirmed_at', data_type: 'timestamp with time zone' },
      { column_name: 'birth_year', data_type: 'smallint' },
    ]);
    expect(rows.filter((r) => r.data_type === 'date')).toEqual([]);
  });

  it('no column anywhere in public or private looks like a date of birth', async () => {
    const { rows } = await db.admin.query(
      `select table_name || '.' || column_name as c from information_schema.columns
       where table_schema in ('public', 'private')
         and (column_name ~* '(dob|date_of_birth|birth_?date|birthday)')`,
    );
    expect(rows).toEqual([]);
  });

  it('confirm_age takes only a year', async () => {
    const { rows } = await db.admin.query<{ args: string }>(
      `select pg_get_function_arguments('public.confirm_age(integer)'::regprocedure) as args`,
    );
    expect(rows[0]?.args).toBe('birth_year integer');
  });

  it('a birth year without a confirmation time (or the reverse) is impossible', async () => {
    await expect(
      db.admin.query(`update public.users set birth_year = 2000 where id = $1`, [alice]),
    ).rejects.toThrow(/users_age_confirmation_complete/);
    await expect(
      db.admin.query(`update public.users set age_confirmed_at = now() where id = $1`, [alice]),
    ).rejects.toThrow(/users_age_confirmation_complete/);
  });
});
