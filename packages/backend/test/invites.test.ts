// WF-045: invite links, the public invite summary and join_group
// (FR-SOC-3, FR-SOC-5, FR-SOC-11, FR-SOC-13, FR-WEB-3, FR-VIS-1, D20, D26,
// NFR-SCALE-4, PRD §8.5).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MEMBER_PERMISSIONS } from '@whosfree/shared';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import {
  addProbeEvent,
  createGroup,
  createInvite,
  expectNoExecute,
  expectPgError,
  join,
  locksGroupRow,
  tierSeen,
} from './harness/groups';
import type { GroupInviteRow } from './harness/groups';
import { addUser, block } from './harness/seed';

const CODE = /^[A-Za-z0-9_-]{22}$/;
const MISSING = '00000000-0000-4000-8000-000000000000';

let db: TestDb;
let admin: string;
let member: string;
let joiner: string;
let g: string;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.reset();
  admin = await addUser(db, 'user_admin');
  member = await addUser(db, 'user_member');
  joiner = await addUser(db, 'user_joiner');
  await addUser(db, 'user_outsider');
  g = await createGroup(db, 'user_admin', { name: 'Flat 4', emoji: '🏠' });
  const { code } = await createInvite(db, 'user_admin', g);
  await join(db, 'user_member', code);
});

async function membersOf(groupId: string): Promise<string[]> {
  const { rows } = await db.admin.query<{ user_id: string }>(
    `select user_id from public.group_members where group_id = $1 order by user_id`,
    [groupId],
  );
  return rows.map((r) => r.user_id);
}

async function inviteRow(id: string): Promise<Record<string, unknown>> {
  const { rows } = await db.admin.query<Record<string, unknown>>(
    `select revoked, uses, max_uses, expires_at, inviter_id, group_id from public.invites where id = $1`,
    [id],
  );
  return rows[0] ?? {};
}

function summary(code: string, as: 'anon' | string = 'anon'): Promise<Record<string, unknown>[]> {
  const session = as === 'anon' ? db.asAnon() : db.asUser(as);
  return session.query(`select * from public.get_invite_summary($1)`, [code]);
}

/** Fills the group with fake members (as the superuser) until it has `count` members. */
async function fillGroup(groupId: string, count: number): Promise<void> {
  const current = (await membersOf(groupId)).length;
  for (let i = current; i < count; i++) {
    const u = await addUser(db, `user_filler_${i}`);
    await db.admin.query(`insert into public.group_members (group_id, user_id) values ($1, $2)`, [
      groupId,
      u,
    ]);
  }
}

describe('invite codes', () => {
  it('are 22-character base64url strings (128 random bits), all different', async () => {
    const { rows } = await db.admin.query<{ code: string }>(
      `select private.new_invite_code() as code from generate_series(1, 500)`,
    );
    const codes = rows.map((r) => r.code);
    for (const c of codes) expect(c).toMatch(CODE);
    expect(new Set(codes).size).toBe(codes.length);
    // Every position varies (no fixed UUID version/variant characters leak through),
    // and all 64 symbols of the alphabet turn up.
    for (let i = 0; i < 22; i++) expect(new Set(codes.map((c) => c[i])).size).toBeGreaterThan(1);
    expect(new Set(codes.join('')).size).toBe(64);
  });

  it('the table rejects a code that is not in that format, and duplicates', async () => {
    const insert = (code: string) =>
      db.admin.query(
        `insert into public.invites (code, group_id, inviter_id) values ($1, $2, $3)`,
        [code, g, admin],
      );
    await expect(insert('short')).rejects.toThrow(/invites_code_check/);
    await insert('A'.repeat(22));
    await expect(insert('A'.repeat(22))).rejects.toThrow(/invites_code_key/);
  });

  it('every invite belongs to a group until friend invites exist', async () => {
    await expect(
      db.admin.query(`insert into public.invites (code, inviter_id) values ($1, $2)`, [
        'B'.repeat(22),
        admin,
      ]),
    ).rejects.toThrow(/invites_group_required/);
  });

  it('clients cannot read or write the invites table directly', async () => {
    for (const as of [db.asUser('user_admin'), db.asAnon()]) {
      await expect(as.query(`select * from public.invites`)).rejects.toThrow(
        /permission denied for table invites/,
      );
      await expect(as.query(`update public.invites set uses = 0`)).rejects.toThrow(
        /permission denied for table invites/,
      );
    }
  });
});

