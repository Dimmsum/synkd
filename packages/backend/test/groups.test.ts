// WF-043: groups. Create, edit, transfer admin, delete, list, and the member
// list with blocks applied (FR-SOC-2, FR-SOC-5, FR-SOC-7, FR-SOC-9,
// FR-SOC-10, FR-VIS-1, FR-VIS-2, D17, D20, D43).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_GROUP_MAX_MEMBERS, DEFAULT_MEMBER_PERMISSIONS } from '@whosfree/shared';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import {
  addProbeEvent,
  createGroup,
  expectNoExecute,
  expectPgError,
  groupWithMembers,
  locksGroupRow,
  tierSeen,
} from './harness/groups';
import { addUser, block, setRule } from './harness/seed';

let db: TestDb;
let admin: string;
let member: string;
let other: string;
let outsider: string;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.reset();
  admin = await addUser(db, 'user_admin');
  member = await addUser(db, 'user_member');
  other = await addUser(db, 'user_other');
  outsider = await addUser(db, 'user_outsider');
});

async function adminRow(groupId: string): Promise<unknown> {
  const { rows } = await db.admin.query(
    `select g.admin_id, array_agg(m.user_id) filter (where m.role = 'admin') as admin_rows
     from public.groups g join public.group_members m on m.group_id = g.id
     where g.id = $1 group by g.admin_id`,
    [groupId],
  );
  return rows[0];
}

async function memberRow(groupId: string, userId: string): Promise<Record<string, unknown>> {
  const { rows } = await db.admin.query<Record<string, unknown>>(
    `select role, can_invite as invite, can_manage_members as "manageMembers",
            can_edit_group as "editGroup", can_group_ping as "groupPing"
     from public.group_members where group_id = $1 and user_id = $2`,
    [groupId, userId],
  );
  return rows[0] ?? {};
}

async function groupRule(ownerId: string, groupId: string): Promise<number | undefined> {
  const { rows } = await db.admin.query<{ tier: number }>(
    `select tier from public.visibility_rules
     where owner_id = $1 and target_type = 'group' and target_id = $2`,
    [ownerId, groupId],
  );
  return rows[0]?.tier;
}

describe('create_group', () => {
  it('creates the group with the caller as admin holding every permission, and their tier', async () => {
    const g = await createGroup(db, 'user_admin', { name: '  Flat 4  ', emoji: '🏠', tier: 2 });
    const { rows } = await db.admin.query(
      `select name, emoji, admin_id, max_members, join_mode from public.groups where id = $1`,
      [g],
    );
    expect(rows).toEqual([
      {
        name: 'Flat 4',
        emoji: '🏠',
        admin_id: admin,
        max_members: DEFAULT_GROUP_MAX_MEMBERS,
        join_mode: 'open',
      },
    ]);
    expect(await memberRow(g, admin)).toEqual({
      role: 'admin',
      invite: true,
      manageMembers: true,
      editGroup: true,
      groupPing: true,
    });
    expect(await groupRule(admin, g)).toBe(2);
  });

  it('defaults to T1 (D20) and no emoji when none or a blank one is given', async () => {
    const g = await db
      .asUser('user_admin')
      .query<{ id: string }>(`select public.create_group('Study') as id`);
    const id = g[0]?.id ?? '';
    expect(await groupRule(admin, id)).toBe(1);
    const blank = await createGroup(db, 'user_admin', { emoji: '   ' });
    const { rows } = await db.admin.query(`select emoji from public.groups where id in ($1, $2)`, [
      id,
      blank,
    ]);
    expect(rows).toEqual([{ emoji: null }, { emoji: null }]);
  });

  it('rejects a bad name, emoji or tier', async () => {
    const call = (name: string | null, emoji: string | null, tier: number | null) =>
      db.asUser('user_admin').query(`select public.create_group($1, $2, $3)`, [name, emoji, tier]);
    for (const name of [null, '', '   ', 'x'.repeat(61)])
      await expectPgError(call(name, null, 1), 'Group name must be 1 to 60 characters', '22023');
    await expectPgError(
      call('Ok', 'x'.repeat(17), 1),
      'Emoji must be at most 16 characters',
      '22023',
    );
    for (const tier of [null, 0, 4])
      await expectPgError(call('Ok', null, tier), 'Tier must be 1, 2 or 3', '22023');
    const { rows } = await db.admin.query(`select 1 from public.groups`);
    expect(rows).toEqual([]);
  });

  it('needs a signed-in user with a users row; anon cannot call it', async () => {
    await expectNoExecute(db.asAnon().query(`select public.create_group('X')`), 'create_group');
    await expectPgError(
      db.asUser('user_nobody').query(`select public.create_group('X')`),
      'Not signed in',
      '42501',
    );
  });

  it('ignores any attempt to pick the admin or cap: the caller is always the admin', async () => {
    // There are no such arguments; the only way in is the function.
    await expect(
      db.asUser('user_admin').query(`select public.create_group('X', null, 1, $1)`, [other]),
    ).rejects.toThrow(/function public.create_group\(.*\) does not exist/);
  });
});

