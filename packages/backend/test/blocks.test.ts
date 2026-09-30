// WF-047 (friends half): unfriend, block, unblock (FR-SOC-6). Visibility is
// checked through events_for_viewer, the path real viewers use.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DB_ERROR } from '../src/errors';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import { codeOf } from './harness/errors';
import { addGroup, addUser, befriend, block, setRule } from './harness/seed';
import { RANGE, addPerson, graphState, tierSeen } from './harness/social';

let db: TestDb;
let alice: string;
let bob: string;
let carol: string;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.reset();
  alice = await addPerson(db, 'user_alice', 'alice');
  bob = await addPerson(db, 'user_bob', 'bob');
  carol = await addPerson(db, 'user_carol', 'carol');
});

const NO_SUCH_USER = '00000000-0000-4000-8000-000000000000';

const call = (clerkId: string, sql: string, params: unknown[] = []) =>
  db.asUser(clerkId).query(sql, params);
const unfriend = (clerkId: string, other: string) =>
  call(clerkId, `select public.unfriend($1)`, [other]);
const blockUser = (clerkId: string, other: string) =>
  call(clerkId, `select public.block_user($1)`, [other]);
const unblockUser = (clerkId: string, other: string) =>
  call(clerkId, `select public.unblock_user($1)`, [other]);

/** alice and bob become friends through the real flow: alice grants bob T3, bob grants alice T2. */
async function makeFriends() {
  await call('user_alice', `select public.send_friend_request($1, 3)`, [bob]);
  await call('user_bob', `select public.accept_friend_request($1, 2)`, [alice]);
  expect(await mutualTiers()).toEqual({ aliceSeesBob: 2, bobSeesAlice: 3 });
}

async function mutualTiers() {
  return {
    aliceSeesBob: await tierSeen(db, 'user_alice', bob, 'user_bob'),
    bobSeesAlice: await tierSeen(db, 'user_bob', alice, 'user_alice'),
  };
}

/** Everything bob can observe about alice through the client API. */
async function bobsViewOfAlice() {
  return {
    friendships: await call('user_bob', `select * from public.friendships`),
    rules: await call('user_bob', `select owner_id, target_id, tier from public.visibility_rules`),
    blocks: await call('user_bob', `select * from public.blocks`),
    friends: await call('user_bob', `select * from public.list_friends()`),
    requests: await call('user_bob', `select * from public.list_friend_requests()`),
    blockedByMe: await call('user_bob', `select * from public.list_blocked_users()`),
    events: await call('user_bob', `select * from public.events_for_viewer($1, $2, $3)`, [
      alice,
      ...RANGE,
    ]),
  };
}