describe('create_group_invite (admin or invite)', () => {
  it('the admin creates a link with optional expiry and max uses', async () => {
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const inv = await createInvite(db, 'user_admin', g, { expiresAt, maxUses: 5 });
    expect(inv).toEqual({
      id: expect.any(String) as string,
      code: expect.stringMatching(CODE) as string,
      expires_at: new Date(expiresAt),
      max_uses: 5,
      uses: 0,
      created_at: expect.any(Date) as Date,
      created_by_me: true,
    });
    expect(await inviteRow(inv.id)).toMatchObject({ inviter_id: admin, group_id: g });
  });

  it('a member with the default invite permission can; without it they cannot', async () => {
    const inv = await createInvite(db, 'user_member', g);
    expect(await inviteRow(inv.id)).toMatchObject({ inviter_id: member });
    await db.admin.query(`update public.group_members set can_invite = false where user_id = $1`, [
      member,
    ]);
    await expectPgError(createInvite(db, 'user_member', g), 'Not allowed', '42501');
  });

  it('the admin can even if their stored invite column is false (FR-SOC-9)', async () => {
    await db.admin.query(`update public.group_members set can_invite = false where user_id = $1`, [
      admin,
    ]);
    await createInvite(db, 'user_admin', g);
  });

  it('a non-member gets "Group not found"; anon cannot call it', async () => {
    await expectPgError(createInvite(db, 'user_outsider', g), 'Group not found', 'P0002');
    await expectPgError(createInvite(db, 'user_admin', MISSING), 'Group not found', 'P0002');
    await expectNoExecute(
      db.asAnon().query(`select * from public.create_group_invite($1)`, [g]),
      'create_group_invite',
    );
  });

  it('rejects an expiry in the past and max uses outside 1–1000', async () => {
    await expectPgError(
      createInvite(db, 'user_admin', g, { expiresAt: '2020-01-01T00:00:00Z' }),
      'Invite expiry must be in the future',
      '22023',
    );
    for (const maxUses of [0, -1, 1001])
      await expectPgError(
        createInvite(db, 'user_admin', g, { maxUses }),
        'Invite max uses must be between 1 and 1000',
        '22023',
      );
  });
});