describe('update_group (admin or editGroup)', () => {
  let g: string;
  beforeEach(async () => {
    g = await groupWithMembers(db, 'user_admin', ['user_member']);
  });
  const update = (clerk: string, groupId: string, name: string, emoji: string | null) =>
    db.asUser(clerk).query(`select public.update_group($1, $2, $3)`, [groupId, name, emoji]);

  it('the admin can rename the group and change or clear its emoji', async () => {
    await update('user_admin', g, 'Netball A', '⚽');
    await update('user_admin', g, 'Netball B', null);
    const { rows } = await db.admin.query(`select name, emoji from public.groups where id = $1`, [
      g,
    ]);
    expect(rows).toEqual([{ name: 'Netball B', emoji: null }]);
  });

  it('a member without editGroup cannot; with it they can', async () => {
    await expectPgError(update('user_member', g, 'Mine', null), 'Not allowed', '42501');
    await db.admin.query(
      `update public.group_members set can_edit_group = true where group_id = $1 and user_id = $2`,
      [g, member],
    );
    await update('user_member', g, 'Renamed', '🎉');
    const { rows } = await db.admin.query(`select name from public.groups where id = $1`, [g]);
    expect(rows).toEqual([{ name: 'Renamed' }]);
  });

  it('a non-member gets "Group not found", the same as for a group that does not exist', async () => {
    await expectPgError(update('user_outsider', g, 'Mine', null), 'Group not found', 'P0002');
    await expectPgError(
      update('user_admin', '00000000-0000-4000-8000-000000000000', 'X', null),
      'Group not found',
      'P0002',
    );
  });

  it('anon cannot call it; bad names are rejected', async () => {
    await expectNoExecute(
      db.asAnon().query(`select public.update_group($1, 'X', null)`, [g]),
      'update_group',
    );
    await expectPgError(update('user_admin', g, '', null), 'Group name must be 1 to 60 characters');
  });
});

describe('transfer_group_admin (admin only, FR-SOC-7)', () => {
  let g: string;
  beforeEach(async () => {
    g = await groupWithMembers(db, 'user_admin', ['user_member', 'user_other']);
  });
  const transfer = (clerk: string, to: string, groupId = g) =>
    db.asUser(clerk).query(`select public.transfer_group_admin($1, $2)`, [groupId, to]);

  it('moves the role and groups.admin_id together; the old admin gets the D26 defaults', async () => {
    await transfer('user_admin', member);
    expect(await adminRow(g)).toEqual({ admin_id: member, admin_rows: [member] });
    expect(await memberRow(g, member)).toEqual({
      role: 'admin',
      invite: true,
      manageMembers: true,
      editGroup: true,
      groupPing: true,
    });
    expect(await memberRow(g, admin)).toEqual({ role: 'member', ...DEFAULT_MEMBER_PERMISSIONS });
    // The old admin has no admin rights left; the new admin has them.
    await expectPgError(transfer('user_admin', admin), 'Not allowed', '42501');
    await transfer('user_member', admin);
    expect(await adminRow(g)).toEqual({ admin_id: admin, admin_rows: [admin] });
  });

  it('a member holding every permission still cannot transfer the role', async () => {
    await db.admin.query(
      `update public.group_members set can_invite = true, can_manage_members = true,
         can_edit_group = true, can_group_ping = true where user_id = $1`,
      [member],
    );
    await expectPgError(transfer('user_member', other), 'Not allowed', '42501');
    expect(await adminRow(g)).toEqual({ admin_id: admin, admin_rows: [admin] });
  });

  it('rejects a target who is not a member, or the admin themself', async () => {
    await expectPgError(transfer('user_admin', outsider), 'Member not found', 'P0002');
    await expectPgError(transfer('user_admin', admin), 'Choose another member to become admin');
  });

  it('a non-member gets "Group not found"; anon cannot call it', async () => {
    await expectPgError(transfer('user_outsider', member), 'Group not found', 'P0002');
    await expectNoExecute(
      db.asAnon().query(`select public.transfer_group_admin($1, $2)`, [g, member]),
      'transfer_group_admin',
    );
  });
});

