// Data access for the viewer, the Now screen, friends and groups.
//
// Screens call these async functions. The viewer, friends, requests, groups and everyone's
// status are real (WF-004, WF-042, WF-043, WF-064): database functions called as the signed-in
// user (Clerk token → Supabase RLS), with statuses worked out on the server by the availability
// engine (lib/data/now.ts). Nothing here reads mock data (WF-134): what isn't built yet (group
// calendars WF-066, the slot finder WF-098) is left out, and its screens say it's coming.
// Everything about other people must come back already redacted to the viewer's tier
// (FR-VIS-5, D41).

import { cache } from 'react';
import { dateKey } from '@whosfree/ui/lib/time';
import type {
  Connection,
  FriendDetail,
  FriendRequest,
  GroupDetail,
  GroupSummary,
  Iso,
  Viewer,
} from '@/lib/types';
import { appUrl } from '@/lib/config';
import { hueFor } from '@/lib/hue';
import { freeNowByGroup } from '@/lib/now-sections';
import {
  getNowConnections,
  getOwnPresence,
  getPresenceIndex,
  getViewerRow,
  requestNow,
} from '@/lib/data/now';
import {
  groupMembershipIndex,
  listFriendRequests,
  listFriends,
  listGroupInvites,
  listGroupMembers,
  listMyGroups,
} from '@/lib/data/social';
import {
  friendToPerson,
  isUuid,
  mostRestrictiveGroup,
  pickInvite,
  toConnection as socialConnection,
  toFriendRequest,
  toGroupInvite,
  toGroupMember,
  toGroupSummary,
  toPermissions,
  withPresence,
} from '@/lib/social/mappers';

/**
 * The signed-in user with their own status (FR-AVL-4), worked out by the availability engine
 * from their schedule, hours and manual status (WF-064). proxy.ts guarantees the users row
 * exists before any app route renders.
 */
export const getViewer = cache(async (): Promise<Viewer> => {
  const [row, presence] = await Promise.all([getViewerRow(), getOwnPresence()]);
  return {
    id: row.id,
    name: row.name,
    handle: row.handle ?? '',
    hue: hueFor(row.id),
    timeZone: row.timezone,
    sharingPaused: row.sharing_paused,
    status: presence.status,
    until: presence.until,
    nextFreeAt: presence.nextFreeAt,
    ...(presence.activity ? { activity: presence.activity } : {}),
    manual: presence.override,
  };
});

/**
 * The current time for screens: the instant this request's statuses were worked out at, with
 * the date and timezone to show it in (the viewer's own, FR-AVL-9).
 */
export async function getNow(): Promise<{ now: Iso; today: string; timeZone: string }> {
  const now = new Date(requestNow());
  const { timezone } = await getViewerRow();
  return { now: now.toISOString(), today: dateKey(now, timezone), timeZone: timezone };
}

/**
 * Everyone the viewer can see on the Now screen, with status, "until X" and the changes ahead
 * (PRD §8.5), plus the viewer's groups for the filter (FR-VIEW-2) with how many are free now.
 * Statuses come from `now_for_viewer` (already redacted) through the engine on the server.
 */
export async function getNowForViewer(): Promise<{
  connections: Connection[];
  groups: GroupSummary[];
}> {
  const [connections, groups] = await Promise.all([getNowConnections(), listMyGroups()]);
  const free = freeNowByGroup(connections);
  return {
    connections,
    groups: groups.map((g) => ({ ...toGroupSummary(g), freeNowCount: free.get(g.id) ?? 0 })),
  };
}

/**
 * The viewer's friends (FR-SOC-1), by name, each with the viewer's groups they're also in, and
 * their status and resolved tier from the Now data (WF-064).
 */
export async function getFriends(): Promise<Connection[]> {
  const [friends, index, presence] = await Promise.all([
    listFriends(),
    groupMembershipIndex(),
    getPresenceIndex(),
  ]);
  return friends.map((f) =>
    withPresence(
      socialConnection(friendToPerson(f), { isFriend: true, groupIds: index.get(f.user_id) ?? [] }),
      presence.get(f.user_id),
    ),
  );
}

