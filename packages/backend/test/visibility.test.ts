// WF-041: visibility tiers and redaction. A viewer must never receive a field
// above their tier (PRD §6.7, FR-VIS-3, FR-VIS-4, FR-VIS-5, FR-VIS-6,
// FR-SOC-5, FR-SOC-6, FR-SOC-10, D1, D20, D27, D35, D41).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TIER_VISIBLE_EVENT_FIELDS } from '@synkd/shared';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import {
  addEvent,
  addGroup,
  addSource,
  addUser,
  befriend,
  block,
  joinGroup,
  setRule,
} from './harness/seed';

type Tier = 1 | 2 | 3;

interface ViewerRow {
  id: string;
  starts_at: Date;
  ends_at: Date;
  rrule: string | null;
  exdates: Date[];
  category: string | null;
  title: string | null;
}

const RANGE = ['2026-10-05T00:00:00Z', '2026-10-06T00:00:00Z'] as const;
const LECTURE = { title: 'COMP2140 Lecture', category: 'class' };
const THERAPY = { title: 'Therapy at the clinic', category: 'meeting' };
const SECRETS = [LECTURE.title, THERAPY.title, 'Free block title'];

let db: TestDb;
let owner: string;
let viewer: string;
let other: string;
let lectureId: string;
let therapyId: string;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.close());

beforeEach(async () => {
  await db.reset();
  owner = await addUser(db, 'user_owner');
  viewer = await addUser(db, 'user_viewer');
  other = await addUser(db, 'user_other');
  const source = await addSource(db, owner);
  lectureId = await addEvent(db, owner, source, {
    ...LECTURE,
    startsAt: '2026-10-05T14:00:00Z',
    endsAt: '2026-10-05T16:00:00Z',
  });
  therapyId = await addEvent(db, owner, source, {
    ...THERAPY,
    isPrivate: true,
    startsAt: '2026-10-05T17:00:00Z',
    endsAt: '2026-10-05T18:00:00Z',
  });
  // Not busy: never shown to anyone through events_for_viewer.
  await addEvent(db, owner, source, {
    title: 'Free block title',
    category: 'other',
    busy: false,
    startsAt: '2026-10-05T19:00:00Z',
    endsAt: '2026-10-05T20:00:00Z',
  });
});

function eventsFor(clerkId: string, ownerId: string): Promise<ViewerRow[]> {
  return db
    .asUser(clerkId)
    .query<ViewerRow & Record<string, unknown>>(
      `select * from public.events_for_viewer($1, $2, $3)`,
      [ownerId, ...RANGE],
    );
}

/**
 * Asserts the viewer gets exactly what `tier` allows of the owner's events:
 * busy times always, category from T2, title from T3, nothing of the private
 * event beyond its times, and nothing at all for `null` (no access).
 */
async function expectAccess(clerkId: string, tier: Tier | null): Promise<void> {
  const rows = await eventsFor(clerkId, owner);
  if (tier === null) {
    expect(rows).toEqual([]);
    return;
  }
  const visible: readonly string[] = TIER_VISIBLE_EVENT_FIELDS[tier];
  expect(rows).toEqual([
    {
      id: lectureId,
      starts_at: new Date('2026-10-05T14:00:00Z'),
      ends_at: new Date('2026-10-05T16:00:00Z'),
      rrule: null,
      exdates: [],
      category: visible.includes('category') ? LECTURE.category : null,
      title: visible.includes('title') ? LECTURE.title : null,
    },
    {
      id: therapyId,
      starts_at: new Date('2026-10-05T17:00:00Z'),
      ends_at: new Date('2026-10-05T18:00:00Z'),
      rrule: null,
      exdates: [],
      category: null,
      title: null,
    },
  ]);
  // Belt and braces: nothing above the tier appears anywhere in the payload.
  const payload = JSON.stringify(rows);
  if (tier < 3) for (const s of SECRETS) expect(payload).not.toContain(s);
  if (tier < 2) expect(payload).not.toContain(LECTURE.category);
  expect(payload).not.toContain(THERAPY.title);
  expect(payload).not.toContain(THERAPY.category);
}

