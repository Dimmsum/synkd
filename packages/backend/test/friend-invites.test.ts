// WF-042: friend invite links (FR-SOC-1, FR-SOC-3, FR-SOC-6, FR-VIS-1,
// NFR-SEC-9, D20, D43). Requests go through the same path as
// send_friend_request, so tiers are checked through events_for_viewer.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { INVITE_CODE_PATTERN } from '@synkd/shared';
import { DB_ERROR } from '../src/errors';
import { GROUP_ERRORS } from '../src/index';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import { codeOf } from './harness/errors';
import { addGroup, befriend, block } from './harness/seed';
import { createInvite, expectPgError, setRateCount } from './harness/groups';
import { addPerson, graphState, tierSeen } from './harness/social';

let db: TestDb;
let alice: string;
let bob: string;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.reset();
  alice = await addPerson(db, 'user_alice', 'alice');
  bob = await addPerson(db, 'user_bob', 'bob');
  await addPerson(db, 'user_carol', 'carol');
});

interface FriendInviteRow {
  id: string;
  code: string;
  uses: number;
  created_at: Date;
}

async function one<T>(clerkId: string, sql: string, params: unknown[] = []): Promise<T> {
  const [row] = await db.asUser(clerkId).query<T & Record<string, unknown>>(sql, params);
  if (row === undefined) throw new Error(`no row from ${sql}`);
  return row;
}

const create = (clerkId: string) =>
  one<FriendInviteRow>(clerkId, `select * from public.create_friend_invite()`);
const regenerate = (clerkId: string) =>
  one<FriendInviteRow>(clerkId, `select * from public.regenerate_friend_invite()`);
const revoke = (clerkId: string) =>
  db.asUser(clerkId).query(`select public.revoke_friend_invite()`);
const mine = (clerkId: string) =>
  db
    .asUser(clerkId)
    .query<FriendInviteRow & Record<string, unknown>>(
      `select * from public.get_my_friend_invite()`,
    );
const summaryAs = (session: ReturnType<TestDb['asAnon']>, code: string) =>
  session.query(`select * from public.get_friend_invite_summary($1)`, [code]);
const preview = (clerkId: string, code: string) =>
  db.asUser(clerkId).query(`select * from public.preview_friend_invite($1)`, [code]);
const request = (clerkId: string, code: string, tier?: number) =>
  tier === undefined
    ? db.asUser(clerkId).query(`select * from public.request_friend_by_invite($1)`, [code])
    : db
        .asUser(clerkId)
        .query(`select * from public.request_friend_by_invite($1, $2)`, [code, tier]);

async function usesOf(code: string): Promise<number> {
  const { rows } = await db.admin.query<{ uses: number }>(
    `select uses from public.invites where code = $1`,
    [code],
  );
  return rows[0]?.uses ?? -1;
}