describe('revoke_group_invite and regenerate_group_invite', () => {
  let adminInvite: GroupInviteRow;
  let memberInvite: GroupInviteRow;
  beforeEach(async () => {
    await join(db, 'user_joiner', (await createInvite(db, 'user_admin', g)).code);
    adminInvite = await createInvite(db, 'user_admin', g, { maxUses: 3 });
    memberInvite = await createInvite(db, 'user_member', g);
  });
  const revoke = (clerk: string, id: string) =>
    db.asUser(clerk).query(`select public.revoke_group_invite($1)`, [id]);
  const regenerate = async (clerk: string, id: string) =>
    (
      await db
        .asUser(clerk)
        .query<GroupInviteRow & Record<string, unknown>>(
          `select * from public.regenerate_group_invite($1)`,
          [id],
        )
    )[0];

  it("the admin can revoke anyone's invite; revoking twice is fine", async () => {
    await revoke('user_admin', memberInvite.id);
    await revoke('user_admin', memberInvite.id);
    expect(await inviteRow(memberInvite.id)).toMatchObject({ revoked: true });
  });

  it('a member can revoke their own invite but not anyone else’s', async () => {
    await expectPgError(revoke('user_joiner', memberInvite.id), 'Not allowed', '42501');
    await expectPgError(revoke('user_member', adminInvite.id), 'Not allowed', '42501');
    await revoke('user_member', memberInvite.id);
    expect(await inviteRow(memberInvite.id)).toMatchObject({ revoked: true });
    expect(await inviteRow(adminInvite.id)).toMatchObject({ revoked: false });
  });

  it('a member who lost the invite permission cannot revoke or regenerate even their own', async () => {
    await db.admin.query(`update public.group_members set can_invite = false where user_id = $1`, [
      member,
    ]);
    await expectPgError(revoke('user_member', memberInvite.id), 'Not allowed', '42501');
    await expectPgError(regenerate('user_member', memberInvite.id), 'Not allowed', '42501');
  });

  it('non-members and unknown ids get "Invite not found"; anon cannot call either', async () => {
    await expectPgError(revoke('user_outsider', adminInvite.id), 'Invite not found', 'P0002');
    await expectPgError(revoke('user_admin', MISSING), 'Invite not found', 'P0002');
    await expectPgError(regenerate('user_outsider', adminInvite.id), 'Invite not found', 'P0002');
    await expectNoExecute(
      db.asAnon().query(`select public.revoke_group_invite($1)`, [adminInvite.id]),
      'revoke_group_invite',
    );
    await expectNoExecute(
      db.asAnon().query(`select * from public.regenerate_group_invite($1)`, [adminInvite.id]),
      'regenerate_group_invite',
    );
    expect(await inviteRow(adminInvite.id)).toMatchObject({ revoked: false });
  });

  it('a revoked link cannot be used to join', async () => {
    await revoke('user_admin', adminInvite.id);
    await addUser(db, 'user_late');
    await expectPgError(join(db, 'user_late', adminInvite.code), 'This invite has been revoked');
  });

  it('regenerate revokes the old code and issues a new one with the same limits', async () => {
    const expiresAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const week = await createInvite(db, 'user_admin', g, { expiresAt, maxUses: 3 });
    await db.admin.query(
      `update public.invites set uses = 2, created_at = now() - interval '5 days' where id = $1`,
      [week.id],
    );
    const fresh = await regenerate('user_admin', week.id);
    expect(fresh?.code).toMatch(CODE);
    expect(fresh?.code).not.toBe(week.code);
    expect(fresh).toMatchObject({ uses: 0, max_uses: 3, created_by_me: true });
    // Same validity period (7 days), starting now.
    const period = (fresh?.expires_at?.getTime() ?? 0) - (fresh?.created_at.getTime() ?? 0);
    expect(Math.abs(period - 7 * 86_400_000)).toBeLessThan(5_000);
    expect(await inviteRow(week.id)).toMatchObject({ revoked: true });
    await addUser(db, 'user_late');
    await expectPgError(join(db, 'user_late', week.code), 'This invite has been revoked');
    await join(db, 'user_late', fresh?.code ?? '');
  });

  it('regenerating a link with no expiry gives a link with no expiry; members may regenerate their own', async () => {
    const fresh = await regenerate('user_member', memberInvite.id);
    expect(fresh).toMatchObject({ expires_at: null, max_uses: null, created_by_me: true });
    await expectPgError(regenerate('user_member', adminInvite.id), 'Not allowed', '42501');
  });
});