describe('friends (FR-VIS-1, FR-VIS-3)', () => {
  it.each([1, 2, 3] as const)('an accepted friend with a T%i rule gets exactly T%i', async (t) => {
    await befriend(db, owner, viewer);
    await setRule(db, owner, 'friend', viewer, t);
    await expectAccess('user_viewer', t);
  });

  it('an accepted friend without a rule gets T1 (the minimum, D20)', async () => {
    await befriend(db, viewer, owner);
    await expectAccess('user_viewer', 1);
  });

  it('a pending request grants nothing, whoever sent it', async () => {
    await befriend(db, viewer, owner, 'pending');
    await setRule(db, owner, 'friend', viewer, 3);
    await expectAccess('user_viewer', null);
    await db.reset();
    owner = await addUser(db, 'user_owner');
    viewer = await addUser(db, 'user_viewer');
    await befriend(db, owner, viewer, 'pending');
    await expectAccess('user_viewer', null);
  });

  it("the viewer's own rule for the owner doesn't matter, only the owner's", async () => {
    await befriend(db, owner, viewer);
    await setRule(db, owner, 'friend', viewer, 1);
    await setRule(db, viewer, 'friend', owner, 3);
    await expectAccess('user_viewer', 1);
  });

  it("another friend's rule doesn't leak to this viewer", async () => {
    await befriend(db, owner, viewer);
    await befriend(db, owner, other);
    await setRule(db, owner, 'friend', other, 3);
    await expectAccess('user_viewer', 1);
    await expectAccess('user_other', 3);
  });
});

describe('groups (FR-SOC-5, FR-VIS-3, D27)', () => {
  it.each([1, 2, 3] as const)('a shared group with a T%i rule gives T%i', async (t) => {
    const g = await addGroup(db, other, [owner, viewer]);
    await setRule(db, owner, 'group', g, t);
    await expectAccess('user_viewer', t);
  });

  it('a shared group without a rule gives T1', async () => {
    await addGroup(db, other, [owner, viewer]);
    await expectAccess('user_viewer', 1);
  });

  it('overlapping groups: the most restrictive tier applies', async () => {
    const netball = await addGroup(db, other, [owner, viewer], 'Netball');
    const study = await addGroup(db, other, [owner, viewer], 'Study');
    const choir = await addGroup(db, other, [owner, viewer], 'Choir');
    await setRule(db, owner, 'group', netball, 3);
    await setRule(db, owner, 'group', study, 2);
    await setRule(db, owner, 'group', choir, 3);
    await expectAccess('user_viewer', 2);
  });

  it('overlapping groups: a shared group with no rule counts as T1', async () => {
    const netball = await addGroup(db, other, [owner, viewer], 'Netball');
    await addGroup(db, other, [owner, viewer], 'Study');
    await setRule(db, owner, 'group', netball, 3);
    await expectAccess('user_viewer', 1);
  });

  it("only groups both people are in count, not the owner's other groups", async () => {
    const shared = await addGroup(db, other, [owner, viewer], 'Shared');
    const ownerOnly = await addGroup(db, other, [owner], 'Owner only');
    const viewerOnly = await addGroup(db, other, [viewer], 'Viewer only');
    await setRule(db, owner, 'group', shared, 3);
    await setRule(db, owner, 'group', ownerOnly, 1);
    await setRule(db, owner, 'group', viewerOnly, 1);
    await expectAccess('user_viewer', 3);
  });

  it('a group rule for a group the viewer is not in gives nothing', async () => {
    const g = await addGroup(db, other, [owner]);
    await setRule(db, owner, 'group', g, 3);
    await expectAccess('user_viewer', null);
  });

  it('being in a group with the owner does not make you friends (a friend rule is ignored)', async () => {
    const g = await addGroup(db, other, [owner, viewer]);
    await setRule(db, owner, 'group', g, 1);
    await setRule(db, owner, 'friend', viewer, 3); // left over, e.g. from an old friendship
    await expectAccess('user_viewer', 1);
  });

  it('a friend rule is ignored while the request is still pending', async () => {
    const g = await addGroup(db, other, [owner, viewer]);
    await setRule(db, owner, 'group', g, 2);
    await befriend(db, viewer, owner, 'pending');
    await setRule(db, owner, 'friend', viewer, 3);
    await expectAccess('user_viewer', 2);
  });
});

