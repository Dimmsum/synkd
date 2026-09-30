// Helpers for the friend-graph tests (WF-042, WF-047): people with one busy
// event each, and a way to read which tier one person sees of another
// through the real redaction path (events_for_viewer).

import type { TestDb } from './db';
import { addEvent, addSource, addUser } from './seed';

type Tier = 1 | 2 | 3;

export const RANGE = ['2026-10-05T00:00:00Z', '2026-10-06T00:00:00Z'] as const;
const EVENT_CATEGORY = 'class';
const titleOf = (clerkId: string) => `Secret lecture of ${clerkId}`;

/** A user (with handle `handle`, if given) who has one busy event in RANGE with a title and category. */
export async function addPerson(db: TestDb, clerkId: string, handle?: string): Promise<string> {
  const id = await addUser(db, clerkId, handle === undefined ? {} : { handle });
  const source = await addSource(db, id);
  await addEvent(db, id, source, {
    title: titleOf(clerkId),
    category: EVENT_CATEGORY,
    startsAt: '2026-10-05T14:00:00Z',
    endsAt: '2026-10-05T16:00:00Z',
  });
  return id;
}

/**
 * The tier `viewerClerkId` gets of `ownerId`'s schedule through
 * events_for_viewer, inferred from what comes back (null = nothing).
 * `ownerClerkId` is only used to check the title is the owner's.
 */
export async function tierSeen(
  db: TestDb,
  viewerClerkId: string,
  ownerId: string,
  ownerClerkId: string,
): Promise<Tier | null> {
  const rows = await db
    .asUser(viewerClerkId)
    .query<{ category: string | null; title: string | null }>(
      `select category, title from public.events_for_viewer($1, $2, $3)`,
      [ownerId, ...RANGE],
    );
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new Error(`expected one event, got ${rows.length}`);
  const [row] = rows as [{ category: string | null; title: string | null }];
  if (row.category === null) {
    if (row.title !== null) throw new Error('title without category');
    return 1;
  }
  if (row.category !== EVENT_CATEGORY) throw new Error(`unexpected category ${row.category}`);
  if (row.title === null) return 2;
  if (row.title !== titleOf(ownerClerkId)) throw new Error(`unexpected title ${row.title}`);
  return 3;
}

export interface GraphState {
  friendships: { user_a: string; user_b: string; status: string; requested_by: string }[];
  rules: { owner_id: string; target_id: string; tier: number }[];
  blocks: { blocker_id: string; blocked_id: string }[];
}

/** Every friendship, friend rule and block, read as the superuser, in a stable order. */
export async function graphState(db: TestDb): Promise<GraphState> {
  const q = async <T>(sql: string) => (await db.admin.query<T>(sql)).rows;
  return {
    friendships: await q(
      `select user_a, user_b, status, requested_by from public.friendships order by user_a, user_b`,
    ),
    rules: await q(
      `select owner_id, target_id, tier from public.visibility_rules
       where target_type = 'friend' order by owner_id, target_id`,
    ),
    blocks: await q(
      `select blocker_id, blocked_id from public.blocks order by blocker_id, blocked_id`,
    ),
  };
}
