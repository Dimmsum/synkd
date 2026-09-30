// WF-042: friend requests with tier choice (FR-SOC-1, FR-SOC-6, FR-VIS-1,
// FR-VIS-2, NFR-SEC-9, D20). Tiers are checked through events_for_viewer,
// the path real viewers use, not by reading visibility_rules.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DB_ERROR } from '../src/errors';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import { codeInTx, codeOf, errorOf } from './harness/errors';
import { addUser, befriend, block } from './harness/seed';
import { addPerson, graphState, tierSeen } from './harness/social';

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
  bob = await addPerson(db, 'user_bob', 'Bob_Marley');
  carol = await addPerson(db, 'user_carol', 'carol');
});

const NO_SUCH_USER = '00000000-0000-4000-8000-000000000000';

async function call<T = unknown>(clerkId: string, sql: string, params: unknown[] = []) {
  return db.asUser(clerkId).query<T & Record<string, unknown>>(sql, params);
}
const send = (clerkId: string, to: string, tier?: number) =>
  tier === undefined
    ? call<{ r: string }>(clerkId, `select public.send_friend_request($1) as r`, [to])
    : call<{ r: string }>(clerkId, `select public.send_friend_request($1, $2) as r`, [to, tier]);
const sendByHandle = (clerkId: string, handle: string, tier?: number) =>
  tier === undefined
    ? call<{ r: string }>(clerkId, `select public.send_friend_request_by_handle($1) as r`, [handle])
    : call<{ r: string }>(clerkId, `select public.send_friend_request_by_handle($1, $2) as r`, [
        handle,
        tier,
      ]);
const accept = (clerkId: string, from: string, tier?: number) =>
  tier === undefined
    ? call(clerkId, `select public.accept_friend_request($1)`, [from])
    : call(clerkId, `select public.accept_friend_request($1, $2)`, [from, tier]);
const decline = (clerkId: string, from: string) =>
  call(clerkId, `select public.decline_friend_request($1)`, [from]);
const cancel = (clerkId: string, to: string) =>
  call(clerkId, `select public.cancel_friend_request($1)`, [to]);
const listRequests = (clerkId: string) =>
  call(clerkId, `select * from public.list_friend_requests()`);
const listFriends = (clerkId: string) => call(clerkId, `select * from public.list_friends()`);

/** What each of alice and bob sees of the other. */
async function mutualTiers() {
  return {
    aliceSeesBob: await tierSeen(db, 'user_alice', bob, 'user_bob'),
    bobSeesAlice: await tierSeen(db, 'user_bob', alice, 'user_alice'),
  };
}

