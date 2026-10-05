// WF-040: handles and public profiles (FR-AUTH-2, FR-SOC-6, NFR-SEC-9).

import fc from 'fast-check';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Handle, RESERVED_HANDLES, RESERVED_HANDLE_SUBSTRINGS } from '@synkd/shared';
import { DB_ERROR } from '../src/errors';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import { codeInTx, codeOf } from './harness/errors';
import { addUser, befriend, block } from './harness/seed';

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
  bob = await addUser(db, 'user_bob', {
    handle: 'Bob_Marley',
    avatarUrl: 'https://img.example/bob.png',
  });
});

async function handleOf(id: string): Promise<string | null> {
  const { rows } = await db.admin.query<{ handle: string | null }>(
    `select handle from public.users where id = $1`,
    [id],
  );
  return rows[0]?.handle ?? null;
}

const setHandle = (clerkId: string, handle: string | null) =>
  db.asUser(clerkId).query<{ h: string | null }>(`select public.set_handle($1) as h`, [handle]);

const findByHandle = (clerkId: string, handle: string) =>
  db.asUser(clerkId).query(`select * from public.find_user_by_handle($1)`, [handle]);

const getProfile = (clerkId: string, id: string) =>
  db.asUser(clerkId).query(`select * from public.get_profile($1)`, [id]);

const BOB_PROFILE = {
  name: 'Name of user_bob',
  handle: 'Bob_Marley',
  avatar_url: 'https://img.example/bob.png',
};