describe('friend rule vs group rules (D27: the individual friend tier always wins)', () => {
  it('a friend rule lower than the shared groups wins', async () => {
    const g = await addGroup(db, other, [owner, viewer]);
    await setRule(db, owner, 'group', g, 3);
    await befriend(db, owner, viewer);
    await setRule(db, owner, 'friend', viewer, 1);
    await expectAccess('user_viewer', 1);
  });

  it('a friend rule higher than the shared groups wins', async () => {
    const a = await addGroup(db, other, [owner, viewer], 'A');
    const b = await addGroup(db, other, [owner, viewer], 'B');
    await setRule(db, owner, 'group', a, 1);
    await setRule(db, owner, 'group', b, 2);
    await befriend(db, owner, viewer);
    await setRule(db, owner, 'friend', viewer, 3);
    await expectAccess('user_viewer', 3);
  });

  it('a friend without a rule falls back to the shared groups', async () => {
    const g = await addGroup(db, other, [owner, viewer]);
    await setRule(db, owner, 'group', g, 2);
    await befriend(db, owner, viewer);
    await expectAccess('user_viewer', 2);
  });
});

describe('group admins get no extra visibility (FR-SOC-10)', () => {
  it('the admin sees a member at the tier the member chose, not more', async () => {
    const g = await addGroup(db, viewer, [owner]);
    await setRule(db, owner, 'group', g, 1);
    await expectAccess('user_viewer', 1);
  });

  it('the admin sees a member with no rule at T1', async () => {
    await addGroup(db, viewer, [owner]);
    await expectAccess('user_viewer', 1);
  });

  it("administering a group the owner isn't in gives nothing", async () => {
    const g = await addGroup(db, viewer, []);
    await setRule(db, owner, 'group', g, 3); // stale rule; the owner is not a member
    await expectAccess('user_viewer', null);
  });

  it("the admin can't read members' rows or rules directly either", async () => {
    const g = await addGroup(db, viewer, [owner]);
    await setRule(db, owner, 'group', g, 1);
    const asAdmin = db.asUser('user_viewer');
    expect(await asAdmin.query(`select user_id from public.group_members`)).toEqual([
      { user_id: viewer },
    ]);
    expect(await asAdmin.query(`select * from public.visibility_rules`)).toEqual([]);
    expect(await asAdmin.query(`select * from public.events where user_id = $1`, [owner])).toEqual(
      [],
    );
  });
});

describe('blocks (FR-SOC-6)', () => {
  async function connectFully(): Promise<void> {
    const g = await addGroup(db, other, [owner, viewer]);
    await setRule(db, owner, 'group', g, 3);
    await befriend(db, owner, viewer);
    await setRule(db, owner, 'friend', viewer, 3);
  }

  it('the owner blocking the viewer removes all access', async () => {
    await connectFully();
    await block(db, owner, viewer);
    await expectAccess('user_viewer', null);
  });

  it('the viewer blocking the owner removes their access too', async () => {
    await connectFully();
    await block(db, viewer, owner);
    await expectAccess('user_viewer', null);
  });

  it('a block between two other people changes nothing', async () => {
    await connectFully();
    await block(db, other, viewer);
    await expectAccess('user_viewer', 3);
  });
});

describe('no access', () => {
  it('no connection at all', async () => {
    await expectAccess('user_viewer', null);
  });

  it('a valid token without a users row', async () => {
    await expectAccess('user_stranger', null);
  });

  it('a random owner id returns nothing (indistinguishable from no events)', async () => {
    expect(await eventsFor('user_viewer', '00000000-0000-4000-8000-000000000000')).toEqual([]);
  });

  it('anon cannot call events_for_viewer at all', async () => {
    await expect(
      db.asAnon().query(`select * from public.events_for_viewer($1, $2, $3)`, [owner, ...RANGE]),
    ).rejects.toThrow(/permission denied for function events_for_viewer/);
  });

  it('rejects an empty or inverted range', async () => {
    await expect(
      db
        .asUser('user_viewer')
        .query(`select * from public.events_for_viewer($1, $2, $2)`, [owner, RANGE[0]]),
    ).rejects.toThrow(/range_end must be after range_start/);
  });
});

describe('sharing paused (FR-VIS-6)', () => {
  it('a paused owner shares nothing, whatever the tier', async () => {
    await befriend(db, owner, viewer);
    await setRule(db, owner, 'friend', viewer, 3);
    await db.admin.query(`update public.users set sharing_paused = true where id = $1`, [owner]);
    await expectAccess('user_viewer', null);
  });

  it('resuming restores the previous tier', async () => {
    await befriend(db, owner, viewer);
    await setRule(db, owner, 'friend', viewer, 2);
    await db.admin.query(`update public.users set sharing_paused = true where id = $1`, [owner]);
    await db.admin.query(`update public.users set sharing_paused = false where id = $1`, [owner]);
    await expectAccess('user_viewer', 2);
  });

  it("the owner still sees their own events, and a paused viewer still sees others'", async () => {
    await db.admin.query(`update public.users set sharing_paused = true where id = $1`, [owner]);
    await expectAccess('user_owner', 3);
    await befriend(db, owner, viewer);
    await setRule(db, owner, 'friend', viewer, 3);
    await db.admin.query(
      `update public.users set sharing_paused = (id = $1) where id in ($1, $2)`,
      [viewer, owner],
    );
    await expectAccess('user_viewer', 3);
  });
});

