// Seeding helpers. They write as the superuser (like migrations or the
// service role would), bypassing RLS, to set up a scenario before a test acts
// as a client.

import type { TestDb } from './db';

type Tier = 1 | 2 | 3;

async function one<T>(db: TestDb, sql: string, params: unknown[]): Promise<T> {
  const { rows } = await db.admin.query<T>(sql, params);
  const row = rows[0];
  if (row === undefined) throw new Error(`Expected a row from: ${sql}`);
  return row;
}

/** Creates a user whose Clerk ID (JWT `sub`) is `clerkId`. Returns `users.id`. */
export async function addUser(
  db: TestDb,
  clerkId: string,
  opts: { sharingPaused?: boolean; handle?: string; avatarUrl?: string } = {},
): Promise<string> {
  const row = await one<{ id: string }>(
    db,
    `insert into public.users (clerk_id, name, sharing_paused, handle, avatar_url)
     values ($1, $2, $3, $4, $5) returning id`,
    [
      clerkId,
      `Name of ${clerkId}`,
      opts.sharingPaused ?? false,
      opts.handle ?? null,
      opts.avatarUrl ?? null,
    ],
  );
  return row.id;
}

/** Records a friendship (or request) between two users, sorting the pair as the schema requires. */
export async function befriend(
  db: TestDb,
  requester: string,
  other: string,
  status: 'pending' | 'accepted' = 'accepted',
): Promise<void> {
  const [a, b] = requester < other ? [requester, other] : [other, requester];
  await db.admin.query(
    `insert into public.friendships (user_a, user_b, status, requested_by) values ($1, $2, $3, $4)`,
    [a, b, status, requester],
  );
}

export async function block(db: TestDb, blocker: string, blocked: string): Promise<void> {
  await db.admin.query(`insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`, [
    blocker,
    blocked,
  ]);
}

/**
 * Creates a group administered by `admin` (who becomes a member with role admin) plus `members`.
 * The group and its admin row go in one transaction: a deferred trigger checks at commit that
 * `groups.admin_id` matches the single admin row (WF-043).
 */
export async function addGroup(
  db: TestDb,
  admin: string,
  members: string[] = [],
  name = 'Netball',
): Promise<string> {
  const id = await db.admin.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `insert into public.groups (name, emoji, admin_id) values ($1, '🏐', $2) returning id`,
      [name, admin],
    );
    const groupId = rows[0]?.id;
    if (groupId === undefined) throw new Error('Expected a group id');
    await tx.query(
      `insert into public.group_members (group_id, user_id, role, can_invite, can_manage_members,
         can_edit_group, can_group_ping)
       values ($1, $2, 'admin', true, true, true, true)`,
      [groupId, admin],
    );
    return groupId;
  });
  for (const m of members) await joinGroup(db, id, m);
  return id;
}

export async function joinGroup(db: TestDb, groupId: string, userId: string): Promise<void> {
  await db.admin.query(`insert into public.group_members (group_id, user_id) values ($1, $2)`, [
    groupId,
    userId,
  ]);
}

/** The tier `owner` grants a friend (`target` = the friend's users.id) or a group. */
export async function setRule(
  db: TestDb,
  owner: string,
  targetType: 'friend' | 'group',
  target: string,
  tier: Tier,
): Promise<void> {
  await db.admin.query(
    `insert into public.visibility_rules (owner_id, target_type, target_id, tier)
     values ($1, $2, $3, $4)
     on conflict (owner_id, target_type, target_id) do update set tier = excluded.tier`,
    [owner, targetType, target, tier],
  );
}

export async function addSource(
  db: TestDb,
  userId: string,
  opts: { type?: 'upload' | 'manual' | 'gcal'; periodStart?: string; periodEnd?: string } = {},
): Promise<string> {
  const row = await one<{ id: string }>(
    db,
    `insert into public.sources (user_id, type, period_start, period_end)
     values ($1, $2, $3, $4) returning id`,
    [userId, opts.type ?? 'upload', opts.periodStart ?? null, opts.periodEnd ?? null],
  );
  return row.id;
}

export interface EventInput {
  title?: string | null;
  category?: string | null;
  startsAt: string;
  endsAt: string;
  rrule?: string | null;
  exdates?: string[];
  isPrivate?: boolean;
  busy?: boolean;
}

export async function addEvent(
  db: TestDb,
  userId: string,
  sourceId: string,
  e: EventInput,
): Promise<string> {
  const row = await one<{ id: string }>(
    db,
    `insert into public.events
       (user_id, source_id, title, category, starts_at, ends_at, rrule, exdates, is_private, busy)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [
      userId,
      sourceId,
      e.title ?? null,
      e.category ?? null,
      e.startsAt,
      e.endsAt,
      e.rrule ?? null,
      e.exdates ?? [],
      e.isPrivate ?? false,
      e.busy ?? true,
    ],
  );
  return row.id;
}
