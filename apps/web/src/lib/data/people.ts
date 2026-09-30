// Data access for the viewer, the Now screen, friends and groups.
//
// Screens call these async functions and never touch lib/mock directly. The viewer, friends,
// requests and groups are real (WF-004, WF-042, WF-043): database functions called as the
// signed-in user (Clerk token → Supabase RLS). Statuses, timelines and free/busy still come
// from the mock until WF-064/065/066 wire them. Everything about other people must come back
// already redacted to the viewer's tier (FR-VIS-5, D41).

import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { minutesIntoDay, startOfWeek } from '@whosfree/ui/lib/time';
import type {
  Connection,
  FriendDetail,
  FriendRequest,
  GroupDetail,
  GroupSummary,
  Iso,
  OverlapWeek,
  Viewer,
} from '@/lib/types';
import { appUrl } from '@/lib/config';
import { hueFor } from '@/lib/hue';
import { rankSlots } from '@/lib/overlap';
import { createServerSupabase } from '@/lib/supabase/server';
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
} from '@/lib/social/mappers';
import { GROUPS, VIEWER } from '@/lib/mock/data';
import { statusAt } from '@/lib/mock/engine';
import {
  busyDays,
  connections,
  ctx,
  excludedPeople,
  findPerson,
  nextDates,
  toConnection,
  toGroupSummary as mockGroupSummary,
  toPerson,
  viewerGroups,
  visibleBlocks,
} from '@/lib/mock/selectors';

/**
 * The signed-in user, from their own users row (WF-004; RLS lets them read only that row).
 * proxy.ts guarantees the row exists before any app route renders.
 */
