// Property test: over random social graphs, private.resolve_tier and
// events_for_viewer agree with a tiny reference model of the PRD rules
// (FR-VIS-3, FR-VIS-6, FR-SOC-5, FR-SOC-6, FR-SOC-10, D20, D27).

import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';

type Tier = 1 | 2 | 3;
const USERS = 4;
const GROUPS = 3;

interface Graph {
  /** friendships[i][j] for i < j: undefined, or who requested and the status. */
  friendships: { a: number; b: number; requester: number; status: 'pending' | 'accepted' }[];
  blocks: { blocker: number; blocked: number }[];
  /** Members of each group; the first member is the admin. */
  groups: number[][];
  friendRules: { owner: number; target: number; tier: Tier }[];
  groupRules: { owner: number; group: number; tier: Tier }[];
  paused: boolean[];
}

// ---------------------------------------------------------------------------
// Reference model, written straight from the PRD.
// ---------------------------------------------------------------------------
function modelTier(g: Graph, viewer: number, owner: number): Tier | null {
  if (viewer === owner) return 3;
  const blocked = g.blocks.some(
    (b) =>
      (b.blocker === viewer && b.blocked === owner) ||
      (b.blocker === owner && b.blocked === viewer),
  );
  if (blocked) return null;
  const isFriend = g.friendships.some(
    (f) =>
      f.status === 'accepted' &&
      ((f.a === viewer && f.b === owner) || (f.a === owner && f.b === viewer)),
  );
  // An individual friend tier always wins (D27).
  const friendRule = g.friendRules.find((r) => r.owner === owner && r.target === viewer);
  if (isFriend && friendRule) return friendRule.tier;
  // Otherwise the most restrictive shared group; a group without a rule counts as T1.
  const shared = g.groups
    .map((members, i) => ({ members, i }))
    .filter(({ members }) => members.includes(owner) && members.includes(viewer));
  if (shared.length > 0) {
    const tiers = shared.map(
      ({ i }) => g.groupRules.find((r) => r.owner === owner && r.group === i)?.tier ?? 1,
    );
    return Math.min(...tiers) as Tier;
  }
  return isFriend ? 1 : null;
}

// ---------------------------------------------------------------------------
// Random graphs.
// ---------------------------------------------------------------------------
const user = fc.integer({ min: 0, max: USERS - 1 });
const tier = fc.constantFrom<Tier>(1, 2, 3);

const pairs: [number, number][] = [];
for (let a = 0; a < USERS; a++) for (let b = a + 1; b < USERS; b++) pairs.push([a, b]);

const graphArb: fc.Arbitrary<Graph> = fc.record({
  friendships: fc
    .tuple(
      ...pairs.map(([a, b]) =>
        fc.option(
          fc.record({
            requester: fc.constantFrom(a, b),
            status: fc.constantFrom<'pending' | 'accepted'>('pending', 'accepted'),
          }),
          { freq: 2 },
        ),
      ),
    )
    .map((opts) =>
      opts.flatMap((o, i) => {
        const pair = pairs[i];
        return o && pair ? [{ a: pair[0], b: pair[1], ...o }] : [];
      }),
    ),
  blocks: fc.uniqueArray(
    fc.record({ blocker: user, blocked: user }).filter((b) => b.blocker !== b.blocked),
    { maxLength: 2, selector: (b) => `${b.blocker}>${b.blocked}` },
  ),
  groups: fc.array(fc.uniqueArray(user, { minLength: 1, maxLength: USERS }), {
    maxLength: GROUPS,
  }),
  friendRules: fc.uniqueArray(
    fc.record({ owner: user, target: user, tier }).filter((r) => r.owner !== r.target),
    { maxLength: 8, selector: (r) => `${r.owner}>${r.target}` },
  ),
  groupRules: fc.uniqueArray(
    fc.record({ owner: user, group: fc.integer({ min: 0, max: GROUPS - 1 }), tier }),
    { maxLength: 8, selector: (r) => `${r.owner}>${r.group}` },
  ),
  paused: fc.array(
    fc.integer({ min: 0, max: 4 }).map((n) => n === 0),
    {
      minLength: USERS,
      maxLength: USERS,
    },
  ),
});

// ---------------------------------------------------------------------------

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.close());

const clerk = (i: number) => `user_${i}`;

