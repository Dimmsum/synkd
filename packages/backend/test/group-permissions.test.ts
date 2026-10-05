// WF-044: group member permissions and removing members (FR-SOC-8,
// FR-SOC-9, J7, D26).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MEMBER_PERMISSIONS, GROUP_PERMISSIONS } from '@synkd/shared';
import type { GroupPermission } from '@synkd/shared';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import {
  addProbeEvent,
  createInvite,
  expectNoExecute,
  expectPgError,
  groupWithMembers,
  locksGroupRow,
  tierSeen,
} from './harness/groups';
import { addUser } from './harness/seed';

/** The function argument / column for each shared permission name. */
const COLUMN: Record<GroupPermission, string> = {
  invite: 'can_invite',
  manageMembers: 'can_manage_members',
  editGroup: 'can_edit_group',
  groupPing: 'can_group_ping',
};

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
  g = await groupWithMembers(db, 'user_admin', ['user_member', 'user_other'], { memberTier: 3 });
});

async function permissionsOf(userId: string): Promise<Record<string, unknown>> {
  const { rows } = await db.admin.query<Record<string, unknown>>(
    `select can_invite as invite, can_manage_members as "manageMembers",
            can_edit_group as "editGroup", can_group_ping as "groupPing"
     from public.group_members where group_id = $1 and user_id = $2`,
    [g, userId],
  );
  return rows[0] ?? {};
}

function setPermission(
  clerk: string,
  userId: string,
  permission: GroupPermission,
  value: boolean | null,
): Promise<unknown> {
  return db
    .asUser(clerk)
    .query(
      `select public.set_group_member_permissions(group_id => $1, user_id => $2, ${COLUMN[permission]} => $3)`,
      [g, userId, value],
    );
}

const remove = (clerk: string, userId: string) =>
  db.asUser(clerk).query(`select public.remove_group_member($1, $2)`, [g, userId]);

describe('defaults (D26)', () => {
  it('members who join get invite and groupPing, not manageMembers or editGroup', async () => {
    expect(await permissionsOf(member)).toEqual(DEFAULT_MEMBER_PERMISSIONS);
    expect(await permissionsOf(other)).toEqual(DEFAULT_MEMBER_PERMISSIONS);
  });
});

describe('set_group_member_permissions (admin only)', () => {
  it.each(GROUP_PERMISSIONS)('the admin can grant and revoke %s', async (permission) => {
    await setPermission('user_admin', member, permission, true);
    expect(await permissionsOf(member)).toMatchObject({ [permission]: true });
    await setPermission('user_admin', member, permission, false);
    expect(await permissionsOf(member)).toMatchObject({ [permission]: false });
    // Other members are untouched.
    expect(await permissionsOf(other)).toEqual(DEFAULT_MEMBER_PERMISSIONS);
  });

  it('a null (or omitted) argument leaves that permission unchanged', async () => {
    await db
      .asUser('user_admin')
      .query(`select public.set_group_member_permissions($1, $2, null, true, null, false)`, [
        g,
        member,
      ]);
    expect(await permissionsOf(member)).toEqual({
      invite: true,
      manageMembers: true,
      editGroup: false,
      groupPing: false,
    });
    await db
      .asUser('user_admin')
      .query(`select public.set_group_member_permissions($1, $2)`, [g, member]);
    expect(await permissionsOf(member)).toEqual({
      invite: true,
      manageMembers: true,
      editGroup: false,
      groupPing: false,
    });
  });

  it('a member cannot, even one holding every permission', async () => {
    for (const p of GROUP_PERMISSIONS) await setPermission('user_admin', member, p, true);
    for (const p of GROUP_PERMISSIONS)
      await expectPgError(setPermission('user_member', other, p, true), 'Not allowed', '42501');
    await expectPgError(
      setPermission('user_member', member, 'editGroup', false),
      'Not allowed',
      '42501',
    );
    expect(await permissionsOf(other)).toEqual(DEFAULT_MEMBER_PERMISSIONS);
  });

  it("the admin's own permissions can't be changed: they always hold every one (FR-SOC-9)", async () => {
    await expectPgError(
      setPermission('user_admin', admin, 'invite', false),
      'The admin always holds every permission',
      '22023',
    );
  });

  it('rejects non-members as target or caller; anon cannot call it', async () => {
    const outsider = (
      await db.admin.query<{ id: string }>(
        `select id from public.users where clerk_id = 'user_outsider'`,
      )
    ).rows[0]?.id;
    await expectPgError(
      setPermission('user_admin', outsider ?? '', 'invite', true),
      'Member not found',
      'P0002',
    );
    await expectPgError(
      setPermission('user_outsider', member, 'invite', true),
      'Group not found',
      'P0002',
    );
    await expectNoExecute(
      db.asAnon().query(`select public.set_group_member_permissions($1, $2, true)`, [g, member]),
      'set_group_member_permissions',
    );
  });

  it('taking invite away revokes that member’s links, and they can no longer create one', async () => {
    const link = await createInvite(db, 'user_member', g);
    const adminLink = await createInvite(db, 'user_admin', g);
    await setPermission('user_admin', member, 'invite', false);
    const { rows } = await db.admin.query(
      `select id, revoked from public.invites where id in ($1, $2) order by id = $1 desc`,
      [link.id, adminLink.id],
    );
    expect(rows).toEqual([
      { id: link.id, revoked: true },
      { id: adminLink.id, revoked: false },
    ]);
    await expectPgError(createInvite(db, 'user_member', g), 'Not allowed', '42501');
    // Giving it back doesn't revive old links.
    await setPermission('user_admin', member, 'invite', true);
    const summary = await db
      .asAnon()
      .query(`select status from public.get_invite_summary($1)`, [link.code]);
    expect(summary).toEqual([{ status: 'revoked' }]);
  });

  it('granted permissions take effect: editGroup lets a member rename the group', async () => {
    await setPermission('user_admin', member, 'editGroup', true);
    await db.asUser('user_member').query(`select public.update_group($1, 'Renamed', null)`, [g]);
    await setPermission('user_admin', member, 'editGroup', false);
    await expectPgError(
      db.asUser('user_member').query(`select public.update_group($1, 'Again', null)`, [g]),
      'Not allowed',
    );
  });

  it('groupPing is stored for group pings (WF-096) and reported by list_my_groups', async () => {
    await setPermission('user_admin', member, 'groupPing', false);
    const [row] = await db
      .asUser('user_member')
      .query(`select can_group_ping from public.list_my_groups()`);
    expect(row).toEqual({ can_group_ping: false });
  });
});