describe('send_friend_request / send_friend_request_by_handle', () => {
  it('by handle creates a pending request and stores the sender’s tier choice, granting nothing yet', async () => {
    expect(await sendByHandle('user_alice', '@bob_marley', 3)).toEqual([{ r: 'pending' }]);
    expect(await graphState(db)).toEqual({
      friendships: [
        {
          user_a: alice < bob ? alice : bob,
          user_b: alice < bob ? bob : alice,
          status: 'pending',
          requested_by: alice,
        },
      ],
      rules: [{ owner_id: alice, target_id: bob, tier: 3 }],
      blocks: [],
    });
    expect(await mutualTiers()).toEqual({ aliceSeesBob: null, bobSeesAlice: null });
  });

  it('by id works the same, and the tier defaults to T1 (D20)', async () => {
    expect(await send('user_alice', bob)).toEqual([{ r: 'pending' }]);
    expect((await graphState(db)).rules).toEqual([{ owner_id: alice, target_id: bob, tier: 1 }]);
    expect(await sendByHandle('user_carol', 'ALICE')).toEqual([{ r: 'pending' }]);
    expect((await graphState(db)).rules).toContainEqual({
      owner_id: carol,
      target_id: alice,
      tier: 1,
    });
  });

  it('refuses a request to yourself (WF202)', async () => {
    expect(await codeOf(send('user_alice', alice))).toBe(DB_ERROR.cannotTargetSelf);
    expect(await codeOf(sendByHandle('user_alice', 'Alice'))).toBe(DB_ERROR.cannotTargetSelf);
  });

  it('an unknown id or handle is WF201', async () => {
    expect(await codeOf(send('user_alice', NO_SUCH_USER))).toBe(DB_ERROR.userNotFound);
    for (const h of ['nobody_here', 'bob', '', '@', 'not a handle'])
      expect(await codeOf(sendByHandle('user_alice', h))).toBe(DB_ERROR.userNotFound);
  });

  it('refuses a duplicate (WF204) and a request to a friend (WF203)', async () => {
    await send('user_alice', bob);
    expect(await codeOf(send('user_alice', bob))).toBe(DB_ERROR.requestAlreadySent);
    expect(await codeOf(sendByHandle('user_alice', 'bob_marley'))).toBe(
      DB_ERROR.requestAlreadySent,
    );
    await accept('user_bob', alice);
    expect(await codeOf(send('user_alice', bob))).toBe(DB_ERROR.alreadyFriends);
    expect(await codeOf(send('user_bob', alice))).toBe(DB_ERROR.alreadyFriends);
  });

  it.each([0, 4, -1, null])('refuses tier %j (22023) and creates nothing', async (tier) => {
    expect(
      await codeOf(call('user_alice', `select public.send_friend_request($1, $2)`, [bob, tier])),
    ).toBe('22023');
    expect(
      await codeOf(
        call('user_alice', `select public.send_friend_request_by_handle($1, $2)`, [
          'bob_marley',
          tier,
        ]),
      ),
    ).toBe('22023');
    expect((await graphState(db)).friendships).toEqual([]);
  });

  it('a request to someone who blocked you looks exactly like one to nobody (WF201)', async () => {
    await block(db, bob, alice);
    const blocked = await errorOf(send('user_alice', bob));
    const missing = await errorOf(send('user_alice', NO_SUCH_USER));
    expect(blocked.code).toBe(DB_ERROR.userNotFound);
    expect(blocked).toEqual(missing);
    expect(await codeOf(sendByHandle('user_alice', 'bob_marley'))).toBe(DB_ERROR.userNotFound);
    expect((await graphState(db)).friendships).toEqual([]);
  });

  it('a request to someone you blocked is WF206 (only the blocker sees this)', async () => {
    await block(db, alice, bob);
    expect(await codeOf(send('user_alice', bob))).toBe(DB_ERROR.blockedByYou);
    expect(await codeOf(sendByHandle('user_alice', 'bob_marley'))).toBe(DB_ERROR.blockedByYou);
    // And bob, the blocked one, gets "not found" asking alice.
    expect(await codeOf(send('user_bob', alice))).toBe(DB_ERROR.userNotFound);
    expect((await graphState(db)).friendships).toEqual([]);
  });

  it('with blocks both ways, each side’s own block is what they hear about', async () => {
    await block(db, alice, bob);
    await block(db, bob, alice);
    expect(await codeOf(send('user_alice', bob))).toBe(DB_ERROR.blockedByYou);
    expect(await codeOf(send('user_bob', alice))).toBe(DB_ERROR.blockedByYou);
  });

  it('a block between two other people changes nothing', async () => {
    await block(db, bob, carol);
    expect(await send('user_alice', bob)).toEqual([{ r: 'pending' }]);
  });
});

describe('mutual requests', () => {
  it('asking someone who already asked you accepts, each side keeping their chosen tier', async () => {
    await send('user_alice', bob, 2);
    expect(await sendByHandle('user_bob', 'alice', 3)).toEqual([{ r: 'accepted' }]);
    expect(await mutualTiers()).toEqual({ aliceSeesBob: 3, bobSeesAlice: 2 });
    expect((await graphState(db)).friendships).toMatchObject([{ status: 'accepted' }]);
  });
});

