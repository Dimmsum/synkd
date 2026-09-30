// Helpers for the group tests (WF-043, WF-044, WF-045, WF-047). Most act as
// a signed-in client through the public functions, so the tests exercise the
// same path the web app uses.

import { expect } from 'vitest';
import type { TestDb } from './db';
import { addEvent, addSource, joinGroup, setRule } from './seed';

type Tier = 1 | 2 | 3;

async function scalar<T>(
  db: TestDb,
  clerkId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const [row] = await db.asUser(clerkId).query<{ v: T }>(sql, params);
  if (row === undefined) throw new Error(`Expected a row from: ${sql}`);
  return row.v;
}

/** users.id for a Clerk ID. */
export async function userIdOf(db: TestDb, clerkId: string): Promise<string> {
  const { rows } = await db.admin.query<{ id: string }>(
    `select id from public.users where clerk_id = $1`,
    [clerkId],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`No user ${clerkId}`);
  return id;
}

/** create_group as `clerkId`; returns the group id. */
export function createGroup(
  db: TestDb,
  clerkId: string,
  opts: { name?: string; emoji?: string | null; tier?: Tier } = {},
): Promise<string> {
  return scalar<string>(db, clerkId, `select public.create_group($1, $2, $3) as v`, [
    opts.name ?? 'Netball',
    opts.emoji === undefined ? '🏐' : opts.emoji,
    opts.tier ?? 1,
  ]);
}

/**
 * Creates a group as `adminClerk` (through create_group), then adds each of
 * `memberClerks` as the superuser, with the column-default (D26) permissions
 * and a group rule at `memberTier`. The real join path, join_group, is
 * tested in invites.test.ts.
 */
export async function groupWithMembers(
  db: TestDb,
  adminClerk: string,
  memberClerks: string[],
  opts: { name?: string; adminTier?: Tier; memberTier?: Tier } = {},
): Promise<string> {
  const groupId = await createGroup(db, adminClerk, {
    name: opts.name ?? 'Netball',
    tier: opts.adminTier ?? 1,
  });
  for (const clerk of memberClerks) {
    const id = await userIdOf(db, clerk);
    await joinGroup(db, groupId, id);
    await setRule(db, id, 'group', groupId, opts.memberTier ?? 1);
  }
  return groupId;
}

/**
 * Gives `ownerId` one busy event with a title and a category, so tierSeen can
 * tell which tier a viewer gets from what events_for_viewer returns.
 */
export async function addProbeEvent(db: TestDb, ownerId: string): Promise<void> {
  const source = await addSource(db, ownerId);
  await addEvent(db, ownerId, source, {
    title: 'Probe title',
    category: 'class',
    startsAt: '2026-10-05T14:00:00Z',
    endsAt: '2026-10-05T15:00:00Z',
  });
}

/**
 * The tier `viewerClerk` gets of `ownerId`'s probe event through
 * events_for_viewer: 3 = title, 2 = category, 1 = times only, null = nothing.
 */
export async function tierSeen(
  db: TestDb,
  viewerClerk: string,
  ownerId: string,
): Promise<Tier | null> {
  const rows = await db.asUser(viewerClerk).query<{
    title: string | null;
    category: string | null;
  }>(`select title, category from public.events_for_viewer($1, $2, $3)`, [ownerId, '2026-10-05T00:00:00Z', '2026-10-06T00:00:00Z']);
  if (rows.length === 0) return null;
  expect(rows).toHaveLength(1);
  const [row] = rows;
  if (row?.title !== null) return 3;
  if (row.category !== null) return 2;
  return 1;
}

/**
 * Runs `sql` as `clerkId` inside a transaction and reports whether, before it
 * commits, the group row is locked by that transaction. A row locked FOR
 * UPDATE carries the locking transaction's id in xmax (or, if the transaction
 * then updated the row, in the new version's xmin).
 *
 * PGlite has a single connection, so two transactions can't overlap in these
 * tests; this is how they prove the lock that serialises concurrent changes to
 * a group on real Postgres.
 */
export function locksGroupRow(
  db: TestDb,
  clerkId: string,
  groupId: string,
  sql: string,
  params: unknown[],
): Promise<boolean> {
  return db.asUser(clerkId).run(async (tx) => {
    await tx.query(sql, params);
    // Check as the superuser: after leave_group, RLS hides the group from the caller.
    await tx.query(`reset role`);
    const { rows } = await tx.query<{ locked: boolean }>(
      `select pg_current_xact_id()::text in (g.xmax::text, g.xmin::text) as locked
       from public.groups g where g.id = $1`,
      [groupId],
    );
    return rows[0]?.locked ?? false;
  });
}

/** Asserts that `promise` fails with a Postgres error with this message (exactly) and SQLSTATE. */
export async function expectPgError(
  promise: Promise<unknown>,
  message: string,
  code?: string,
): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, `expected "${message}"`).toBeInstanceOf(Error);
  const pgError = error as Error & { code?: string };
  expect(pgError.message).toBe(message);
  if (code !== undefined) expect(pgError.code).toBe(code);
}

/** Expects "permission denied for function <fn>". */
export async function expectNoExecute(promise: Promise<unknown>, fn: string): Promise<void> {
  await expect(promise).rejects.toThrow(new RegExp(`permission denied for function ${fn}\\b`));
}

// ---------------------------------------------------------------------------
// Invites (WF-045)
// ---------------------------------------------------------------------------

export interface GroupInviteRow {
  id: string;
  code: string;
  expires_at: Date | null;
  max_uses: number | null;
  uses: number;
  created_at: Date;
  created_by_me: boolean;
}

/** create_group_invite as `clerkId`. */
export async function createInvite(
  db: TestDb,
  clerkId: string,
  groupId: string,
  opts: { expiresAt?: string | null; maxUses?: number | null } = {},
): Promise<GroupInviteRow> {
  const [row] = await db
    .asUser(clerkId)
    .query<GroupInviteRow & Record<string, unknown>>(
      `select * from public.create_group_invite($1, $2, $3)`,
      [groupId, opts.expiresAt ?? null, opts.maxUses ?? null],
    );
  if (row === undefined) throw new Error('create_group_invite returned no row');
  return row;
}

/** join_group as `clerkId`; returns the group id. */
export function join(db: TestDb, clerkId: string, code: string, tier: Tier = 1): Promise<string> {
  return scalar<string>(db, clerkId, `select public.join_group($1, $2) as v`, [code, tier]);
}