describe('the admin always holds every permission, whatever the columns say (FR-SOC-9)', () => {
  beforeEach(async () => {
    await db.admin.query(
      `update public.group_members set can_invite = false, can_manage_members = false,
         can_edit_group = false, can_group_ping = false where user_id = $1`,
      [admin],
    );
  });

  it('can still edit, invite, list invites, manage permissions and remove members', async () => {
    await db.asUser('user_admin').query(`select public.update_group($1, 'Still mine', null)`, [g]);
    await createInvite(db, 'user_admin', g);
    await db.asUser('user_admin').query(`select * from public.list_group_invites($1)`, [g]);
    await setPermission('user_admin', member, 'manageMembers', true);
    await remove('user_admin', other);
    expect(await permissionsOf(other)).toEqual({});
  });
});

describe('remove_group_member (admin or manageMembers)', () => {
  it('the admin removes a member; visibility ends at once, both ways', async () => {
    await addProbeEvent(db, member);
    await addProbeEvent(db, other);
    expect(await tierSeen(db, 'user_other', member)).toBe(3);
    const link = await createInvite(db, 'user_member', g);

    await remove('user_admin', member);

    expect(await permissionsOf(member)).toEqual({});
    expect(await tierSeen(db, 'user_other', member)).toBe(null);
    expect(await tierSeen(db, 'user_member', other)).toBe(null);
    expect(await tierSeen(db, 'user_admin', member)).toBe(null);
    const { rows } = await db.admin.query(
      `select 1 from public.visibility_rules where owner_id = $1 and target_id = $2`,
      [member, g],
    );
    expect(rows).toEqual([]);
    // Their links are revoked, and they can no longer read the group.
    const s = await db
      .asAnon()
      .query(`select status from public.get_invite_summary($1)`, [link.code]);
    expect(s).toEqual([{ status: 'revoked' }]);
    await expectPgError(
      db.asUser('user_member').query(`select * from public.get_group_members($1)`, [g]),
      'Group not found',
    );
  });

  it('a member with manageMembers can remove another member, but never the admin', async () => {
    await setPermission('user_admin', member, 'manageMembers', true);
    await expectPgError(
      remove('user_member', admin),
      "The admin can't be removed from the group",
      'P0001',
    );
    await remove('user_member', other);
    expect(await permissionsOf(other)).toEqual({});
  });

  it('a member without manageMembers cannot remove anyone', async () => {
    await expectPgError(remove('user_member', other), 'Not allowed', '42501');
    expect(await permissionsOf(other)).toEqual(DEFAULT_MEMBER_PERMISSIONS);
  });

  it('rejects removing yourself (leave instead) or a non-member; non-members and anon are denied', async () => {
    await expectPgError(remove('user_admin', admin), 'Use leave_group to leave a group', '22023');
    await setPermission('user_admin', member, 'manageMembers', true);
    await expectPgError(remove('user_member', member), 'Use leave_group to leave a group');
    await expectPgError(
      remove('user_admin', '00000000-0000-4000-8000-000000000000'),
      'Member not found',
      'P0002',
    );
    await expectPgError(remove('user_outsider', member), 'Group not found', 'P0002');
    await expectNoExecute(
      db.asAnon().query(`select public.remove_group_member($1, $2)`, [g, member]),
      'remove_group_member',
    );
  });
});

describe('locking: both writers take the group row lock first', () => {
  it('set_group_member_permissions and remove_group_member', async () => {
    expect(
      await locksGroupRow(
        db,
        'user_admin',
        g,
        `select public.set_group_member_permissions($1, $2, false)`,
        [g, member],
      ),
    ).toBe(true);
    expect(
      await locksGroupRow(db, 'user_admin', g, `select public.remove_group_member($1, $2)`, [
        g,
        member,
      ]),
    ).toBe(true);
  });
});