describe('private events (FR-VIS-4)', () => {
  it('show as busy with no category or title at T3, and for the owner through this path', async () => {
    await befriend(db, owner, viewer);
    await setRule(db, owner, 'friend', viewer, 3);
    await expectAccess('user_viewer', 3); // asserts the therapy row has null category and title
    await expectAccess('user_owner', 3);
  });
});

describe('the result shape leaks nothing else', () => {
  it('returns only times, recurrence, category and title (no location, source or private flag)', async () => {
    const { rows } = await db.admin.query<{ name: string }>(
      `select unnest(proargnames) as name from pg_proc
       where oid = 'public.events_for_viewer(uuid, timestamptz, timestamptz)'::regprocedure`,
    );
    expect(rows.map((r) => r.name)).toEqual([
      'owner_id',
      'range_start',
      'range_end',
      'id',
      'starts_at',
      'ends_at',
      'rrule',
      'exdates',
      'category',
      'title',
    ]);
  });
});

describe('RLS: other users’ rows are never directly selectable (NFR-SEC-2, D41)', () => {
  beforeEach(async () => {
    // The viewer is as connected as possible: friend at T3 and in a group at T3.
    const g = await addGroup(db, other, [owner, viewer]);
    await setRule(db, owner, 'group', g, 3);
    await befriend(db, owner, viewer);
    await setRule(db, owner, 'friend', viewer, 3);
    await block(db, owner, other);
  });

  it.each([
    ['events', 'user_id'],
    ['sources', 'user_id'],
    ['visibility_rules', 'owner_id'],
    ['blocks', 'blocker_id'],
    ['group_members', 'user_id'],
    ['users', 'id'],
  ])("the viewer can't select the owner's %s rows", async (table, column) => {
    const { rows: exists } = await db.admin.query(
      `select 1 from public.${table} where ${column} = $1`,
      [owner],
    );
    expect(exists.length).toBeGreaterThan(0);
    const rows = await db
      .asUser('user_viewer')
      .query(`select * from public.${table} where ${column} = $1`, [owner]);
    expect(rows).toEqual([]);
  });

  it('the viewer sees only their own group memberships, not the member list', async () => {
    const rows = await db
      .asUser('user_viewer')
      .query<{ user_id: string }>(`select user_id from public.group_members`);
    expect(rows).toEqual([{ user_id: viewer }]);
  });

  it('the viewer sees groups they belong to, and not others', async () => {
    await addGroup(db, owner, [], 'Owner-only group');
    const rows = await db.asUser('user_viewer').query(`select name from public.groups`);
    expect(rows).toEqual([{ name: 'Netball' }]);
  });

  it('both parties see their friendship; nobody else does', async () => {
    expect(await db.asUser('user_viewer').query(`select 1 from public.friendships`)).toHaveLength(
      1,
    );
    expect(await db.asUser('user_owner').query(`select 1 from public.friendships`)).toHaveLength(1);
    expect(await db.asUser('user_other').query(`select 1 from public.friendships`)).toEqual([]);
  });

  it('the blocked user cannot see the block; the blocker can', async () => {
    expect(await db.asUser('user_other').query(`select * from public.blocks`)).toEqual([]);
    expect(await db.asUser('user_owner').query(`select blocked_id from public.blocks`)).toEqual([
      { blocked_id: other },
    ]);
  });

  it('the owner sees their own rows', async () => {
    expect(await db.asUser('user_owner').query(`select id from public.events`)).toHaveLength(3);
    expect(await db.asUser('user_owner').query(`select id from public.sources`)).toHaveLength(1);
    expect(
      await db.asUser('user_owner').query(`select id from public.visibility_rules`),
    ).toHaveLength(2);
  });

  it.each([
    'events',
    'sources',
    'visibility_rules',
    'friendships',
    'blocks',
    'groups',
    'group_members',
  ])('anon has no access to %s', async (table) => {
    await expect(db.asAnon().query(`select * from public.${table}`)).rejects.toThrow(
      new RegExp(`permission denied for table ${table}`),
    );
  });
});