describe('list_group_invites (admin or invite)', () => {
  it('lists active links only (a full group’s links included), newest first', async () => {
    const active = await createInvite(db, 'user_admin', g);
    const mine = await createInvite(db, 'user_member', g);
    const revoked = await createInvite(db, 'user_admin', g);
    await db.asUser('user_admin').query(`select public.revoke_group_invite($1)`, [revoked.id]);
    const expired = await createInvite(db, 'user_admin', g, {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await db.admin.query(
      `update public.invites set expires_at = now() - interval '1 second'
      where id = $1`,
      [expired.id],
    );
    const usedUp = await createInvite(db, 'user_admin', g, { maxUses: 1 });
    await join(db, 'user_joiner', usedUp.code);

    const list = async (clerk: string) =>
      db
        .asUser(clerk)
        .query<GroupInviteRow & Record<string, unknown>>(
          `select * from public.list_group_invites($1)`,
          [g],
        );
    const ids = (await list('user_admin')).map((r) => r.id);
    expect(ids).toContain(active.id);
    expect(ids).toContain(mine.id);
    for (const dead of [revoked, expired, usedUp]) expect(ids).not.toContain(dead.id);

    const asMember = await list('user_member');
    expect(asMember.find((r) => r.id === mine.id)?.created_by_me).toBe(true);
    expect(asMember.find((r) => r.id === active.id)?.created_by_me).toBe(false);

    await fillGroup(g, 20);
    expect((await list('user_admin')).map((r) => r.id)).toContain(active.id);
  });

  it('a member without invite, a non-member and anon cannot list', async () => {
    await db.admin.query(`update public.group_members set can_invite = false where user_id = $1`, [
      member,
    ]);
    await expectPgError(
      db.asUser('user_member').query(`select * from public.list_group_invites($1)`, [g]),
      'Not allowed',
      '42501',
    );
    await expectPgError(
      db.asUser('user_outsider').query(`select * from public.list_group_invites($1)`, [g]),
      'Group not found',
      'P0002',
    );
    await expectNoExecute(
      db.asAnon().query(`select * from public.list_group_invites($1)`, [g]),
      'list_group_invites',
    );
  });
});

describe('get_invite_summary (public, for /i/[code])', () => {
  let inv: GroupInviteRow;
  beforeEach(async () => {
    await db.admin.query(`update public.users set handle = 'aaliyah' where id = $1`, [admin]);
    inv = await createInvite(db, 'user_admin', g, { maxUses: 10 });
  });

  it('works signed out and returns only the inviter name, group name, emoji and member count', async () => {
    const rows = await summary(inv.code);
    expect(rows).toEqual([
      {
        status: 'valid',
        inviter_name: 'Name of user_admin',
        group_name: 'Flat 4',
        group_emoji: '🏠',
        member_count: 2,
      },
    ]);
    // Nothing else leaks: no ids, handles, member names, codes or limits.
    const payload = JSON.stringify(rows);
    for (const secret of [admin, member, g, inv.id, 'aaliyah', 'Name of user_member', '10'])
      expect(payload).not.toContain(secret);
    // A signed-in caller gets exactly the same.
    expect(await summary(inv.code, 'user_outsider')).toEqual(rows);
  });

  it('has exactly these output columns', async () => {
    const { rows } = await db.admin.query<{ name: string }>(
      `select unnest(proargnames) as name from pg_proc
       where oid = 'public.get_invite_summary(text)'::regprocedure`,
    );
    expect(rows.map((r) => r.name)).toEqual([
      'code',
      'status',
      'inviter_name',
      'group_name',
      'group_emoji',
      'member_count',
    ]);
  });

  it('says "full" (with the details) when the group is at its cap', async () => {
    await fillGroup(g, 20);
    expect(await summary(inv.code)).toEqual([
      expect.objectContaining({ status: 'full', group_name: 'Flat 4', member_count: 20 }),
    ]);
  });

  it('a dead link reports only its status: revoked, expired or used up', async () => {
    const dead = { status: expect.any(String) as string, inviter_name: null, group_name: null };
    const blank = { group_emoji: null, member_count: null };

    await db.admin.query(`update public.invites set uses = max_uses where id = $1`, [inv.id]);
    expect(await summary(inv.code)).toEqual([{ ...dead, ...blank, status: 'used_up' }]);

    await db.admin.query(
      `update public.invites set uses = 0, expires_at = now() - interval '1 minute' where id = $1`,
      [inv.id],
    );
    expect(await summary(inv.code)).toEqual([{ ...dead, ...blank, status: 'expired' }]);

    await db.asUser('user_admin').query(`select public.revoke_group_invite($1)`, [inv.id]);
    expect(await summary(inv.code)).toEqual([{ ...dead, ...blank, status: 'revoked' }]);
  });

  it('unknown and malformed codes return no rows, the same generic "not found"', async () => {
    for (const code of ['A'.repeat(22), 'nope', '', inv.code.toLowerCase() + 'x', `' or 1=1 --`])
      expect(await summary(code)).toEqual([]);
    expect(await db.asAnon().query(`select * from public.get_invite_summary(null)`)).toEqual([]);
  });

  it('the service role is not granted it (the server renders the page with the anon key)', async () => {
    await expectNoExecute(
      db.asService().query(`select * from public.get_invite_summary($1)`, [inv.code]),
      'get_invite_summary',
    );
  });
});

describe('join_group', () => {
  let inv: GroupInviteRow;
  beforeEach(async () => {
    inv = await createInvite(db, 'user_admin', g);
  });

  it('adds the caller with the D26 defaults and the chosen tier, and counts the use', async () => {
    const joined = await join(db, 'user_joiner', inv.code, 2);
    expect(joined).toBe(g);
    const { rows } = await db.admin.query(
      `select role, can_invite as invite, can_manage_members as "manageMembers",
              can_edit_group as "editGroup", can_group_ping as "groupPing"
       from public.group_members where group_id = $1 and user_id = $2`,
      [g, joiner],
    );
    expect(rows).toEqual([{ role: 'member', ...DEFAULT_MEMBER_PERMISSIONS }]);
    const rule = await db.admin.query(
      `select tier from public.visibility_rules
       where owner_id = $1 and target_type = 'group' and target_id = $2`,
      [joiner, g],
    );
    expect(rule.rows).toEqual([{ tier: 2 }]);
    expect(await inviteRow(inv.id)).toMatchObject({ uses: 1 });
    // Visible to the group at the chosen tier straight away.
    await addProbeEvent(db, joiner);
    expect(await tierSeen(db, 'user_member', joiner)).toBe(2);
    // The admin sees exactly the same tier (FR-SOC-10).
    expect(await tierSeen(db, 'user_admin', joiner)).toBe(2);
  });

  it('defaults to T1 (D20) and rejects any other tier', async () => {
    await db.asUser('user_joiner').query(`select public.join_group($1)`, [inv.code]);
    const { rows } = await db.admin.query(
      `select tier from public.visibility_rules where owner_id = $1`,
      [joiner],
    );
    expect(rows).toEqual([{ tier: 1 }]);
    await addUser(db, 'user_late');
    for (const tier of [0, 4, null])
      await expectPgError(
        db.asUser('user_late').query(`select public.join_group($1, $2)`, [inv.code, tier]),
        'Tier must be 1, 2 or 3',
        '22023',
      );
  });

  it('does not make the joiner friends with anyone (FR-SOC-5)', async () => {
    await join(db, 'user_joiner', inv.code, 3);
    const { rows } = await db.admin.query(`select 1 from public.friendships`);
    expect(rows).toEqual([]);
  });

  it('rejects unknown codes, anon and users without a users row', async () => {
    await expectPgError(join(db, 'user_joiner', 'A'.repeat(22)), 'Invite not found', 'P0002');
    await expectPgError(join(db, 'user_joiner', 'bad code'), 'Invite not found', 'P0002');
    await expectNoExecute(
      db.asAnon().query(`select public.join_group($1)`, [inv.code]),
      'join_group',
    );
    await expectPgError(join(db, 'user_nobody', inv.code), 'Not signed in', '42501');
  });

  it('rejects someone who is already a member, giving the group id in the detail', async () => {
    const error = await join(db, 'user_member', inv.code).catch((e: unknown) => e);
    expect(error).toMatchObject({
      message: 'You are already a member of this group',
      code: 'P0001',
      detail: g,
    });
    expect(await inviteRow(inv.id)).toMatchObject({ uses: 0 });
  });

  it('rejects an expired invite', async () => {
    const soon = await createInvite(db, 'user_admin', g, {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await db.admin.query(
      `update public.invites set expires_at = now() - interval '1 second' where id = $1`,
      [soon.id],
    );
    await expectPgError(join(db, 'user_joiner', soon.code), 'This invite has expired', 'P0001');
  });

  it('enforces max uses', async () => {
    const twice = await createInvite(db, 'user_admin', g, { maxUses: 2 });
    await join(db, 'user_joiner', twice.code);
    await addUser(db, 'user_second');
    await addUser(db, 'user_third');
    await join(db, 'user_second', twice.code);
    await expectPgError(
      join(db, 'user_third', twice.code),
      'This invite has reached its maximum number of uses',
      'P0001',
    );
    expect(await inviteRow(twice.id)).toMatchObject({ uses: 2 });
  });

  it('rejects a link whose inviter lost the invite permission, even if not flagged revoked', async () => {
    const memberInvite = await createInvite(db, 'user_member', g);
    // Change the column directly, without flagging the invite, to test the live check.
    await db.admin.query(`update public.group_members set can_invite = false where user_id = $1`, [
      member,
    ]);
    await expectPgError(join(db, 'user_joiner', memberInvite.code), 'This invite has been revoked');
  });

  describe('the member cap (FR-SOC-11, NFR-SCALE-4)', () => {
    it('the 20th member can join; the 21st gets "This group is full" and nothing changes', async () => {
      await fillGroup(g, 19);
      await join(db, 'user_joiner', inv.code, 3);
      expect(await membersOf(g)).toHaveLength(20);
      await addUser(db, 'user_late');
      await expectPgError(join(db, 'user_late', inv.code), 'This group is full', 'P0001');
      expect(await membersOf(g)).toHaveLength(20);
      const late = (
        await db.admin.query(`select id from public.users where clerk_id = 'user_late'`)
      ).rows[0] as { id: string };
      const { rows } = await db.admin.query(
        `select 1 from public.visibility_rules where owner_id = $1`,
        [late.id],
      );
      expect(rows).toEqual([]);
      expect(await inviteRow(inv.id)).toMatchObject({ uses: 1 });
    });

    it('two joins racing for the last place: the second is refused', async () => {
      // PGlite has a single connection, so two transactions can't really
      // overlap here. This runs them back to back at 19/20; the next test
      // proves join_group holds the group row lock that serialises them on
      // real Postgres.
      await fillGroup(g, 19);
      const a = await addUser(db, 'user_racer_a');
      await addUser(db, 'user_racer_b');
      const results = await Promise.allSettled([
        join(db, 'user_racer_a', inv.code),
        join(db, 'user_racer_b', inv.code),
      ]);
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
      expect((results[1] as PromiseRejectedResult).reason).toMatchObject({
        message: 'This group is full',
      });
      expect(await membersOf(g)).toContain(a);
      expect(await membersOf(g)).toHaveLength(20);
    });

    it('the cap follows groups.max_members, so it can be raised without a schema change', async () => {
      await db.admin.query(`update public.groups set max_members = 2 where id = $1`, [g]);
      await expectPgError(join(db, 'user_joiner', inv.code), 'This group is full');
      await db.admin.query(`update public.groups set max_members = 25 where id = $1`, [g]);
      await fillGroup(g, 24);
      await join(db, 'user_joiner', inv.code);
      expect(await membersOf(g)).toHaveLength(25);
    });
  });

  it('refuses approval-mode groups as not supported yet, creating no member row (FR-SOC-13)', async () => {
    await db.admin.query(`update public.groups set join_mode = 'approval' where id = $1`, [g]);
    await expectPgError(
      join(db, 'user_joiner', inv.code),
      'Joining groups that need approval is not supported yet',
      '0A000',
    );
    expect(await membersOf(g)).not.toContain(joiner);
    expect(await inviteRow(inv.id)).toMatchObject({ uses: 0 });
  });

  it('replaces a leftover rule for the group with the newly chosen tier', async () => {
    await db.admin.query(
      `insert into public.visibility_rules (owner_id, target_type, target_id, tier)
       values ($1, 'group', $2, 3)`,
      [joiner, g],
    );
    await join(db, 'user_joiner', inv.code, 1);
    const { rows } = await db.admin.query(
      `select tier from public.visibility_rules where owner_id = $1`,
      [joiner],
    );
    expect(rows).toEqual([{ tier: 1 }]);
  });

  describe('blocks (FR-SOC-6)', () => {
    it('a blocked user can still join (refusing would reveal the block), but sees nothing of the blocker', async () => {
      await block(db, member, joiner);
      await addProbeEvent(db, member);
      await addProbeEvent(db, joiner);
      await join(db, 'user_joiner', inv.code, 3);
      // Neither sees the other's schedule, whatever tiers they chose.
      expect(await tierSeen(db, 'user_joiner', member)).toBe(null);
      expect(await tierSeen(db, 'user_member', joiner)).toBe(null);
      // Nor each other in the member list.
      const ids = async (clerk: string) =>
        (
          await db
            .asUser(clerk)
            .query<{ user_id: string }>(`select user_id from public.get_group_members($1)`, [g])
        ).map((r) => r.user_id);
      expect(await ids('user_joiner')).not.toContain(member);
      expect(await ids('user_member')).not.toContain(joiner);
      // The admin sees both, at their chosen tiers.
      expect(await tierSeen(db, 'user_admin', joiner)).toBe(3);
    });

    it('someone who blocked a member can join too, with the same result', async () => {
      await block(db, joiner, member);
      await join(db, 'user_joiner', inv.code);
      await addProbeEvent(db, member);
      expect(await tierSeen(db, 'user_joiner', member)).toBe(null);
    });
  });
});

describe('locking: every invite writer takes the group row lock (the cap and uses rely on it)', () => {
  const locks = (clerk: string, sql: string, params: unknown[]) =>
    locksGroupRow(db, clerk, g, sql, params);

  it('join_group', async () => {
    const { code } = await createInvite(db, 'user_admin', g);
    expect(await locks('user_joiner', `select public.join_group($1, 1)`, [code])).toBe(true);
  });

  it('create_group_invite', async () => {
    expect(await locks('user_member', `select * from public.create_group_invite($1)`, [g])).toBe(
      true,
    );
  });

  it('revoke_group_invite and regenerate_group_invite', async () => {
    const a = await createInvite(db, 'user_admin', g);
    expect(await locks('user_admin', `select public.revoke_group_invite($1)`, [a.id])).toBe(true);
    expect(
      await locks('user_admin', `select * from public.regenerate_group_invite($1)`, [a.id]),
    ).toBe(true);
  });

  it('the read-only list_group_invites and get_invite_summary do not lock', async () => {
    const a = await createInvite(db, 'user_admin', g);
    expect(await locks('user_admin', `select * from public.list_group_invites($1)`, [g])).toBe(
      false,
    );
    expect(await locks('user_admin', `select * from public.get_invite_summary($1)`, [a.code])).toBe(
      false,
    );
  });
});

describe('delete_group', () => {
  it("deletes the group's invites with it; their codes then read as not found", async () => {
    const inv = await createInvite(db, 'user_admin', g);
    await db.asUser('user_admin').query(`select public.delete_group($1)`, [g]);
    const { rows } = await db.admin.query(`select 1 from public.invites where group_id = $1`, [g]);
    expect(rows).toEqual([]);
    expect(await summary(inv.code)).toEqual([]);
    await expectPgError(join(db, 'user_joiner', inv.code), 'Invite not found', 'P0002');
  });
});