export async function getViewer(): Promise<Viewer> {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('users')
    .select('id, name, handle, timezone, sharing_paused')
    .eq('clerk_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Reading the viewer failed (${error.code})`);
  // proxy.ts creates the row first, so a missing one is a setup problem, not a user one.
  if (!data) throw new Error('No users row for this sign-in');

  // TODO(WF-064): the viewer's own status from their schedule (availability engine). Until
  // then it comes from the mock data, like everything on the Now screen.
  const { now, today, tz } = ctx();
  const s = statusAt(VIEWER, now, today, tz);
  return {
    id: data.id,
    name: data.name,
    handle: data.handle ?? '',
    hue: hueFor(data.id),
    timeZone: data.timezone,
    sharingPaused: data.sharing_paused,
    status: s.status,
    until: s.until,
  };
}

/** The "current time" screens should use. TODO(WF-064): `new Date()` once data is live. */
export async function getNow(): Promise<{ now: Iso; today: string; timeZone: string }> {
  const { now, today, tz } = ctx();
  return { now: now.toISOString(), today, timeZone: tz };
}

/**
 * Everyone the viewer can see on the Now screen, with status and "until X".
 * TODO(WF-064): call the `now_for_viewer` database function (already redacted), run
 * `availability.statusAt(now)` on the server, and subscribe to the viewer's Realtime
 * channel for "changed" signals (FR-VIEW-3).
 */
export async function getNowForViewer(): Promise<{
  connections: Connection[];
  groups: GroupSummary[];
}> {
  return {
    connections: connections().map(toConnection),
    groups: viewerGroups().map(mockGroupSummary),
  };
}

/**
 * The viewer's friends (FR-SOC-1), by name, each with the viewer's groups they're also in.
 * Status and tier fields wait for the Now data (PENDING_PRESENCE, TODO(WF-064)).
 */
export async function getFriends(): Promise<Connection[]> {
  const [friends, index] = await Promise.all([listFriends(), groupMembershipIndex()]);
  return friends.map((f) =>
    socialConnection(friendToPerson(f), { isFriend: true, groupIds: index.get(f.user_id) ?? [] }),
  );
}

/** Pending friend requests both ways, newest first (WF-042). */
export async function getFriendRequests(): Promise<FriendRequest[]> {
  return (await listFriendRequests()).map(toFriendRequest);
}

/**
 * A friend's detail: who they are, the groups you share and the tier you show them
 * (WF-042/043). Null if they aren't a friend (or either of you blocked the other).
 * TODO(WF-065): the timeline and "You're both free" come from `events_for_viewer` for today +
 * tomorrow, redacted on the server (FR-VIEW-4). Until then they're empty, as for someone
 * without a schedule.
 */
export async function getFriend(id: string): Promise<FriendDetail | null> {
  if (!isUuid(id)) return null;
  const [friends, groups, index] = await Promise.all([
    listFriends(),
    listMyGroups(),
    groupMembershipIndex(),
  ]);
  const row = friends.find((f) => f.user_id === id);
  if (!row) return null;
  const groupIds = index.get(id) ?? [];
  const shared = groups.filter((g) => groupIds.includes(g.id));
  const { today } = ctx();
  return {
    person: socialConnection(friendToPerson(row), { isFriend: true, groupIds }),
    timeline: nextDates(today, 2).map((date) => ({ date, blocks: [], hours: null })),
    sharedGroups: shared.map(toGroupSummary),
    viewerTierForThem: row.tier,
    groupTier: mostRestrictiveGroup(shared),
    freeTogether: [],
  };
}

/** The viewer's groups, oldest membership first (WF-043). */
export async function getGroups(): Promise<GroupSummary[]> {
  return (await listMyGroups()).map(toGroupSummary);
}

/**
 * One group with its members, their roles and permissions, the viewer's tier for it and an
 * invite link if the viewer may invite (WF-043/044/045). Null if the viewer isn't a member.
 * Being admin gives no extra visibility (FR-SOC-10): members carry no schedule data here.
 */
export async function getGroup(id: string): Promise<GroupDetail | null> {
  if (!isUuid(id)) return null;
  const [groups, members, friends] = await Promise.all([
    listMyGroups(),
    listGroupMembers(id),
    listFriends(),
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
  return {
    ...toGroupSummary(row),
    members: members.map((m) => {
      const member = toGroupMember(m, { isFriend: friendIds.has(m.user_id), groupIds: [id] });
      // The viewer's own status is already on the viewer (the sidebar shows the same).
      return m.is_me ? { ...member, tier: 3, status: viewer.status, until: viewer.until } : member;
    }),
    maxMembers: row.max_members,
    viewerPermissions: permissions,
    viewerTier: row.my_tier,
    invite: invite ? toGroupInvite(invite, appUrl()) : null,
  };
}

/**
 * Free/busy intervals for every member over a week, for the overlap week view.
 * Only times, never reasons (FR-SLOT-3). TODO(WF-066/WF-061): server-side intervals.
 */
export async function getGroupWeek(id: string, anyDateInWeek: string): Promise<OverlapWeek | null> {
  const g = GROUPS.find((x) => x.id === id && x.memberIds.includes(VIEWER.id));
  if (!g) return null;
  const weekStart = startOfWeek(anyDateInWeek);
  const members = g.memberIds.map(findPerson).filter((p) => p !== undefined);
  return {
    weekStart,
    days: busyDays(members, nextDates(weekStart, 7)),
    people: members.filter((p) => !p.paused && !p.noSchedule).map(toPerson),
    excluded: excludedPeople(members),
  };
}

/**
 * Ranked free slots for a group over the next `days` days, from now (powers "Next time
 * everyone's free" and "Best times this week"). TODO(WF-098): server-side slot finder.
 */
export async function getGroupUpcomingSlots(id: string, days = 7) {
  const g = GROUPS.find((x) => x.id === id && x.memberIds.includes(VIEWER.id));
  if (!g) return [];
  const { now, today, tz } = ctx();
  const members = g.memberIds.map(findPerson).filter((p) => p !== undefined);
  const byId = new Map(members.map((p) => [p.id, toPerson(p)]));
  return rankSlots(busyDays(members, nextDates(today, days)), {
    minDuration: 60,
    window: [8 * 60, 22 * 60],
    maxMissing: 1,
    notBefore: { date: today, minute: minutesIntoDay(now, tz) },
  }).map((s) => ({
    date: s.date,
    start: s.start,
    end: s.end,
    free: s.free.map((pid) => byId.get(pid)).filter((p) => p !== undefined),
    missing: s.missing.map((pid) => byId.get(pid)).filter((p) => p !== undefined),
  }));
}

/** Today's timeline for every member of a group (FR-VIEW-6), at each member's tier. */
export async function getGroupDay(id: string, date: string) {
  const g = GROUPS.find((x) => x.id === id && x.memberIds.includes(VIEWER.id));
  if (!g) return null;
  const members = g.memberIds.map(findPerson).filter((p) => p !== undefined);
  return {
    date,
    members: members.map((p) => ({
      person: toPerson(p),
      blocks: visibleBlocks(p, date),
      excluded: Boolean(p.paused || p.noSchedule),
    })),
    busy: busyDays(members, [date])[0]?.members ?? [],
  };
}