describe('unfriend', () => {
  it('ends the friendship, deletes both rules and revokes visibility both ways at once', async () => {
    await makeFriends();
    await unfriend('user_alice', bob);
    expect(await mutualTiers()).toEqual({ aliceSeesBob: null, bobSeesAlice: null });
    expect(await graphState(db)).toEqual({ friendships: [], rules: [], blocks: [] });
  });

  it('revokes visibility within the same transaction', async () => {
    await makeFriends();
    const counts = await db.asUser('user_bob').run(async (tx) => {
      const count = async () =>
        (await tx.query(`select * from public.events_for_viewer($1, $2, $3)`, [alice, ...RANGE]))
          .rows.length;
      const before = await count();
      await tx.query(`select public.unfriend($1)`, [alice]);
      return [before, await count()];
    });
    expect(counts).toEqual([1, 0]);
  });

  it('either side can unfriend; repeating it is harmless', async () => {
    await makeFriends();
    await unfriend('user_bob', alice);
    await unfriend('user_bob', alice);
    await unfriend('user_alice', bob);
    expect(await mutualTiers()).toEqual({ aliceSeesBob: null, bobSeesAlice: null });
  });

  it('a third person can’t unfriend other people', async () => {
    await makeFriends();
    await unfriend('user_carol', alice);
    await unfriend('user_carol', bob);
    expect(await mutualTiers()).toEqual({ aliceSeesBob: 2, bobSeesAlice: 3 });
  });

  it('leaves pending requests alone (those are declined or cancelled)', async () => {
    await call('user_alice', `select public.send_friend_request($1, 3)`, [bob]);
    await unfriend('user_alice', bob);
    await unfriend('user_bob', alice);
    expect((await graphState(db)).friendships).toMatchObject([{ status: 'pending' }]);
    expect((await graphState(db)).rules).toEqual([{ owner_id: alice, target_id: bob, tier: 3 }]);
  });

  it('old tiers don’t come back if they become friends again', async () => {
    await makeFriends();
    await unfriend('user_alice', bob);
    await call('user_bob', `select public.send_friend_request($1)`, [alice]);
    await call('user_alice', `select public.accept_friend_request($1)`, [bob]);
    expect(await mutualTiers()).toEqual({ aliceSeesBob: 1, bobSeesAlice: 1 });
  });

  it('a shared group still applies afterwards, at the group’s tier (FR-SOC-5)', async () => {
    const g = await addGroup(db, carol, [alice, bob]);
    await setRule(db, alice, 'group', g, 1);
    await setRule(db, bob, 'group', g, 1);
    await makeFriends();
    await unfriend('user_alice', bob);
    expect(await mutualTiers()).toEqual({ aliceSeesBob: 1, bobSeesAlice: 1 });
  });
});

describe('block_user', () => {
  it('ends the friendship, deletes both rules and revokes visibility both ways at once', async () => {
    await makeFriends();
    await blockUser('user_alice', bob);
    expect(await mutualTiers()).toEqual({ aliceSeesBob: null, bobSeesAlice: null });
    expect(await graphState(db)).toEqual({
      friendships: [],
      rules: [],
      blocks: [{ blocker_id: alice, blocked_id: bob }],
    });
  });

  it('the blocked person sees exactly what they would after an unfriend', async () => {
    await makeFriends();
    await unfriend('user_alice', bob);
    const afterUnfriend = await bobsViewOfAlice();
    await db.reset();
    alice = await addPerson(db, 'user_alice', 'alice');
    bob = await addPerson(db, 'user_bob', 'bob');
    await makeFriends();
    await blockUser('user_alice', bob);
    expect(await bobsViewOfAlice()).toEqual(afterUnfriend);
  });

  it('ends pending requests in either direction, with the pending tier choice', async () => {
    await call('user_alice', `select public.send_friend_request($1, 3)`, [bob]);
    await call('user_carol', `select public.send_friend_request($1, 2)`, [alice]);
    await blockUser('user_alice', bob); // alice's outgoing request
    await blockUser('user_alice', carol); // alice's incoming request
    const state = await graphState(db);
    expect(state.friendships).toEqual([]);
    expect(state.rules).toEqual([]);
    expect(await call('user_bob', `select * from public.list_friend_requests()`)).toEqual([]);
    expect(await call('user_carol', `select * from public.list_friend_requests()`)).toEqual([]);
  });

  it('gives nothing through a shared group either', async () => {
    const g = await addGroup(db, carol, [alice, bob]);
    await setRule(db, alice, 'group', g, 3);
    await setRule(db, bob, 'group', g, 3);
    expect(await mutualTiers()).toEqual({ aliceSeesBob: 3, bobSeesAlice: 3 });
    await blockUser('user_bob', alice);
    expect(await mutualTiers()).toEqual({ aliceSeesBob: null, bobSeesAlice: null });
    // Group memberships are left to the groups functions.
    const { rows } = await db.admin.query(
      `select count(*)::int as n from public.group_members where group_id = $1`,
      [g],
    );
    expect(rows).toEqual([{ n: 3 }]);
  });

  it('is idempotent and never rate-limited', async () => {
    const others: string[] = [];
    for (let i = 0; i < 25; i++) others.push(await addUser(db, `user_x${i}`));
    for (const o of others) await blockUser('user_alice', o);
    await blockUser('user_alice', others[0] as string);
    expect(await call('user_alice', `select * from public.list_blocked_users()`)).toHaveLength(25);
  });

  it('refuses yourself (WF202) and unknown users (WF201)', async () => {
    expect(await codeOf(blockUser('user_alice', alice))).toBe(DB_ERROR.cannotTargetSelf);
    expect(await codeOf(blockUser('user_alice', NO_SUCH_USER))).toBe(DB_ERROR.userNotFound);
  });

  it('blocking someone who already blocked you works and reveals nothing', async () => {
    await block(db, bob, alice);
    await blockUser('user_alice', bob);
    expect((await graphState(db)).blocks).toHaveLength(2);
    expect(await call('user_alice', `select blocker_id, blocked_id from public.blocks`)).toEqual([
      { blocker_id: alice, blocked_id: bob },
    ]);
  });

  it('after a block neither can send the other a request or find them', async () => {
    await blockUser('user_alice', bob);
    expect(await codeOf(call('user_bob', `select public.send_friend_request($1)`, [alice]))).toBe(
      DB_ERROR.userNotFound,
    );
    expect(await codeOf(call('user_alice', `select public.send_friend_request($1)`, [bob]))).toBe(
      DB_ERROR.blockedByYou,
    );
    expect(await call('user_bob', `select * from public.find_user_by_handle('alice')`)).toEqual([]);
    expect(await call('user_bob', `select * from public.get_profile($1)`, [alice])).toEqual([]);
  });

  it('a block between two other people changes nothing', async () => {
    await makeFriends();
    await blockUser('user_carol', alice);
    expect(await mutualTiers()).toEqual({ aliceSeesBob: 2, bobSeesAlice: 3 });
  });
});