describe('accept_friend_request', () => {
  it('accepts with each side’s chosen tier, creating exactly one rule each way', async () => {
    await send('user_alice', bob, 3);
    await accept('user_bob', alice, 2);
    expect(await mutualTiers()).toEqual({ aliceSeesBob: 2, bobSeesAlice: 3 });
    const { rules, friendships } = await graphState(db);
    expect(friendships).toMatchObject([{ status: 'accepted', requested_by: alice }]);
    expect(rules).toEqual(
      [
        { owner_id: alice, target_id: bob, tier: 3 },
        { owner_id: bob, target_id: alice, tier: 2 },
      ].sort((x, y) => x.owner_id.localeCompare(y.owner_id)),
    );
  });

  it.each([
    [1, 1],
    [1, 3],
    [3, 1],
    [2, 2],
  ] as const)('sender picks T%i, recipient picks T%i', async (senderTier, recipientTier) => {
    await send('user_alice', bob, senderTier);
    await accept('user_bob', alice, recipientTier);
    expect(await mutualTiers()).toEqual({
      aliceSeesBob: recipientTier,
      bobSeesAlice: senderTier,
    });
  });

  it('both tiers default to T1', async () => {
    await send('user_alice', bob);
    await accept('user_bob', alice);
    expect(await mutualTiers()).toEqual({ aliceSeesBob: 1, bobSeesAlice: 1 });
  });

  it('gives the requester T1 if their rule is somehow missing', async () => {
    await befriend(db, alice, bob, 'pending'); // seeded without a rule
    await accept('user_bob', alice, 3);
    expect(await mutualTiers()).toEqual({ aliceSeesBob: 3, bobSeesAlice: 1 });
  });

  it('the sender cannot accept their own request (WF205)', async () => {
    await send('user_alice', bob, 3);
    expect(await codeOf(accept('user_alice', bob))).toBe(DB_ERROR.requestNotFound);
    expect((await graphState(db)).friendships).toMatchObject([{ status: 'pending' }]);
  });

  it('a third person cannot accept on someone’s behalf (WF205)', async () => {
    await send('user_alice', bob, 3);
    expect(await codeOf(accept('user_carol', alice))).toBe(DB_ERROR.requestNotFound);
    expect((await graphState(db)).friendships).toMatchObject([{ status: 'pending' }]);
    expect(await tierSeen(db, 'user_carol', alice, 'user_alice')).toBeNull();
  });

  it('WF205 when there is nothing pending: no request, already friends, yourself, unknown user', async () => {
    expect(await codeOf(accept('user_bob', alice))).toBe(DB_ERROR.requestNotFound);
    await send('user_alice', bob);
    await accept('user_bob', alice);
    expect(await codeOf(accept('user_bob', alice))).toBe(DB_ERROR.requestNotFound);
    expect(await codeOf(accept('user_bob', bob))).toBe(DB_ERROR.requestNotFound);
    expect(await codeOf(accept('user_bob', NO_SUCH_USER))).toBe(DB_ERROR.requestNotFound);
  });

  it('refuses a request left pending across a block (belt and braces)', async () => {
    await befriend(db, alice, bob, 'pending');
    await block(db, alice, bob); // seeded directly, so the request survived
    expect(await codeOf(accept('user_bob', alice))).toBe(DB_ERROR.requestNotFound);
    expect(await tierSeen(db, 'user_alice', bob, 'user_bob')).toBeNull();
  });

  it.each([0, 4, null])('refuses tier %j (22023) and stays pending', async (tier) => {
    await send('user_alice', bob);
    expect(
      await codeOf(call('user_bob', `select public.accept_friend_request($1, $2)`, [alice, tier])),
    ).toBe('22023');
    expect((await graphState(db)).friendships).toMatchObject([{ status: 'pending' }]);
  });
});

