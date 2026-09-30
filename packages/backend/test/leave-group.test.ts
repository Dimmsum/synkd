// WF-047 (leave group): leaving revokes visibility straight away, and the
// admin must transfer the role first (FR-SOC-6, FR-SOC-7).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import {
  addProbeEvent,
  createInvite,
  expectNoExecute,
  expectPgError,
  groupWithMembers,
  join,
  locksGroupRow,
  tierSeen,
} from './harness/groups';
import { addUser, befriend, setRule } from './harness/seed';

let db: TestDb;
let admin: string;
let member: string;
let other: string;
let g: string;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.reset();
  admin = await addUser(db, 'user_admin');
  member = await addUser(db, 'user_member');
  other = await addUser(db, 'user_other');
  await addUser(db, 'user_outsider');
  g = await groupWithMembers(db, 'user_admin', ['user_member', 'user_other'], {
    adminTier: 3,
    memberTier: 3,
  });
  for (const u of [admin, member, other]) await addProbeEvent(db, u);
});

const leave = (clerk: string, groupId = g) =>
  db.asUser(clerk).query(`select public.leave_group($1)`, [groupId]);

async function rulesOf(userId: string): Promise<unknown[]> {
  const { rows } = await db.admin.query(
    `select target_type, target_id from public.visibility_rules where owner_id = $1`,
    [userId],
  );
  return rows;
}

describe('leave_group', () => {
  it('ends the membership and all group visibility at once, both ways', async () => {
    expect(await tierSeen(db, 'user_other', member)).toBe(3);
    expect(await tierSeen(db, 'user_member', other)).toBe(3);

    await leave('user_member');

    expect(await tierSeen(db, 'user_other', member)).toBe(null);
    expect(await tierSeen(db, 'user_admin', member)).toBe(null);
    expect(await tierSeen(db, 'user_member', other)).toBe(null);
    expect(await tierSeen(db, 'user_member', admin)).toBe(null);
    // The rest of the group is unaffected.
    expect(await tierSeen(db, 'user_other', admin)).toBe(3);
  });

  it("deletes the leaver's own rule for the group, and only that one", async () => {
    await leave('user_member');
    expect(await rulesOf(member)).toEqual([]);
    expect(await rulesOf(other)).toEqual([{ target_type: 'group', target_id: g }]);
  });

  it('revokes the invite links the leaver created', async () => {
    const link = await createInvite(db, 'user_member', g);
    await leave('user_member');
    const { rows } = await db.admin.query(`select revoked from public.invites where id = $1`, [
      link.id,
    ]);
    expect(rows).toEqual([{ revoked: true }]);
    await addUser(db, 'user_late');
    await expectPgError(join(db, 'user_late', link.code), 'This invite has been revoked');
  });

  it('the invite page then reports those links as revoked, with no group details', async () => {
    const link = await createInvite(db, 'user_member', g);
    await leave('user_member');
    expect(
      await db.asAnon().query(`select * from public.get_invite_summary($1)`, [link.code]),
    ).toEqual([
      {
        status: 'revoked',
        inviter_name: null,
        group_name: null,
        group_emoji: null,
        member_count: null,
      },
    ]);
  });

  it('takes the group row lock first', async () => {
    expect(await locksGroupRow(db, 'user_member', g, `select public.leave_group($1)`, [g])).toBe(
      true,
    );
  });

  it('the group disappears from the leaver’s lists', async () => {
    await leave('user_member');
    expect(await db.asUser('user_member').query(`select * from public.list_my_groups()`)).toEqual(
      [],
    );
    expect(await db.asUser('user_member').query(`select id from public.groups`)).toEqual([]);
    await expectPgError(
      db.asUser('user_member').query(`select * from public.get_group_members($1)`, [g]),
      'Group not found',
    );
  });

  it('keeps a friendship: a friend who shared the group still sees the friend tier', async () => {
    await befriend(db, member, other);
    await setRule(db, member, 'friend', other, 2);
    await leave('user_member');
    expect(await tierSeen(db, 'user_other', member)).toBe(2);
  });

  it('a member can rejoin later with a new tier', async () => {
    await leave('user_member');
    const { code } = await createInvite(db, 'user_admin', g);
    await join(db, 'user_member', code, 1);
    expect(await tierSeen(db, 'user_other', member)).toBe(1);
  });

  it('the admin must transfer the role first (FR-SOC-7), and then can leave', async () => {
    await expectPgError(
      leave('user_admin'),
      'Transfer the admin role before leaving the group',
      'P0001',
    );
    expect(await tierSeen(db, 'user_member', admin)).toBe(3);
    await db.asUser('user_admin').query(`select public.transfer_group_admin($1, $2)`, [g, member]);
    await leave('user_admin');
    expect(await tierSeen(db, 'user_member', admin)).toBe(null);
    const { rows } = await db.admin.query(`select admin_id from public.groups where id = $1`, [g]);
    expect(rows).toEqual([{ admin_id: member }]);
  });

  it('a non-member gets "Group not found"; anon cannot call it', async () => {
    await expectPgError(leave('user_outsider'), 'Group not found', 'P0002');
    await leave('user_member');
    await expectPgError(leave('user_member'), 'Group not found', 'P0002');
    await expectNoExecute(db.asAnon().query(`select public.leave_group($1)`, [g]), 'leave_group');
    await expectPgError(leave('user_nobody'), 'Not signed in', '42501');
  });
});