describe('groups.admin_id and the admin row cannot drift apart (deferred trigger)', () => {
  let g: string;
  beforeEach(async () => {
    g = await groupWithMembers(db, 'user_admin', ['user_member']);
  });

  it('rejects changing admin_id without moving the role, even for the superuser', async () => {
    await expect(
      db.admin.query(`update public.groups set admin_id = $2 where id = $1`, [g, member]),
    ).rejects.toThrow(/must have exactly one admin member, matching groups.admin_id/);
  });

  it('rejects demoting or deleting the admin row, or a group created without one', async () => {
    await expect(
      db.admin.query(`update public.group_members set role = 'member' where user_id = $1`, [admin]),
    ).rejects.toThrow(/must have exactly one admin member/);
    await expect(
      db.admin.query(`delete from public.group_members where user_id = $1`, [admin]),
    ).rejects.toThrow(/must have exactly one admin member/);
    await expect(
      db.admin.query(`insert into public.groups (name, admin_id) values ('Orphan', $1)`, [admin]),
    ).rejects.toThrow(/must have exactly one admin member/);
    expect(await adminRow(g)).toEqual({ admin_id: admin, admin_rows: [admin] });
  });

  it('two admin rows are impossible (partial unique index)', async () => {
    await expect(
      db.admin.query(`update public.group_members set role = 'admin' where user_id = $1`, [member]),
    ).rejects.toThrow(/group_members_one_admin_key/);
  });
});

describe('delete_group (admin only, FR-SOC-9)', () => {
  let g: string;
  beforeEach(async () => {
    g = await groupWithMembers(db, 'user_admin', ['user_member'], { memberTier: 3 });
  });
  const del = (clerk: string) => db.asUser(clerk).query(`select public.delete_group($1)`, [g]);

  it('removes the group, its members and group visibility rules; visibility ends', async () => {
    await addProbeEvent(db, member);
    expect(await tierSeen(db, 'user_admin', member)).toBe(3);
    await del('user_admin');
    for (const [table, column] of [
      ['groups', 'id'],
      ['group_members', 'group_id'],
      ['visibility_rules', 'target_id'],
    ] as const) {
      const { rows } = await db.admin.query(`select 1 from public.${table} where ${column} = $1`, [
        g,
      ]);
      expect({ table, rows }).toEqual({ table, rows: [] });
    }
    expect(await tierSeen(db, 'user_admin', member)).toBe(null);
  });

  it('a member (even with every permission) cannot; a non-member gets "Group not found"', async () => {
    await db.admin.query(
      `update public.group_members set can_invite = true, can_manage_members = true,
         can_edit_group = true, can_group_ping = true where user_id = $1`,
      [member],
    );
    await expectPgError(del('user_member'), 'Not allowed', '42501');
    await expectPgError(del('user_outsider'), 'Group not found', 'P0002');
    await expectNoExecute(db.asAnon().query(`select public.delete_group($1)`, [g]), 'delete_group');
    const { rows } = await db.admin.query(`select 1 from public.groups where id = $1`, [g]);
    expect(rows).toHaveLength(1);
  });
});