describe('decline_friend_request', () => {
  it('deletes the request and the sender’s pending tier choice; repeating is harmless', async () => {
    await send('user_alice', bob, 3);
    await decline('user_bob', alice);
    expect(await graphState(db)).toEqual({ friendships: [], rules: [], blocks: [] });
    await decline('user_bob', alice);
    expect(await listRequests('user_alice')).toEqual([]);
  });

  it('the sender or a third person can’t decline it', async () => {
    await send('user_alice', bob, 3);
    await decline('user_alice', bob);
    await decline('user_carol', alice);
    expect((await graphState(db)).friendships).toHaveLength(1);
  });

  it('does not touch an accepted friendship', async () => {
    await send('user_alice', bob, 2);
    await accept('user_bob', alice, 2);
    await decline('user_bob', alice);
    await decline('user_alice', bob);
    expect(await mutualTiers()).toEqual({ aliceSeesBob: 2, bobSeesAlice: 2 });
  });

  it('after a decline the sender can ask again (within the per-person limit)', async () => {
    await send('user_alice', bob);
    await decline('user_bob', alice);
    expect(await send('user_alice', bob)).toEqual([{ r: 'pending' }]);
  });
});

describe('cancel_friend_request', () => {
  it('withdraws the caller’s request and pending tier; repeating is harmless', async () => {
    await send('user_alice', bob, 2);
    await cancel('user_alice', bob);
    expect(await graphState(db)).toEqual({ friendships: [], rules: [], blocks: [] });
    await cancel('user_alice', bob);
  });

  it('the recipient or a third person can’t cancel it', async () => {
    await send('user_alice', bob);
    await cancel('user_bob', alice);
    await cancel('user_carol', bob);
    expect((await graphState(db)).friendships).toHaveLength(1);
  });

  it('does not touch an accepted friendship', async () => {
    await send('user_alice', bob);
    await accept('user_bob', alice);
    await cancel('user_alice', bob);
    expect(await mutualTiers()).toEqual({ aliceSeesBob: 1, bobSeesAlice: 1 });
  });
});

describe('list_friend_requests', () => {
  it('shows incoming and outgoing requests with public profiles; the tier only for outgoing', async () => {
    await send('user_alice', bob, 3);
    await send('user_carol', alice, 2);
    const aliceSees = await listRequests('user_alice');
    expect(aliceSees).toHaveLength(2);
    expect(aliceSees).toContainEqual({
      user_id: bob,
      name: 'Name of user_bob',
      handle: 'Bob_Marley',
      avatar_url: null,
      direction: 'outgoing',
      tier: 3,
      requested_at: expect.any(Date),
    });
    expect(aliceSees).toContainEqual(
      expect.objectContaining({ user_id: carol, direction: 'incoming', tier: null }),
    );
    // Bob doesn't learn the tier alice picked for him.
    expect(await listRequests('user_bob')).toEqual([
      expect.objectContaining({ user_id: alice, direction: 'incoming', tier: null }),
    ]);
  });

  it('shows nothing of other people’s requests, and drops accepted ones', async () => {
    await send('user_alice', bob);
    expect(await listRequests('user_carol')).toEqual([]);
    await accept('user_bob', alice);
    expect(await listRequests('user_alice')).toEqual([]);
    expect(await listRequests('user_bob')).toEqual([]);
  });

  it('leaves out anyone blocked either way', async () => {
    await befriend(db, alice, bob, 'pending');
    await befriend(db, carol, alice, 'pending');
    await block(db, bob, alice);
    await block(db, alice, carol);
    expect(await listRequests('user_alice')).toEqual([]);
    expect(await listRequests('user_bob')).toEqual([]);
    expect(await listRequests('user_carol')).toEqual([]);
  });
});