describe('create / get / regenerate / revoke', () => {
  it('creates one live link per user and returns the same one again for free', async () => {
    expect(await mine('user_alice')).toEqual([]);
    const first = await create('user_alice');
    expect(first.code).toMatch(INVITE_CODE_PATTERN);
    expect(first.uses).toBe(0);
    expect(await create('user_alice')).toEqual(first);
    expect(await mine('user_alice')).toEqual([first]);
    expect(await mine('user_bob')).toEqual([]);

    const { rows } = await db.admin.query(
      `select count from public.rate_limits where action = 'friend_invite'`,
    );
    expect(rows).toEqual([{ count: 1 }]);
  });

  it('a friend link has no group, expiry or use limit, and the database refuses one that has', async () => {
    const link = await create('user_alice');
    const { rows } = await db.admin.query(
      `select group_id, expires_at, max_uses, revoked from public.invites where id = $1`,
      [link.id],
    );
    expect(rows).toEqual([{ group_id: null, expires_at: null, max_uses: null, revoked: false }]);
    expect(
      await codeOf(
        db.admin.query(
          `insert into public.invites (code, inviter_id, max_uses) values ($1, $2, 5)`,
          ['A'.repeat(22), bob],
        ),
      ),
    ).toBe('23514');
    // A second live friend link for the same person.
    expect(
      await codeOf(
        db.admin.query(`insert into public.invites (code, inviter_id) values ($1, $2)`, [
          'B'.repeat(22),
          alice,
        ]),
      ),
    ).toBe('23505');
  });

  it('regenerate turns the old code off and returns a new one', async () => {
    const old = await create('user_alice');
    const fresh = await regenerate('user_alice');
    expect(fresh.code).not.toBe(old.code);
    expect(await mine('user_alice')).toEqual([fresh]);
    await expectPgError(request('user_bob', old.code), GROUP_ERRORS.inviteRevoked, 'P0001');
    expect(await request('user_bob', fresh.code)).toEqual([{ status: 'pending', user_id: alice }]);
  });

  it('revoke turns the link off, is idempotent, and create then makes a new one', async () => {
    const old = await create('user_alice');
    await revoke('user_alice');
    await revoke('user_alice');
    expect(await mine('user_alice')).toEqual([]);
    await expectPgError(request('user_bob', old.code), GROUP_ERRORS.inviteRevoked, 'P0001');
    const fresh = await create('user_alice');
    expect(fresh.code).not.toBe(old.code);
  });

  it('new links are limited to 10 a day, shared by create and regenerate (NFR-SEC-9)', async () => {
    await setRateCount(db, alice, 'friend_invite', 9);
    const link = await create('user_alice');
    await expectPgError(regenerate('user_alice'), 'Too many attempts', 'PT429');
    // The refused regenerate left the link working.
    expect(await mine('user_alice')).toEqual([link]);
    // Returning the existing link costs nothing.
    expect(await create('user_alice')).toEqual(link);
    // Revoking is never limited.
    await revoke('user_alice');
    expect(await mine('user_alice')).toEqual([]);
  });

  it('needs an account, and the codes are never readable from the table', async () => {
    expect(
      await codeOf(db.asUser('user_nobody').query(`select public.create_friend_invite()`)),
    ).toBe(DB_ERROR.noAccount);
    expect(
      await db.asUser('user_nobody').query(`select * from public.get_my_friend_invite()`),
    ).toEqual([]);
    await create('user_alice');
    await expect(db.asUser('user_alice').query(`select * from public.invites`)).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('get_friend_invite_summary (the public /i/[code] page)', () => {
  it('shows only the status and the inviter’s name, to anyone', async () => {
    const { code } = await create('user_alice');
    expect(await summaryAs(db.asAnon(), code)).toEqual([
      { status: 'valid', inviter_name: 'Name of user_alice' },
    ]);
    expect(await summaryAs(db.asUser('user_bob'), code)).toEqual([
      { status: 'valid', inviter_name: 'Name of user_alice' },
    ]);
  });

  it('a turned-off link says only that', async () => {
    const { code } = await create('user_alice');
    await revoke('user_alice');
    expect(await summaryAs(db.asAnon(), code)).toEqual([{ status: 'revoked', inviter_name: null }]);
  });

  it('nothing for unknown or malformed codes, or for group invites', async () => {
    const g = await addGroup(db, alice);
    const groupInvite = await createInvite(db, 'user_alice', g);
    for (const code of ['A'.repeat(22), 'nope', '', groupInvite.code]) {
      expect(await summaryAs(db.asAnon(), code)).toEqual([]);
    }
  });

  it('nothing for a signed-in caller blocked either way', async () => {
    const { code } = await create('user_alice');
    await block(db, alice, bob);
    expect(await summaryAs(db.asUser('user_bob'), code)).toEqual([]);
    await create('user_bob');
    const bobs = (await mine('user_bob'))[0]?.code ?? '';
    expect(await summaryAs(db.asUser('user_alice'), bobs)).toEqual([]);
  });
});

describe('preview_friend_invite', () => {
  it('returns the inviter’s public profile and relationship', async () => {
    const { code } = await create('user_alice');
    expect(await preview('user_bob', code)).toEqual([
      {
        status: 'valid',
        user_id: alice,
        name: 'Name of user_alice',
        handle: 'alice',
        avatar_url: null,
        relationship: 'none',
      },
    ]);
    expect((await preview('user_alice', code))[0]).toMatchObject({ relationship: 'self' });
    await befriend(db, alice, bob);
    expect((await preview('user_bob', code))[0]).toMatchObject({ relationship: 'friend' });
  });

  it('nothing across a block, either way, or without an account', async () => {
    const { code } = await create('user_alice');
    await block(db, bob, alice);
    expect(await preview('user_bob', code)).toEqual([]);
    expect(await preview('user_nobody', code)).toEqual([]);
    expect(await preview('user_carol', code)).toHaveLength(1);
  });

  it('a turned-off link reveals nothing about the inviter', async () => {
    const { code } = await create('user_alice');
    await revoke('user_alice');
    expect(await preview('user_bob', code)).toEqual([
      {
        status: 'revoked',
        user_id: null,
        name: null,
        handle: null,
        avatar_url: null,
        relationship: null,
      },
    ]);
  });

  it('anon can’t call it', async () => {
    await expect(
      db.asAnon().query(`select * from public.preview_friend_invite('${'A'.repeat(22)}')`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('request_friend_by_invite', () => {
  it('sends the inviter a request with the chosen tier (T1 by default) and counts the use', async () => {
    const { code } = await create('user_alice');
    expect(await request('user_bob', code)).toEqual([{ status: 'pending', user_id: alice }]);
    expect(await usesOf(code)).toBe(1);
    const state = await graphState(db);
    expect(state.friendships).toEqual([
      expect.objectContaining({ status: 'pending', requested_by: bob }),
    ]);
    expect(state.rules).toEqual([{ owner_id: bob, target_id: alice, tier: 1 }]);
    // Nothing is visible until alice accepts.
    expect(await tierSeen(db, 'user_alice', bob, 'user_bob')).toBeNull();

    await db.asUser('user_alice').query(`select public.accept_friend_request($1, 2)`, [bob]);
    expect(await tierSeen(db, 'user_alice', bob, 'user_bob')).toBe(1);
    expect(await tierSeen(db, 'user_bob', alice, 'user_alice')).toBe(2);
  });

  it('uses the tier the requester picked', async () => {
    const { code } = await create('user_alice');
    await request('user_bob', code, 3);
    expect((await graphState(db)).rules).toEqual([{ owner_id: bob, target_id: alice, tier: 3 }]);
    expect(await codeOf(request('user_carol', code, 4))).toBe('22023');
  });

  it('accepts straight away when the inviter had already asked', async () => {
    await db.asUser('user_alice').query(`select public.send_friend_request($1, 2)`, [bob]);
    const { code } = await create('user_alice');
    expect(await request('user_bob', code, 3)).toEqual([{ status: 'accepted', user_id: alice }]);
    expect(await tierSeen(db, 'user_bob', alice, 'user_alice')).toBe(2);
    expect(await tierSeen(db, 'user_alice', bob, 'user_bob')).toBe(3);
  });

  it('reuses the friend request rules: self, already friends, already sent', async () => {
    const { code } = await create('user_alice');
    expect(await codeOf(request('user_alice', code))).toBe(DB_ERROR.cannotTargetSelf);
    await request('user_bob', code);
    expect(await codeOf(request('user_bob', code))).toBe(DB_ERROR.requestAlreadySent);
    await db.asUser('user_alice').query(`select public.accept_friend_request($1)`, [bob]);
    expect(await codeOf(request('user_bob', code))).toBe(DB_ERROR.alreadyFriends);
    // Failed requests don't count as uses.
    expect(await usesOf(code)).toBe(1);
  });

  it('blocks: the inviter blocked you → "Invite not found"; you blocked them → WF206', async () => {
    const { code } = await create('user_alice');
    await block(db, alice, bob);
    await expectPgError(request('user_bob', code), GROUP_ERRORS.inviteNotFound, 'P0002');
    await db.admin.query(`delete from public.blocks`);
    await block(db, bob, alice);
    expect(await codeOf(request('user_bob', code))).toBe(DB_ERROR.blockedByYou);
    expect((await graphState(db)).friendships).toEqual([]);
    expect(await usesOf(code)).toBe(0);
  });

  it('unknown, malformed or group codes are "Invite not found"', async () => {
    const g = await addGroup(db, alice);
    const groupInvite = await createInvite(db, 'user_alice', g);
    for (const code of ['A'.repeat(22), 'short', groupInvite.code]) {
      await expectPgError(request('user_bob', code), GROUP_ERRORS.inviteNotFound, 'P0002');
    }
  });

  it('is limited like any friend request (NFR-SEC-9)', async () => {
    const { code } = await create('user_alice');
    await setRateCount(db, bob, 'friend_request', 20);
    await expectPgError(request('user_bob', code), 'Too many attempts', 'PT429');
    expect(await usesOf(code)).toBe(0);
  });
});

describe('group invite functions ignore friend links', () => {
  it('get_invite_summary and join_group treat a friend code as not found', async () => {
    const { code } = await create('user_alice');
    expect(await db.asAnon().query(`select * from public.get_invite_summary($1)`, [code])).toEqual(
      [],
    );
    await expectPgError(
      db.asUser('user_bob').query(`select public.join_group($1)`, [code]),
      GROUP_ERRORS.inviteNotFound,
      'P0002',
    );
  });
});