describe('handle rules: the database matches @synkd/shared', () => {
  it('the reserved list in the CHECK constraint is exactly RESERVED_HANDLES', async () => {
    const { rows } = await db.admin.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
       where conname = 'users_handle_not_reserved'`,
    );
    const words = [...(rows[0]?.def ?? '').matchAll(/'([^']*)'::text/g)].map((m) => m[1] ?? '');
    const substrings: readonly string[] = RESERVED_HANDLE_SUBSTRINGS;
    expect(words.filter((w) => !substrings.includes(w)).sort()).toEqual(RESERVED_HANDLES);
    for (const s of substrings) {
      expect(rows[0]?.def).toContain(`strpos(lower(handle), '${s}'::text) = 0`);
    }
  });

  async function dbAccepts(handle: string): Promise<boolean> {
    const code = await codeOf(
      db.admin.query(`update public.users set handle = $1 where id = $2`, [handle, alice]),
    );
    if (code === 'ok') return true;
    expect(code).toBe('23514'); // check_violation, nothing else
    return false;
  }

  it.each([
    'kemar',
    'Kemar_J',
    'abc',
    'x'.repeat(30),
    'badminton',
    'ab',
    'x'.repeat(31),
    '1kemar',
    '_kemar',
    'kemar.j',
    'kemar-j',
    'kem ar',
    '@kemar',
    'kémar',
    'kеmar', // Cyrillic е
    'ＫＥＭＡＲ', // full-width
    'Admin',
    'SUPPORT',
    'synkd_team',
    'TheSynkdApp',
    'GetSynked',
    '',
  ])('%j: accepted by the database exactly when Handle accepts it', async (h) => {
    expect(await dbAccepts(h)).toBe(Handle.safeParse(h).success);
  });

  it('agrees with Handle on generated strings', async () => {
    const chars = fc.constantFrom(...'aZk9_-.@ éеSYNKEDsynked'.split(''));
    await fc.assert(
      fc.asyncProperty(fc.string({ unit: chars, maxLength: 34 }), async (h) => {
        expect(await dbAccepts(h)).toBe(Handle.safeParse(h).success);
      }),
      { numRuns: 200 },
    );
  });
});

describe('public.set_handle', () => {
  it('sets a handle, keeping the case typed and dropping @ and spaces', async () => {
    expect(await setHandle('user_alice', '  @Alice_W ')).toEqual([{ h: 'Alice_W' }]);
    expect(await handleOf(alice)).toBe('Alice_W');
  });

  it('changes it, but refuses to clear it (null, empty or just @) with WF101 (D47)', async () => {
    await setHandle('user_alice', 'alice');
    await setHandle('user_alice', 'ALICE'); // case-only change of your own handle
    expect(await handleOf(alice)).toBe('ALICE');
    for (const empty of [null, '', ' ', '@']) {
      expect(await codeOf(setHandle('user_alice', empty))).toBe(DB_ERROR.handleInvalid);
    }
    expect(await handleOf(alice)).toBe('ALICE');
  });

  it('only ever changes the caller’s own row', async () => {
    await setHandle('user_alice', 'alice');
    expect(await handleOf(bob)).toBe('Bob_Marley');
  });

  it('refuses a handle someone else has, ignoring case (WF103)', async () => {
    expect(await codeOf(setHandle('user_alice', 'bob_marley'))).toBe(DB_ERROR.handleTaken);
    expect(await codeOf(setHandle('user_alice', '@BOB_MARLEY'))).toBe(DB_ERROR.handleTaken);
    expect(await handleOf(alice)).toBeNull();
  });

  it.each(['ab', '1abc', 'a.b.c', 'kémar', 'x'.repeat(31)])(
    'refuses an invalid handle %j (WF101)',
    async (h) => {
      expect(await codeOf(setHandle('user_alice', h))).toBe(DB_ERROR.handleInvalid);
    },
  );

  it.each(['admin', 'Support', '@settings', 'synkd_help', 'getsynked'])(
    'refuses a reserved handle %j (WF102)',
    async (h) => {
      expect(await codeOf(setHandle('user_alice', h))).toBe(DB_ERROR.handleReserved);
    },
  );

  it('anon cannot call it; a token without a users row gets WF001', async () => {
    await expect(db.asAnon().query(`select public.set_handle('anon_x')`)).rejects.toThrow(
      /permission denied for function set_handle/,
    );
    expect(await codeOf(setHandle('user_nobody', 'nobody'))).toBe(DB_ERROR.noAccount);
  });

  it('allows 10 changes a day, then PT429; failed and no-op attempts cost nothing', async () => {
    const codes = await db.asUser('user_alice').run(async (tx) => {
      const out: string[] = [];
      out.push(await codeInTx(tx, `select public.set_handle('bob_marley')`)); // taken: free
      for (let i = 0; i < 10; i++) {
        out.push(await codeInTx(tx, `select public.set_handle($1)`, [`alice_${i}`]));
      }
      out.push(await codeInTx(tx, `select public.set_handle('alice_9')`)); // same: free
      out.push(await codeInTx(tx, `select public.set_handle('alice_x')`));
      return out;
    });
    expect(codes).toEqual([DB_ERROR.handleTaken, ...Array(11).fill('ok'), DB_ERROR.rateLimited]);
  });

  it('users still cannot write the handle column directly', async () => {
    await expect(
      db
        .asUser('user_alice')
        .query(`update public.users set handle = 'alice' where id = $1`, [alice]),
    ).rejects.toThrow(/permission denied for table users/);
  });
});

describe('public.get_profile', () => {
  it('returns only the public fields and how the person relates to the caller', async () => {
    expect(await getProfile('user_alice', bob)).toEqual([
      { id: bob, ...BOB_PROFILE, relationship: 'none' },
    ]);
    expect(await getProfile('user_alice', alice)).toEqual([
      {
        id: alice,
        name: 'Name of user_alice',
        handle: null,
        avatar_url: null,
        relationship: 'self',
      },
    ]);
  });

  it.each([
    ['alice sent a request', 'alice', 'pending', 'request_sent', 'request_received'],
    ['bob sent a request', 'bob', 'pending', 'request_received', 'request_sent'],
    ['they are friends', 'alice', 'accepted', 'friend', 'friend'],
  ] as const)('relationship when %s', async (_label, who, status, aliceSees, bobSees) => {
    await befriend(db, who === 'alice' ? alice : bob, who === 'alice' ? bob : alice, status);
    expect(await getProfile('user_alice', bob)).toMatchObject([{ relationship: aliceSees }]);
    expect(await getProfile('user_bob', alice)).toMatchObject([{ relationship: bobSees }]);
  });

  it('a block in either direction looks exactly like a user that does not exist', async () => {
    const missing = await getProfile('user_alice', '00000000-0000-4000-8000-000000000000');
    expect(missing).toEqual([]);
    await block(db, bob, alice); // bob blocked alice
    expect(await getProfile('user_alice', bob)).toEqual(missing);
    expect(await getProfile('user_bob', alice)).toEqual([]);
    await db.reset();
    alice = await addUser(db, 'user_alice');
    bob = await addUser(db, 'user_bob', { handle: 'Bob_Marley' });
    await block(db, alice, bob); // alice blocked bob
    expect(await getProfile('user_alice', bob)).toEqual([]);
    expect(await getProfile('user_bob', alice)).toEqual([]);
  });

  it('a block between two other people changes nothing', async () => {
    const carol = await addUser(db, 'user_carol');
    await block(db, bob, carol);
    expect(await getProfile('user_alice', bob)).toHaveLength(1);
  });

  it('anon cannot call it; a token without a users row gets nothing', async () => {
    await expect(db.asAnon().query(`select * from public.get_profile($1)`, [bob])).rejects.toThrow(
      /permission denied for function get_profile/,
    );
    expect(await getProfile('user_nobody', bob)).toEqual([]);
  });
});

describe('public.find_user_by_handle', () => {
  it('finds by exact handle, ignoring case, with or without @', async () => {
    for (const q of ['Bob_Marley', 'bob_marley', '@BOB_MARLEY', '  bob_marley ']) {
      expect(await findByHandle('user_alice', q)).toEqual([
        { id: bob, ...BOB_PROFILE, relationship: 'none' },
      ]);
    }
  });

  it('does not match prefixes, substrings or names', async () => {
    for (const q of ['bob', 'Bob_Marle', 'marley', 'Name of user_bob', '', '@', '%', 'bob_%']) {
      expect(await findByHandle('user_alice', q)).toEqual([]);
    }
  });

  it('a block in either direction looks exactly like a handle nobody has', async () => {
    await block(db, bob, alice);
    expect(await findByHandle('user_alice', 'bob_marley')).toEqual(
      await findByHandle('user_alice', 'no_such_handle'),
    );
    await db.admin.query(`update public.users set handle = 'alice' where id = $1`, [alice]);
    expect(await findByHandle('user_bob', 'alice')).toEqual([]); // the blocker doesn't see them either
  });

  it('anon cannot call it; a token without a users row gets nothing', async () => {
    await expect(
      db.asAnon().query(`select * from public.find_user_by_handle('bob_marley')`),
    ).rejects.toThrow(/permission denied for function find_user_by_handle/);
    expect(await findByHandle('user_nobody', 'bob_marley')).toEqual([]);
  });

  it('allows 100 lookups an hour, found or not, then PT429', async () => {
    const codes = await db.asUser('user_alice').run(async (tx) => {
      const out = new Set<string>();
      for (let i = 0; i < 100; i++) {
        out.add(
          await codeInTx(tx, `select * from public.find_user_by_handle($1)`, [
            i % 2 ? 'bob_marley' : `guess_${i}`,
          ]),
        );
      }
      return [...out, await codeInTx(tx, `select * from public.find_user_by_handle('bob_marley')`)];
    });
    expect(codes).toEqual(['ok', DB_ERROR.rateLimited]);
  });
});

describe('profiles: no other route to other users’ rows', () => {
  it('users RLS still hides other users’ rows (profiles come only from the functions)', async () => {
    expect(
      await db.asUser('user_alice').query(`select * from public.users where id = $1`, [bob]),
    ).toEqual([]);
  });
});