describe('list_friends', () => {
  it('shows friends with public profiles and the tier the caller grants each', async () => {
    await send('user_alice', bob, 3);
    await accept('user_bob', alice, 2);
    await send('user_carol', alice);
    expect(await listFriends('user_alice')).toEqual([
      { user_id: bob, name: 'Name of user_bob', handle: 'Bob_Marley', avatar_url: null, tier: 3 },
    ]);
    expect(await listFriends('user_bob')).toEqual([
      { user_id: alice, name: 'Name of user_alice', handle: 'alice', avatar_url: null, tier: 2 },
    ]);
    expect(await listFriends('user_carol')).toEqual([]);
  });

  it('leaves out anyone blocked either way', async () => {
    await befriend(db, alice, bob);
    await befriend(db, alice, carol);
    await block(db, bob, alice);
    await block(db, alice, carol);
    expect(await listFriends('user_alice')).toEqual([]);
    expect(await listFriends('user_bob')).toEqual([]);
    expect(await listFriends('user_carol')).toEqual([]);
  });
});

describe('changing a friend’s tier later (FR-VIS-2)', () => {
  it('updates only the caller’s own rule, and takes effect straight away', async () => {
    await send('user_alice', bob, 1);
    await accept('user_bob', alice, 1);
    await call(
      'user_alice',
      `update public.visibility_rules set tier = 3 where target_type = 'friend' and target_id = $1`,
      [bob],
    );
    expect(await mutualTiers()).toEqual({ aliceSeesBob: 1, bobSeesAlice: 3 });
    // Alice can't touch bob's rule for her.
    const touched = await call(
      'user_alice',
      `update public.visibility_rules set tier = 3 where owner_id = $1 returning id`,
      [bob],
    );
    expect(touched).toEqual([]);
    expect(await mutualTiers()).toEqual({ aliceSeesBob: 1, bobSeesAlice: 3 });
    expect(await listFriends('user_alice')).toMatchObject([{ tier: 3 }]);
  });
});

describe('rate limits (NFR-SEC-9)', () => {
  it('20 requests a day per sender; failed attempts don’t count; auto-accepts do', async () => {
    const others: string[] = [];
    for (let i = 0; i < 21; i++) others.push(await addUser(db, `user_x${i}`));
    await befriend(db, others[20] as string, alice, 'pending'); // x20 asked alice
    const codes = await db.asUser('user_alice').run(async (tx) => {
      const out: string[] = [];
      out.push(await codeInTx(tx, `select public.send_friend_request($1)`, [NO_SUCH_USER]));
      out.push(await codeInTx(tx, `select public.send_friend_request($1)`, [alice]));
      // 19 new requests + 1 auto-accept = 20.
      for (let i = 0; i < 20; i++)
        out.push(await codeInTx(tx, `select public.send_friend_request($1)`, [others[i + 1]]));
      return out;
    });
    expect(codes.slice(0, 2)).toEqual([DB_ERROR.userNotFound, DB_ERROR.cannotTargetSelf]);
    expect(codes.slice(2, 21)).toEqual(Array(19).fill('ok'));
    expect(codes[21]).toBe('ok'); // others[20]: the auto-accept
    // Anything more today is refused, by id or by handle.
    const more = await db
      .asUser('user_alice')
      .run(async (tx) => [
        await codeInTx(tx, `select public.send_friend_request($1)`, [others[0]]),
        await codeInTx(tx, `select public.send_friend_request_by_handle('carol')`),
      ]);
    expect(more).toEqual([DB_ERROR.rateLimited, DB_ERROR.rateLimited]);
  });

  it('3 requests a week to the same person, so decline/re-send can’t be used to nag', async () => {
    const codes = await db.asUser('user_alice').run(async (tx) => {
      const out: string[] = [];
      for (let i = 0; i < 4; i++) {
        out.push(await codeInTx(tx, `select public.send_friend_request($1)`, [bob]));
        await tx.query(`select public.cancel_friend_request($1)`, [bob]);
      }
      out.push(await codeInTx(tx, `select public.send_friend_request($1)`, [carol]));
      return out;
    });
    expect(codes).toEqual(['ok', 'ok', 'ok', DB_ERROR.rateLimited, 'ok']);
  });

  it('is per sender', async () => {
    await db.admin.query(
      `insert into public.rate_limits (user_id, action, window_start, window_end, count)
       select $1, 'friend_request', w, w + interval '1 day', 20
       from (select date_bin(interval '1 day', now(), timestamptz '2000-01-01 00:00:00+00') as w) t`,
      [alice],
    );
    expect(await codeOf(send('user_alice', bob))).toBe(DB_ERROR.rateLimited);
    expect(await send('user_carol', bob)).toEqual([{ r: 'pending' }]);
  });
});

