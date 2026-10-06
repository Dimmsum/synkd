// WF-004: ensure_current_user() creates the caller's users row on first
// sign-in, from the Clerk ID in the token only (FR-AUTH-2, FR-AUTH-3, D41).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TIMEZONE, Handle } from '@synkd/shared';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import { addUser } from './harness/seed';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.close());
beforeEach(() => db.reset());

type UserRow = {
  id: string;
  clerk_id: string;
  name: string;
  handle: string | null;
  avatar_url: string | null;
  timezone: string;
  sharing_paused: boolean;
  birth_year: number | null;
  age_confirmed_at: Date | null;
  consent_version: string | null;
  consent_at: Date | null;
};

const ensure = (clerkId: string, ...args: unknown[]) =>
  db
    .asUser(clerkId)
    .query<UserRow>(
      `select * from public.ensure_current_user(${args.map((_, i) => `$${i + 1}`).join(', ')})`,
      args,
    )
    .then((rows) => rows[0] as UserRow);

/** Runs `sql` as `authenticated` with exactly these JWT claims (e.g. no `sub`). */
async function asClaims(claims: Record<string, unknown>, sql: string): Promise<unknown> {
  return db.admin.transaction(async (tx) => {
    await tx.query(
      `select set_config('role', 'authenticated', true), set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify(claims)],
    );
    return (await tx.query(sql)).rows;
  });
}

async function userRows(): Promise<UserRow[]> {
  return (await db.admin.query<UserRow>(`select * from public.users order by clerk_id`)).rows;
}

describe('ensure_current_user()', () => {
  it('creates the row for the token’s sub with the given profile and defaults', async () => {
    const row = await ensure('user_alice', 'Alice', 'https://img.clerk.com/a.png');
    expect(row).toMatchObject({
      clerk_id: 'user_alice',
      name: 'Alice',
      avatar_url: 'https://img.clerk.com/a.png',
      timezone: DEFAULT_TIMEZONE,
      sharing_paused: false,
      birth_year: null,
      age_confirmed_at: null,
      consent_version: null,
      consent_at: null,
    });
    expect(await userRows()).toHaveLength(1);
    const [me] = await db.asUser('user_alice').query(`select public.current_user_id() as id`);
    expect(me).toEqual({ id: row.id });
  });

  it('uses the given timezone, and the default for null or empty', async () => {
    expect((await ensure('user_a', 'A', null, 'America/New_York')).timezone).toBe(
      'America/New_York',
    );
    expect((await ensure('user_b', 'B', null, null)).timezone).toBe(DEFAULT_TIMEZONE);
    expect((await ensure('user_c', 'C', null, '  ')).timezone).toBe(DEFAULT_TIMEZONE);
  });

  it('trims the name and treats an empty avatar URL as none', async () => {
    const row = await ensure('user_alice', '  Alice B \n', '');
    expect(row.name).toBe('Alice B');
    expect(row.avatar_url).toBeNull();
  });

  it('is idempotent: a second call returns the existing row unchanged', async () => {
    const first = await ensure('user_alice', 'Alice', null, 'America/Jamaica');
    const second = await ensure('user_alice', 'Someone Else', 'https://x.test/y.png', 'Asia/Tokyo');
    expect(second).toEqual(first);
    expect(await userRows()).toHaveLength(1);
  });

  it('never overwrites a profile the user has edited', async () => {
    const created = await ensure('user_alice', 'Alice');
    await db
      .asUser('user_alice')
      .query(`update public.users set name = 'Ali', timezone = 'Europe/London' where id = $1`, [
        created.id,
      ]);
    const again = await ensure('user_alice', 'Alice From Google', null, 'America/Jamaica');
    expect(again).toMatchObject({ name: 'Ali', timezone: 'Europe/London' });
  });

  it('returns an existing row even if the new arguments would be invalid', async () => {
    const created = await ensure('user_alice', 'Alice');
    expect(await ensure('user_alice', '', 'javascript:alert(1)', 'Mars/Olympus')).toEqual(created);
  });

  it('creates one row per Clerk user, keyed only on the token', async () => {
    const alice = await ensure('user_alice', 'Alice');
    const bob = await ensure('user_bob', 'Bob');
    expect(alice.id).not.toBe(bob.id);
    expect((await userRows()).map((r) => r.clerk_id)).toEqual(['user_alice', 'user_bob']);
  });

  it('does not return or touch another user’s row', async () => {
    const bobId = await addUser(db, 'user_bob');
    const alice = await ensure('user_alice', 'Name of user_bob');
    expect(alice.id).not.toBe(bobId);
    expect(alice.clerk_id).toBe('user_alice');
  });

  it('has no argument that could name a different Clerk user', async () => {
    const { rows } = await db.admin.query<{ args: string }>(
      `select pg_get_function_arguments('public.ensure_current_user(text, text, text)'::regprocedure) as args`,
    );
    expect(rows[0]?.args).toBe(
      "name text, avatar_url text DEFAULT NULL::text, timezone text DEFAULT 'America/Jamaica'::text",
    );
  });

  it.each([
    ['an empty name', ['']],
    ['a whitespace-only name', ['   ']],
    ['a null name', [null]],
    ['a name over 100 characters', ['x'.repeat(101)]],
  ])('rejects %s', async (_case, args) => {
    await expect(ensure('user_alice', ...args)).rejects.toThrow(/Name must be 1-100 characters/);
    expect(await userRows()).toEqual([]);
  });

  it('accepts a 100-character name, counting an emoji as one character', async () => {
    const name = '🍗'.repeat(100);
    expect((await ensure('user_alice', name)).name).toBe(name);
  });

  it('rejects control characters in the name', async () => {
    await expect(ensure('user_alice', 'Ali\u0007ce')).rejects.toThrow(
      /Name must not contain control characters/,
    );
    await expect(ensure('user_alice', 'Ali\nce')).rejects.toThrow(/control characters/);
  });

  it.each([
    ['javascript:alert(1)'],
    ['http://img.example/a.png'],
    ['data:image/png;base64,AAAA'],
    [`https://img.example/${'a'.repeat(2030)}`],
  ])('rejects the avatar URL %s', async (url) => {
    await expect(ensure('user_alice', 'Alice', url)).rejects.toThrow(
      /Avatar URL must be an https URL/,
    );
    expect(await userRows()).toEqual([]);
  });

  it('rejects an unknown timezone', async () => {
    await expect(ensure('user_alice', 'Alice', null, 'Mars/Olympus')).rejects.toThrow(
      /Unknown timezone: Mars\/Olympus/,
    );
    await expect(ensure('user_alice', 'Alice', null, '<+05>-05')).rejects.toThrow(
      /Unknown timezone/,
    );
  });

  it('rejects a token without a sub claim', async () => {
    await expect(
      asClaims({ role: 'authenticated' }, `select public.ensure_current_user('X')`),
    ).rejects.toThrow(/Not signed in: the token has no subject/);
    await expect(ensure('', 'X')).rejects.toThrow(/Not signed in/);
    expect(await userRows()).toEqual([]);
  });

  it('cannot be called with only the anon key', async () => {
    await expect(db.asAnon().query(`select public.ensure_current_user('Mallory')`)).rejects.toThrow(
      /permission denied for function ensure_current_user/,
    );
  });

  it('cannot be called by the service role (it has no user token)', async () => {
    await expect(
      db.asService().query(`select public.ensure_current_user('Server')`),
    ).rejects.toThrow(/permission denied for function ensure_current_user/);
  });
});