describe('list_my_groups', () => {
  it("returns only the caller's groups, with role, effective permissions and chosen tier", async () => {
    const netball = await groupWithMembers(db, 'user_admin', ['user_member'], {
      adminTier: 3,
      memberTier: 2,
    });
    await createGroup(db, 'user_other', { name: 'Not mine' });

    const mine = await db.asUser('user_member').query(`select * from public.list_my_groups()`);
    expect(mine).toEqual([
      {
        id: netball,
        name: 'Netball',
        emoji: '🏐',
        role: 'member',
        member_count: 2,
        max_members: DEFAULT_GROUP_MAX_MEMBERS,
        my_tier: 2,
        can_invite: true,
        can_manage_members: false,
        can_edit_group: false,
        can_group_ping: true,
        joined_at: expect.any(Date) as Date,
      },
    ]);
    const asAdmin = await db
      .asUser('user_admin')
      .query<Record<string, unknown>>(`select * from public.list_my_groups()`);
    expect(asAdmin).toHaveLength(1);
    expect(asAdmin[0]).toMatchObject({
      role: 'admin',
      my_tier: 3,
      can_invite: true,
      can_manage_members: true,
      can_edit_group: true,
      can_group_ping: true,
    });
  });

  it("the admin's permissions read as all true even if the stored columns say otherwise", async () => {
    const g = await createGroup(db, 'user_admin');
    await db.admin.query(
      `update public.group_members set can_invite = false, can_manage_members = false,
         can_edit_group = false, can_group_ping = false where group_id = $1`,
      [g],
    );
    const [row] = await db.asUser('user_admin').query(`select * from public.list_my_groups()`);
    expect(row).toMatchObject({
      can_invite: true,
      can_manage_members: true,
      can_edit_group: true,
      can_group_ping: true,
    });
  });

  it('member_count leaves out people blocked either way, matching the member list', async () => {
    const g = await groupWithMembers(db, 'user_admin', ['user_member', 'user_other']);
    await block(db, other, member);
    const count = async (clerk: string) =>
      (
        await db
          .asUser(clerk)
          .query<{ member_count: number }>(
            `select member_count from public.list_my_groups() where id = $1`,
            [g],
          )
      )[0]?.member_count;
    expect(await count('user_member')).toBe(2);
    expect(await count('user_other')).toBe(2);
    expect(await count('user_admin')).toBe(3);
  });

  it('anon cannot call it; a token without a users row is "Not signed in"', async () => {
    await expectNoExecute(
      db.asAnon().query(`select * from public.list_my_groups()`),
      'list_my_groups',
    );
    await expectPgError(
      db.asUser('user_nobody').query(`select * from public.list_my_groups()`),
      'Not signed in',
      '42501',
    );
  });
});

describe('get_group_members', () => {
  let g: string;
  beforeEach(async () => {
    await db.admin.query(
      `update public.users set handle = 'mem', avatar_url = 'https://img.example/m.png'
       where id = $1`,
      [member],
    );
    g = await groupWithMembers(db, 'user_admin', ['user_member', 'user_other'], {
      memberTier: 3,
    });
  });
  const members = (clerk: string) =>
    db
      .asUser(clerk)
      .query<Record<string, unknown>>(`select * from public.get_group_members($1)`, [g]);

  it('returns public profiles, role and effective permissions only, admin first', async () => {
    const rows = await members('user_member');
    expect(rows).toEqual([
      {
        user_id: admin,
        name: 'Name of user_admin',
        handle: null,
        avatar_url: null,
        role: 'admin',
        can_invite: true,
        can_manage_members: true,
        can_edit_group: true,
        can_group_ping: true,
        joined_at: expect.any(Date) as Date,
        is_me: false,
      },
      {
        user_id: member,
        name: 'Name of user_member',
        handle: 'mem',
        avatar_url: 'https://img.example/m.png',
        role: 'member',
        ...{
          can_invite: true,
          can_manage_members: false,
          can_edit_group: false,
          can_group_ping: true,
        },
        joined_at: expect.any(Date) as Date,
        is_me: true,
      },
      expect.objectContaining({ user_id: other, is_me: false }),
    ]);
    // toEqual above pins the exact keys: no tier, timezone, clerk id, birth year or consent.
    expect(JSON.stringify(rows)).not.toContain('America/Jamaica');
  });

  it('is for members only', async () => {
    await expectPgError(members('user_outsider'), 'Group not found', 'P0002');
    await expectNoExecute(
      db.asAnon().query(`select * from public.get_group_members($1)`, [g]),
      'get_group_members',
    );
  });

  it('hides members blocked either way, with no placeholder; others still see both', async () => {
    await block(db, member, other);
    const ids = async (clerk: string) =>
      (await members(clerk)).map((r) => r.user_id as string).sort();
    // The blocker doesn't see the blocked member, and the blocked member doesn't see the blocker.
    expect(await ids('user_member')).toEqual([admin, member].sort());
    expect(await ids('user_other')).toEqual([admin, other].sort());
    // A third member sees everyone.
    expect(await ids('user_admin')).toEqual([admin, member, other].sort());
  });

  it('hides the admin from a member who blocked them (and vice versa)', async () => {
    await block(db, admin, member);
    expect((await members('user_member')).map((r) => r.user_id).sort()).toEqual(
      [member, other].sort(),
    );
    expect((await members('user_admin')).map((r) => r.user_id).sort()).toEqual(
      [admin, other].sort(),
    );
  });
});