describe('no tier escalation through writes', () => {
  beforeEach(async () => {
    await befriend(db, owner, viewer);
    await setRule(db, owner, 'friend', viewer, 1);
  });

  it("a user can't create a visibility rule, for someone else or themself", async () => {
    for (const [ownerId, target] of [
      [owner, viewer],
      [viewer, owner],
    ]) {
      await expect(
        db.asUser('user_viewer').query(
          `insert into public.visibility_rules (owner_id, target_type, target_id, tier)
             values ($1, 'friend', $2, 3)`,
          [ownerId, target],
        ),
      ).rejects.toThrow(/permission denied for table visibility_rules/);
    }
    await expectAccess('user_viewer', 1);
  });

  it("a user can't raise the tier someone else gave them", async () => {
    await db
      .asUser('user_viewer')
      .query(`update public.visibility_rules set tier = 3 where owner_id = $1`, [owner]);
    await expectAccess('user_viewer', 1);
  });

  it("a user can't re-point a rule's owner or target", async () => {
    await setRule(db, viewer, 'friend', owner, 1);
    for (const column of ['owner_id', 'target_id', 'target_type']) {
      await expect(
        db
          .asUser('user_viewer')
          .query(`update public.visibility_rules set ${column} = ${column} where owner_id = $1`, [
            viewer,
          ]),
      ).rejects.toThrow(/permission denied for table visibility_rules/);
    }
  });

  it('an owner can change the tier of their own rule, within 1–3 (FR-VIS-2)', async () => {
    await db
      .asUser('user_owner')
      .query(`update public.visibility_rules set tier = 2 where target_id = $1`, [viewer]);
    await expectAccess('user_viewer', 2);
    for (const bad of [0, 4]) {
      await expect(
        db
          .asUser('user_owner')
          .query(`update public.visibility_rules set tier = $2 where target_id = $1`, [
            viewer,
            bad,
          ]),
      ).rejects.toThrow(/visibility_rules_tier_check/);
    }
  });

  it("a user can't delete a rule (e.g. to drop an owner's lower friend tier)", async () => {
    await expect(
      db
        .asUser('user_owner')
        .query(`delete from public.visibility_rules where owner_id = $1`, [owner]),
    ).rejects.toThrow(/permission denied for table visibility_rules/);
  });

  it("a user can't add themself to a group or change a membership", async () => {
    const g = await addGroup(db, owner, [], 'Private club');
    await setRule(db, owner, 'group', g, 3);
    await expect(
      db
        .asUser('user_viewer')
        .query(`insert into public.group_members (group_id, user_id) values ($1, $2)`, [g, viewer]),
    ).rejects.toThrow(/permission denied for table group_members/);
    await joinGroup(db, g, viewer);
    await expect(
      db
        .asUser('user_viewer')
        .query(`update public.group_members set role = 'admin', can_manage_members = true`),
    ).rejects.toThrow(/permission denied for table group_members/);
    await expect(
      db
        .asUser('user_viewer')
        .query(`delete from public.group_members where user_id = $1`, [viewer]),
    ).rejects.toThrow(/permission denied for table group_members/);
  });

  it("a user can't create, edit or delete groups directly", async () => {
    await expect(
      db
        .asUser('user_viewer')
        .query(`insert into public.groups (name, admin_id) values ('Mine', $1)`, [viewer]),
    ).rejects.toThrow(/permission denied for table groups/);
    const g = await addGroup(db, viewer, [owner]);
    await expect(
      db
        .asUser('user_viewer')
        .query(`update public.groups set max_members = 999 where id = $1`, [g]),
    ).rejects.toThrow(/permission denied for table groups/);
    await expect(
      db.asUser('user_viewer').query(`delete from public.groups where id = $1`, [g]),
    ).rejects.toThrow(/permission denied for table groups/);
  });

  it("a user can't create, accept or remove friendships directly", async () => {
    await expect(
      db.asUser('user_viewer').query(
        `insert into public.friendships (user_a, user_b, status, requested_by)
           values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid), 'accepted', $1)`,
        [viewer, other],
      ),
    ).rejects.toThrow(/permission denied for table friendships/);
    await expect(
      db.asUser('user_viewer').query(`update public.friendships set status = 'accepted'`),
    ).rejects.toThrow(/permission denied for table friendships/);
    await expect(db.asUser('user_viewer').query(`delete from public.friendships`)).rejects.toThrow(
      /permission denied for table friendships/,
    );
  });

  it("a user can't block or unblock directly (WF-047 adds that)", async () => {
    await block(db, owner, viewer);
    await expect(
      db
        .asUser('user_viewer')
        .query(`insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`, [
          viewer,
          owner,
        ]),
    ).rejects.toThrow(/permission denied for table blocks/);
    await expect(db.asUser('user_owner').query(`delete from public.blocks`)).rejects.toThrow(
      /permission denied for table blocks/,
    );
  });

  it.each([
    'events',
    'sources',
    'visibility_rules',
    'friendships',
    'blocks',
    'groups',
    'group_members',
  ])("clients can't TRUNCATE %s (RLS doesn't cover TRUNCATE)", async (table) => {
    await expect(db.asUser('user_owner').query(`truncate public.${table} cascade`)).rejects.toThrow(
      /permission denied/,
    );
  });

  it("a user can't write events or sources as someone else", async () => {
    const ownerSource = (
      await db.admin.query<{ id: string }>(`select id from public.sources where user_id = $1`, [
        owner,
      ])
    ).rows[0]?.id;
    await expect(
      db
        .asUser('user_viewer')
        .query(`insert into public.sources (user_id, type) values ($1, 'manual')`, [owner]),
    ).rejects.toThrow(/row-level security/);
    await expect(
      db.asUser('user_viewer').query(
        `insert into public.events (user_id, source_id, starts_at, ends_at)
           values ($1, $2, now(), now() + interval '1 hour')`,
        [owner, ownerSource],
      ),
    ).rejects.toThrow(/row-level security/);
    // Own user_id but the owner's source: the composite foreign key stops it.
    await expect(
      db.asUser('user_viewer').query(
        `insert into public.events (user_id, source_id, starts_at, ends_at)
           values ($1, $2, now(), now() + interval '1 hour')`,
        [viewer, ownerSource],
      ),
    ).rejects.toThrow(/events_source_same_user/);
    // Nor edit or delete the owner's events.
    await db.asUser('user_viewer').query(`update public.events set title = 'x'`);
    await db.asUser('user_viewer').query(`delete from public.events`);
    const { rows } = await db.admin.query(
      `select count(*)::int as n from public.events where user_id = $1 and title is distinct from 'x'`,
      [owner],
    );
    expect(rows).toEqual([{ n: 3 }]);
  });

  it('an owner can manage their own sources and events, but not hand them to someone else', async () => {
    const s = await db
      .asUser('user_viewer')
      .query<{ id: string }>(
        `insert into public.sources (user_id, type) values ($1, 'manual') returning id`,
        [viewer],
      );
    const sourceId = s[0]?.id;
    const e = await db.asUser('user_viewer').query<{ id: string }>(
      `insert into public.events (user_id, source_id, title, category, starts_at, ends_at)
         values ($1, $2, 'Gym', 'other', now(), now() + interval '1 hour') returning id`,
      [viewer, sourceId],
    );
    expect(e).toHaveLength(1);
    await expect(
      db.asUser('user_viewer').query(`update public.events set user_id = $1`, [owner]),
    ).rejects.toThrow(/row-level security|events_source_same_user/);
    await db.asUser('user_viewer').query(`delete from public.sources where id = $1`, [sourceId]);
    const { rows } = await db.admin.query(`select 1 from public.events where user_id = $1`, [
      viewer,
    ]);
    expect(rows).toEqual([]); // cascaded
  });
});

describe('internal functions are not callable by clients', () => {
  it.each([
    ['authenticated', () => db.asUser('user_viewer')],
    ['anon', () => db.asAnon()],
    ['service_role', () => db.asService()],
  ])('%s cannot call private.resolve_tier or private.redacted_events', async (_role, as) => {
    await expect(
      as().query(`select private.resolve_tier($1, $2)`, [viewer, owner]),
    ).rejects.toThrow(/permission denied for schema private/);
    await expect(
      as().query(`select * from private.redacted_events($1, 3::smallint, $2, $3)`, [
        owner,
        ...RANGE,
      ]),
    ).rejects.toThrow(/permission denied for schema private/);
  });

  it('events_for_viewer ignores who the service role claims to be (it has no viewer)', async () => {
    await expect(
      db.asService().query(`select * from public.events_for_viewer($1, $2, $3)`, [owner, ...RANGE]),
    ).rejects.toThrow(/permission denied for function events_for_viewer/);
  });
});