// WF-130 (D47): the new row gets a unique handle generated from the name.
describe('generated handles', () => {
  const base = async (name: string | null) =>
    (await db.admin.query<{ h: string }>(`select private.handle_base($1) as h`, [name])).rows[0]?.h;

  it.each([
    ['Kemar Johnson', 'kemarjohnson'],
    ['  José Núñez-García ', 'josenunezgarcia'],
    ['Zoë O’Brien', 'zoeobrien'],
    ['2Pac Shakur', 'pacshakur'],
    ['Synkd Fan', 'fan'],
    ['Get Synked', 'get'],
    ['synsynkdkd', 'user'],
    ['synsynkedked', 'user'],
    ['Whos Free', 'whosfree'],
    ['李小龙', 'user'],
    ['😀', 'user'],
    [null, 'user'],
    ['Christopher Alexander Montgomery', 'christopheralexander'],
  ])('bases %j on %j', async (name, expected) => {
    expect(await base(name)).toBe(expected);
  });

  it('gives a new user the handle made from their name', async () => {
    const row = await ensure('user_kemar', 'Kemar Johnson');
    expect(row.handle).toBe('kemarjohnson');
  });

  it('adds a number when the handle is taken, ignoring case', async () => {
    await addUser(db, 'user_other', { handle: 'KemarJohnson' });
    const row = await ensure('user_kemar', 'Kemar Johnson');
    expect(row.handle).toMatch(/^kemarjohnson\d{2}$/);
  });

  it('adds a number to reserved and too-short names', async () => {
    expect((await ensure('user_a', 'Admin')).handle).toMatch(/^admin\d{2}$/);
    expect((await ensure('user_b', 'Al')).handle).toMatch(/^al\d{2}$/);
    expect((await ensure('user_c', 'Me')).handle).toMatch(/^me\d{2}$/);
  });

  it('gives everyone with the same name a different, valid handle', async () => {
    const handles: string[] = [];
    for (let i = 0; i < 30; i++) {
      handles.push((await ensure(`user_${i}`, 'Kemar')).handle ?? '');
    }
    expect(new Set(handles.map((h) => h.toLowerCase())).size).toBe(30);
    for (const h of handles) expect(Handle.safeParse(h).success).toBe(true);
  });

  it('keeps the handle when the user signs in again', async () => {
    const first = await ensure('user_kemar', 'Kemar Johnson');
    await db.asUser('user_kemar').query(`select public.set_handle('kemar_j')`);
    expect((await ensure('user_kemar', 'Kemar Johnson')).handle).toBe('kemar_j');
    expect(first.handle).toBe('kemarjohnson');
  });

  it('gives an existing user without a handle one (the backfill)', async () => {
    const id = await addUser(db, 'user_old');
    await db.admin.query(`update public.users set name = 'Old Timer' where id = $1`, [id]);
    const { rows } = await db.admin.query<{ h: string }>(
      `select private.assign_generated_handle($1) as h`,
      [id],
    );
    expect(rows[0]?.h).toBe('oldtimer');
    const [me] = (
      await db.admin.query<{ handle: string }>(`select handle from public.users where id = $1`, [
        id,
      ])
    ).rows;
    expect(me?.handle).toBe('oldtimer');
  });
});