describe('visibility inside groups', () => {
  it('the admin sees each member at exactly the tier that member chose (FR-SOC-10)', async () => {
    const t1 = await addUser(db, 'user_t1');
    const t2 = await addUser(db, 'user_t2');
    const t3 = await addUser(db, 'user_t3');
    const g = await groupWithMembers(db, 'user_admin', ['user_t1', 'user_t2', 'user_t3']);
    await setRule(db, t2, 'group', g, 2);
    await setRule(db, t3, 'group', g, 3);
    for (const u of [t1, t2, t3, admin]) await addProbeEvent(db, u);

    expect(await tierSeen(db, 'user_admin', t1)).toBe(1);
    expect(await tierSeen(db, 'user_admin', t2)).toBe(2);
    expect(await tierSeen(db, 'user_admin', t3)).toBe(3);
    // Exactly what a plain member sees too.
    expect(await tierSeen(db, 'user_t3', t1)).toBe(1);
    expect(await tierSeen(db, 'user_t1', t2)).toBe(2);
    expect(await tierSeen(db, 'user_t1', t3)).toBe(3);
    // And members see the admin at the admin's own choice (T1).
    expect(await tierSeen(db, 'user_t3', admin)).toBe(1);
  });

  it('an admin who is also a friend gets the friend tier, not more (D27)', async () => {
    await groupWithMembers(db, 'user_admin', ['user_member'], { memberTier: 3 });
    await addProbeEvent(db, member);
    await db.admin.query(
      `insert into public.friendships (user_a, user_b, status, requested_by)
       values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid), 'accepted', $1)`,
      [admin, member],
    );
    await db.admin.query(
      `insert into public.visibility_rules (owner_id, target_type, target_id, tier)
       values ($1, 'friend', $2, 1)`,
      [member, admin],
    );
    expect(await tierSeen(db, 'user_admin', member)).toBe(1);
  });

  it('a member can change their own tier for the group at any time (FR-VIS-2)', async () => {
    const g = await groupWithMembers(db, 'user_admin', ['user_member']);
    await addProbeEvent(db, member);
    expect(await tierSeen(db, 'user_admin', member)).toBe(1);
    await db
      .asUser('user_member')
      .query(
        `update public.visibility_rules set tier = 3 where target_type = 'group' and target_id = $1`,
        [g],
      );
    expect(await tierSeen(db, 'user_admin', member)).toBe(3);
    await db
      .asUser('user_member')
      .query(
        `update public.visibility_rules set tier = 2 where target_type = 'group' and target_id = $1`,
        [g],
      );
    expect(await tierSeen(db, 'user_admin', member)).toBe(2);
    // The admin can't change the member's rule.
    await db
      .asUser('user_admin')
      .query(`update public.visibility_rules set tier = 3 where owner_id = $1`, [member]);
    expect(await tierSeen(db, 'user_admin', member)).toBe(2);
  });
});

describe('clients still cannot write groups or members directly', () => {
  it('insert, update and delete on groups and group_members are denied', async () => {
    const g = await groupWithMembers(db, 'user_admin', ['user_member']);
    for (const sql of [
      `update public.groups set max_members = 999`,
      `update public.groups set admin_id = '${member}'`,
      `update public.group_members set role = 'admin'`,
      `insert into public.group_members (group_id, user_id) values ('${g}', '${outsider}')`,
      `delete from public.group_members`,
      `delete from public.groups`,
    ])
      await expect(db.asUser('user_admin').query(sql)).rejects.toThrow(/permission denied/);
  });
});

describe('locking: writers take the group row lock first', () => {
  it('update_group, transfer_group_admin', async () => {
    const g = await groupWithMembers(db, 'user_admin', ['user_member']);
    expect(
      await locksGroupRow(db, 'user_admin', g, `select public.update_group($1, 'X', null)`, [g]),
    ).toBe(true);
    expect(
      await locksGroupRow(db, 'user_admin', g, `select public.transfer_group_admin($1, $2)`, [
        g,
        member,
      ]),
    ).toBe(true);
  });

  it('the read-only get_group_members does not lock', async () => {
    const g = await groupWithMembers(db, 'user_admin', ['user_member']);
    expect(
      await locksGroupRow(db, 'user_admin', g, `select * from public.get_group_members($1)`, [g]),
    ).toBe(false);
  });
});