const uuid = (prefix: number, i: number) =>
  `${prefix}0000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const userId = (i: number) => uuid(1, i);
const groupId = (i: number) => uuid(2, i);
const sourceId = (i: number) => uuid(3, i);

/**
 * Replaces all data with graph `g` in one batch (the per-row seed helpers are
 * too slow for hundreds of runs). Every value is generated here, not user input.
 */
async function seedGraph(g: Graph): Promise<string[]> {
  const sql: string[] = [];
  for (let i = 0; i < USERS; i++) {
    const [u, s] = [userId(i), sourceId(i)];
    sql.push(
      `insert into public.users (id, clerk_id, name, sharing_paused)
       values ('${u}', '${clerk(i)}', 'U${i}', ${g.paused[i] ?? false})`,
      `insert into public.sources (id, user_id, type) values ('${s}', '${u}', 'upload')`,
      `insert into public.events (user_id, source_id, title, category, starts_at, ends_at)
       values ('${u}', '${s}', 'title-${i}', 'lab', '2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z')`,
      `insert into public.events (user_id, source_id, title, category, starts_at, ends_at, is_private)
       values ('${u}', '${s}', 'private-${i}', 'work', '2026-10-05T12:00:00Z', '2026-10-05T13:00:00Z', true)`,
    );
  }
  for (const f of g.friendships) {
    const [a, b] = [userId(f.a), userId(f.b)].sort();
    sql.push(
      `insert into public.friendships (user_a, user_b, status, requested_by)
       values ('${a}', '${b}', '${f.status}', '${userId(f.requester)}')`,
    );
  }
  for (const b of g.blocks) {
    sql.push(
      `insert into public.blocks (blocker_id, blocked_id)
       values ('${userId(b.blocker)}', '${userId(b.blocked)}')`,
    );
  }
  for (const [i, members] of g.groups.entries()) {
    sql.push(
      `insert into public.groups (id, name, admin_id)
       values ('${groupId(i)}', 'Group ${i}', '${userId(members[0] ?? 0)}')`,
    );
    for (const [j, m] of members.entries()) {
      sql.push(
        `insert into public.group_members (group_id, user_id, role)
         values ('${groupId(i)}', '${userId(m)}', '${j === 0 ? 'admin' : 'member'}')`,
      );
    }
  }
  for (const r of g.friendRules) {
    sql.push(
      `insert into public.visibility_rules (owner_id, target_type, target_id, tier)
       values ('${userId(r.owner)}', 'friend', '${userId(r.target)}', ${r.tier})`,
    );
  }
  // A rule may name a group that doesn't exist in this graph (a stale rule): it must grant nothing.
  for (const r of g.groupRules) {
    sql.push(
      `insert into public.visibility_rules (owner_id, target_type, target_id, tier)
       values ('${userId(r.owner)}', 'group', '${groupId(r.group)}', ${r.tier})`,
    );
  }
  await db.reset();
  await db.admin.exec(sql.join(';\n'));
  return Array.from({ length: USERS }, (_, i) => userId(i));
}

describe('resolve_tier matches the reference model', () => {
  it('for every viewer/owner pair of random graphs', async () => {
    await fc.assert(
      fc.asyncProperty(graphArb, async (g) => {
        const ids = await seedGraph(g);
        const { rows } = await db.admin.query<{ v: number; o: number; tier: number | null }>(
          `select v.i - 1 as v, o.i - 1 as o, private.resolve_tier(v.id, o.id) as tier
           from unnest($1::uuid[]) with ordinality as v(id, i)
           cross join unnest($1::uuid[]) with ordinality as o(id, i)`,
          [ids],
        );
        expect(rows).toHaveLength(USERS * USERS);
        for (const r of rows) {
          expect({ v: r.v, o: r.o, tier: r.tier }).toEqual({
            v: r.v,
            o: r.o,
            tier: modelTier(g, r.v, r.o),
          });
        }
      }),
      { numRuns: 150 },
    );
  });
});

describe('events_for_viewer never returns more than the model allows', () => {
  it('for every viewer/owner pair of random graphs', async () => {
    await fc.assert(
      fc.asyncProperty(graphArb, async (g) => {
        const ids = await seedGraph(g);
        for (let v = 0; v < USERS; v++) {
          for (let o = 0; o < USERS; o++) {
            const rows = await db
              .asUser(clerk(v))
              .query<{ category: string | null; title: string | null }>(
                `select category, title from public.events_for_viewer($1, $2, $3)`,
                [ids[o], '2026-10-05T00:00:00Z', '2026-10-06T00:00:00Z'],
              );
            const t = modelTier(g, v, o);
            const hidden = t === null || (v !== o && g.paused[o]);
            expect(rows).toEqual(
              hidden
                ? []
                : [
                    { category: t >= 2 ? 'lab' : null, title: t >= 3 ? `title-${o}` : null },
                    { category: null, title: null },
                  ],
            );
          }
        }
      }),
      { numRuns: 60 },
    );
  });
});