/** Pending friend requests both ways, newest first (WF-042). */
export async function getFriendRequests(): Promise<FriendRequest[]> {
  return (await listFriendRequests()).map(toFriendRequest);
}

/**
 * A friend's detail: who they are and their status now (WF-064), the groups you share and the
 * tier you show them (WF-042/043). Null if they aren't a friend (or either of you blocked the
 * other). Their day/week calendar is lib/data/connection-schedule.ts (WF-065).
 * TODO(WF-098): "You're both free" comes from the slot finder. Until then it's null, which the
 * page shows as coming soon: empty would read as "never free together" (WF-134).
 */
export async function getFriend(id: string): Promise<FriendDetail | null> {
  if (!isUuid(id)) return null;
  const [friends, groups, index, presence] = await Promise.all([
    listFriends(),
    listMyGroups(),
    groupMembershipIndex(),
    getPresenceIndex(),
  ]);
  const row = friends.find((f) => f.user_id === id);
  if (!row) return null;
  const groupIds = index.get(id) ?? [];
  const shared = groups.filter((g) => groupIds.includes(g.id));
  return {
    person: withPresence(
      socialConnection(friendToPerson(row), { isFriend: true, groupIds }),
      presence.get(id),
    ),
    sharedGroups: shared.map(toGroupSummary),
    viewerTierForThem: row.tier,
    groupTier: mostRestrictiveGroup(shared),
    freeTogether: null,
  };
}

/**
 * The viewer's groups, oldest membership first (WF-043). With `freeNow`, each says how many of
 * its other members are free right now (WF-064); that reads the Now data, so the app shell,
 * which only needs names, leaves it off.
 */
export async function getGroups(opts: { freeNow?: boolean } = {}): Promise<GroupSummary[]> {
  const [groups, presence] = await Promise.all([
    listMyGroups(),
    opts.freeNow ? getPresenceIndex() : null,
  ]);
  const free = presence ? freeNowByGroup([...presence.values()]) : null;
  return groups.map((g) => ({ ...toGroupSummary(g), freeNowCount: free?.get(g.id) ?? 0 }));
}

/**
 * One group with its members, their roles, permissions and status now (WF-064), the viewer's
 * tier for it and an invite link if the viewer may invite (WF-043/044/045). Null if the viewer
 * isn't a member. Being admin gives no extra visibility (FR-SOC-10): each member's status is at
 * their own tier for the viewer, as on the Now screen.
 */
export async function getGroup(id: string): Promise<GroupDetail | null> {
  if (!isUuid(id)) return null;
  const [groups, members, friends, presence] = await Promise.all([
    listMyGroups(),
    listGroupMembers(id),
    listFriends(),
    getPresenceIndex(),
  ]);
  const row = groups.find((g) => g.id === id);
  if (!row || !members) return null;
  const permissions = toPermissions(row);
  const [invites, viewer] = await Promise.all([
    permissions.invite ? listGroupInvites(id) : [],
    getViewer(),
  ]);
  const friendIds = new Set(friends.map((f) => f.user_id));
  const invite = pickInvite(invites);
  const people = members.map((m) => {
    const member = toGroupMember(m, { isFriend: friendIds.has(m.user_id), groupIds: [id] });
    if (!m.is_me) return withPresence(member, presence.get(m.user_id));
    // The viewer's own status is already on the viewer (the status chip shows the same).
    const { status, until, nextFreeAt, activity } = viewer;
    return {
      ...member,
      tier: 3 as const,
      status,
      until,
      nextFreeAt,
      ...(activity ? { activity } : {}),
    };
  });
  return {
    ...toGroupSummary(row),
    freeNowCount: people.filter((p) => !p.isViewer && p.status === 'free').length,
    members: people,
    maxMembers: row.max_members,
    viewerPermissions: permissions,
    viewerTier: row.my_tier,
    invite: invite ? toGroupInvite(invite, appUrl()) : null,
  };
}