describe('unblock_user', () => {
  it('lifts only the caller’s block and does not restore the friendship', async () => {
    await makeFriends();
    await blockUser('user_alice', bob);
    await unblockUser('user_alice', bob);
    expect(await graphState(db)).toEqual({ friendships: [], rules: [], blocks: [] });
    expect(await mutualTiers()).toEqual({ aliceSeesBob: null, bobSeesAlice: null });
    expect(await call('user_bob', `select * from public.get_profile($1)`, [alice])).toHaveLength(1);
    expect(await call('user_bob', `select public.send_friend_request($1) as r`, [alice])).toEqual([
      { r: 'pending' },
    ]);
  });

  it('the blocked person can’t lift a block on themself', async () => {
    await blockUser('user_alice', bob);
    await unblockUser('user_bob', alice);
    expect((await graphState(db)).blocks).toEqual([{ blocker_id: alice, blocked_id: bob }]);
  });

  it('with blocks both ways, one unblocking leaves the other’s block in force (D43)', async () => {
    await blockUser('user_alice', bob);
    await blockUser('user_bob', alice);
    await unblockUser('user_alice', bob);
    expect((await graphState(db)).blocks).toEqual([{ blocker_id: bob, blocked_id: alice }]);
    expect(await codeOf(call('user_alice', `select public.send_friend_request($1)`, [bob]))).toBe(
      DB_ERROR.userNotFound,
    );
  });

  it('is idempotent, including for someone never blocked', async () => {
    await unblockUser('user_alice', bob);
    await unblockUser('user_alice', NO_SUCH_USER);
    await unblockUser('user_alice', alice);
  });
});

describe('list_blocked_users', () => {
  it('shows the caller’s blocks with public profiles, never who blocked the caller', async () => {
    await blockUser('user_alice', bob);
    await blockUser('user_carol', alice);
    expect(await call('user_alice', `select * from public.list_blocked_users()`)).toEqual([
      {
        user_id: bob,
        name: 'Name of user_bob',
        handle: 'bob',
        avatar_url: null,
        blocked_at: expect.any(Date),
      },
    ]);
    expect(await call('user_bob', `select * from public.list_blocked_users()`)).toEqual([]);
  });
});

