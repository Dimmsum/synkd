// "Who can see me" (FR-VIS-8, WF-048, WF-134): every friend, group and fellow group member with
// the tier that actually applies to them. Pure, so the rules are unit-tested. It follows
// private.resolve_tier (FR-VIS-3) from the viewer's own rows: a tier set on a friend always
// wins; otherwise the most restrictive shared group applies; a friend with neither sees the
// default. Blocked people never appear, because list_friends and get_group_members already
// leave them out.
// TODO(WF-048): have the database resolve this with resolve_tier so it can't drift.

import type { Friend, GroupMember, MyGroup } from '@synkd/backend';
import { DEFAULT_TIER, type Tier } from '@synkd/shared';
import type { VisibilityRow } from '@/lib/types';
import { friendToPerson, toGroupSummary, toPerson } from './mappers';

export interface VisibilityOverview {
  friends: VisibilityRow[];
  groups: VisibilityRow[];
  /** People in the viewer's groups who aren't friends. They can only get a group's tier. */
  members: VisibilityRow[];
}

/**
 * The overview from `list_friends`, `list_my_groups` and each group's `get_group_members`.
 * Rows keep the order they came in (friends by name, groups by when the viewer joined).
 */
export function toVisibilityOverview(
  friends: Friend[],
  groups: MyGroup[],
  memberLists: { groupId: string; members: GroupMember[] }[],
): VisibilityOverview {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  // user id → the viewer's groups they're in, and the first row seen for them.
  const shared = new Map<string, MyGroup[]>();
  const memberRows = new Map<string, GroupMember>();
  for (const { groupId, members } of memberLists) {
    const g = groupById.get(groupId);
    if (!g) continue;
    for (const m of members) {
      if (m.is_me) continue;
      shared.set(m.user_id, [...(shared.get(m.user_id) ?? []), g]);
      if (!memberRows.has(m.user_id)) memberRows.set(m.user_id, m);
    }
  }

  const fromGroups = (userId: string, own: Tier | null) => {
    if (own !== null) return { tier: own, effectiveTier: own };
    const theirs = shared.get(userId) ?? [];
    const lowest = theirs.reduce<MyGroup | null>(
      (best, g) => (!best || g.my_tier < best.my_tier ? g : best),
      null,
    );
    if (!lowest) return { tier: null, effectiveTier: DEFAULT_TIER };
    // FR-VIS-3a: say which group lowered it when another shared group would show more.
    const lowered = theirs.some((g) => g.my_tier > lowest.my_tier);
    return {
      tier: null,
      effectiveTier: lowest.my_tier,
      ...(lowered ? { loweredBy: toGroupSummary(lowest) } : {}),
    };
  };

  const friendIds = new Set(friends.map((f) => f.user_id));
  return {
    friends: friends.map((f) => ({
      target: { type: 'friend', person: friendToPerson(f) },
      ...fromGroups(f.user_id, f.tier),
    })),
    groups: groups.map((g) => ({
      target: { type: 'group', group: toGroupSummary(g) },
      tier: g.my_tier,
      effectiveTier: g.my_tier,
    })),
    members: [...memberRows.values()]
      .filter((m) => !friendIds.has(m.user_id))
      .map((m) => ({
        target: {
          type: 'friend',
          person: toPerson({ id: m.user_id, name: m.name, handle: m.handle }),
        },
        ...fromGroups(m.user_id, null),
      })),
  };
}