describe('concurrency: every pair change holds the same pair lock', () => {
  async function pairLockHeldAfter(clerkId: string, sql: string, params: unknown[]) {
    return db.asUser(clerkId).run(async (tx) => {
      await tx.query(sql, params);
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
  }

  it('send (both ways), accept, decline and cancel lock the pair until commit', async () => {
    expect(
      await pairLockHeldAfter('user_alice', `select public.send_friend_request($1)`, [bob]),
    ).toBe(true);
    expect(
      await pairLockHeldAfter('user_bob', `select public.decline_friend_request($1)`, [alice]),
    ).toBe(true);
    expect(
      await pairLockHeldAfter(
        'user_bob',
        `select public.send_friend_request_by_handle('alice')`,
        [],
      ),
    ).toBe(true);
    expect(
      await pairLockHeldAfter('user_bob', `select public.cancel_friend_request($1)`, [alice]),
    ).toBe(true);
    await send('user_alice', bob);
    expect(
      await pairLockHeldAfter('user_bob', `select public.accept_friend_request($1)`, [alice]),
    ).toBe(true);
  });
});

describe('access', () => {
  it.each([
    [`select public.send_friend_request($1)`, 'send_friend_request'],
    [
      `select public.send_friend_request_by_handle('bob_marley') where $1::uuid is not null`,
      'send_friend_request_by_handle',
    ],
    [`select public.accept_friend_request($1)`, 'accept_friend_request'],
    [`select public.decline_friend_request($1)`, 'decline_friend_request'],
    [`select public.cancel_friend_request($1)`, 'cancel_friend_request'],
    [
      `select * from public.list_friend_requests() where $1::uuid is not null`,
      'list_friend_requests',
    ],
    [`select * from public.list_friends() where $1::uuid is not null`, 'list_friends'],
  ])('anon and service_role cannot call %s', async (sql, fn) => {
    for (const as of [db.asAnon(), db.asService()]) {
      await expect(as.query(sql, [bob])).rejects.toThrow(
        new RegExp(`permission denied for function ${fn}`),
      );
    }
  });

  it('a token without a users row: writes raise WF001, lists are empty', async () => {
    for (const sql of [
      `select public.send_friend_request($1)`,
      `select public.send_friend_request_by_handle('bob_marley') where $1::uuid is not null`,
      `select public.accept_friend_request($1)`,
      `select public.decline_friend_request($1)`,
      `select public.cancel_friend_request($1)`,
    ]) {
      expect(await codeOf(call('user_nobody', sql, [bob]))).toBe(DB_ERROR.noAccount);
    }
    expect(await listRequests('user_nobody')).toEqual([]);
    expect(await listFriends('user_nobody')).toEqual([]);
  });

  it('clients still cannot write friendships or create/delete rules directly', async () => {
    await send('user_alice', bob);
    await expect(
      call('user_bob', `update public.friendships set status = 'accepted'`),
    ).rejects.toThrow(/permission denied for table friendships/);
    await expect(
      call(
        'user_bob',
        `insert into public.visibility_rules (owner_id, target_type, target_id, tier)
         values ($1, 'friend', $2, 3)`,
        [alice, bob],
      ),
    ).rejects.toThrow(/permission denied for table visibility_rules/);
    await expect(call('user_alice', `delete from public.visibility_rules`)).rejects.toThrow(
      /permission denied for table visibility_rules/,
    );
  });
});