describe('every function returning other users’ data respects blocks (FR-SOC-6)', () => {
  it.each(['alice blocks bob', 'bob blocks alice'])('%s: bob gets nothing of alice', async (c) => {
    // Seeded so the rows a block would normally delete are still there: the
    // read functions must filter on their own, not rely on the cleanup.
    await befriend(db, alice, bob);
    await setRule(db, alice, 'friend', bob, 3);
    await befriend(db, carol, bob, 'pending'); // unaffected by any block
    await befriend(db, alice, carol, 'pending'); // across alice's block of carol, below
    const g = await addGroup(db, carol, [alice, bob]);
    await setRule(db, alice, 'group', g, 3);
    if (c === 'alice blocks bob') await block(db, alice, bob);
    else await block(db, bob, alice);
    await block(db, alice, carol);
    const view = await bobsViewOfAlice();
    expect(view.events).toEqual([]);
    expect(view.friends).toEqual([]);
    expect(await call('user_bob', `select * from public.get_profile($1)`, [alice])).toEqual([]);
    expect(await call('user_bob', `select * from public.find_user_by_handle('alice')`)).toEqual([]);
    expect(await call('user_alice', `select * from public.list_friends()`)).toEqual([]);
    expect(await call('user_alice', `select * from public.list_friend_requests()`)).toEqual([]);
    const carolsRequests = await call('user_carol', `select * from public.list_friend_requests()`);
    expect(carolsRequests).toHaveLength(1);
    expect(carolsRequests).toMatchObject([{ user_id: bob, direction: 'outgoing' }]);
  });
});

describe('concurrency: unfriend, block and unblock hold the pair lock', () => {
  it.each(['unfriend', 'block_user', 'unblock_user'])('%s', async (fn) => {
    await makeFriends();
    const held = await db.asUser('user_alice').run(async (tx) => {
      await tx.query(`select public.${fn}($1)`, [bob]);
      const { rows } = await tx.query<{ held: boolean }>(
        `select exists (
           select 1 from pg_locks l
           where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted
             and ((l.classid::bigint << 32) | l.objid::bigint)
                 = hashtextextended('whosfree.friend_pair:' || least($1::uuid, $2::uuid)::text
                                    || ':' || greatest($1::uuid, $2::uuid)::text, 0)
         ) as held`,
        [alice, bob],
      );
      return rows[0]?.held;
    });
    expect(held).toBe(true);
  });
});

describe('access', () => {
  it.each([
    [`select public.unfriend($1)`, 'unfriend'],
    [`select public.block_user($1)`, 'block_user'],
    [`select public.unblock_user($1)`, 'unblock_user'],
    [`select * from public.list_blocked_users() where $1::uuid is not null`, 'list_blocked_users'],
  ])('anon and service_role cannot call %s', async (sql, fn) => {
    for (const as of [db.asAnon(), db.asService()]) {
      await expect(as.query(sql, [bob])).rejects.toThrow(
        new RegExp(`permission denied for function ${fn}`),
      );
    }
  });

  it('a token without a users row: writes raise WF001, the list is empty', async () => {
    for (const fn of ['unfriend', 'block_user', 'unblock_user']) {
      expect(await codeOf(call('user_nobody', `select public.${fn}($1)`, [bob]))).toBe(
        DB_ERROR.noAccount,
      );
    }
    expect(await call('user_nobody', `select * from public.list_blocked_users()`)).toEqual([]);
  });

  it('clients still cannot write blocks directly', async () => {
    await expect(
      call('user_bob', `insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`, [
        bob,
        alice,
      ]),
    ).rejects.toThrow(/permission denied for table blocks/);
    await blockUser('user_alice', bob);
    await expect(call('user_alice', `delete from public.blocks`)).rejects.toThrow(
      /permission denied for table blocks/,
    );
  });
});
