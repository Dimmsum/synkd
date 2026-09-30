// Data access for the viewer, the Now screen, friends and groups.
//
// Screens call these async functions and never touch lib/mock directly. Today they read
// mock data; when wiring, keep the signatures and swap the bodies for server calls made
// as the signed-in user (Clerk token → Supabase RLS). Everything about other people must
// come back already redacted to the viewer's tier (FR-VIS-5, D41).

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
import { rankSlots } from '@/lib/overlap';
import { FRIEND_REQUESTS, GROUPS, PEOPLE, VIEWER } from '@/lib/mock/data';
import { statusAt } from '@/lib/mock/engine';
import {
  busyDays,
  connections,
  ctx,
  excludedPeople,
  findPerson,
  groupsOf,
  minutesAgo,
  nextDates,
  toConnection,
  toGroupDetail,
  toGroupSummary,
  toPerson,
  viewerGroups,
  visibleBlocks,
} from '@/lib/mock/selectors';

/** The signed-in user. TODO(WF-004, WF-040): read from Clerk + the users row. */
export async function getViewer(): Promise<Viewer> {
  const { now, today, tz } = ctx();
  const s = statusAt(VIEWER, now, today, tz);
  return {
    ...toPerson(VIEWER),
    timeZone: tz,
    sharingPaused: false,
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
    groups: viewerGroups().map(toGroupSummary),
  };
}

/** TODO(WF-042): friends list query. */
export async function getFriends(): Promise<Connection[]> {
  return PEOPLE.filter((p) => p.isFriend).map(toConnection);
}

/** TODO(WF-042): friend requests query. */
export async function getFriendRequests(): Promise<FriendRequest[]> {
  return FRIEND_REQUESTS.map((r) => ({
    id: r.id,
    person: r.person,
    direction: r.direction,
    sentAt: minutesAgo(r.minutesAgo),
  }));
}

/**
 * A friend's detail: today's and tomorrow's timeline at the viewer's tier (FR-VIEW-4).
 * TODO(WF-065): `events_for_viewer` for today + tomorrow, redacted on the server.
 */
export async function getFriend(id: string): Promise<FriendDetail | null> {
  const p = findPerson(id);
  if (!p || !p.isFriend) return null;
  const { today, now, tz } = ctx();
  const dates = nextDates(today, 2);
  const week = nextDates(today, 7);
  const together = rankSlots(busyDays([VIEWER, p], week), {
    minDuration: 60,
    window: [8 * 60, 22 * 60],
    maxMissing: 0,
    notBefore: { date: today, minute: minutesIntoDay(now, tz) },
  });
  return {
    person: toConnection(p),
    timeline: dates.map((date) => ({
      date,
      blocks: visibleBlocks(p, date),
      hours: p.paused || p.noSchedule ? null : p.hours,
    })),
    sharedGroups: groupsOf(p.id).map(toGroupSummary),
    viewerTierForThem: p.viewerTier,
    groupTier: (() => {
      const g = [...groupsOf(p.id)].sort((a, b) => a.viewerTier - b.viewerTier)[0];
      return g ? { tier: g.viewerTier, groupName: g.name } : null;
    })(),
    freeTogether: (p.paused || p.noSchedule ? [] : together)
      .slice(0, 3)
      .map((s) => ({ date: s.date, start: s.start, end: s.end })),
  };
}

/** TODO(WF-043): the viewer's groups. */
export async function getGroups(): Promise<GroupSummary[]> {
  return viewerGroups().map(toGroupSummary);
}

/**
 * One group with members at each member's chosen tier. Being admin gives no extra
 * visibility (FR-SOC-10). TODO(WF-043, WF-044): group + members query.
 */
export async function getGroup(id: string): Promise<GroupDetail | null> {
  const g = GROUPS.find((x) => x.id === id && x.memberIds.includes(VIEWER.id));
  return g ? toGroupDetail(g) : null;
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
