// Builds view models from the mock data. Only lib/data/* should import this.
// TODO(WF-064): delete with the rest of lib/mock.

import {
  DEFAULT_MEMBER_PERMISSIONS,
  DEFAULT_TIMEZONE,
  type GroupPermissions,
} from '@whosfree/shared';
import { addDays, dateKey } from '@whosfree/ui/lib/time';
import type {
  Connection,
  GroupDetail,
  GroupMember,
  GroupSummary,
  MemberBusyDay,
  Person,
  VisibleBlock,
} from '@/lib/types';
import { getMockNow } from './clock';
import { GROUPS, PEOPLE, VIEWER, type MockGroup, type MockPerson } from './data';
import { busyIntervals, eventsOn, redact, statusAt } from './engine';

export const TZ = DEFAULT_TIMEZONE;

export function ctx() {
  const now = getMockNow();
  return { now, today: dateKey(now, TZ), tz: TZ };
}

const ALL = [VIEWER, ...PEOPLE];
export const findPerson = (id: string): MockPerson | undefined => ALL.find((p) => p.id === id);
export const toPerson = (p: MockPerson): Person => ({
  id: p.id,
  name: p.name,
  handle: p.handle,
  hue: p.hue,
});

export const viewerGroups = () => GROUPS.filter((g) => g.memberIds.includes(VIEWER.id));
export const groupsOf = (id: string) => viewerGroups().filter((g) => g.memberIds.includes(id));

export function toConnection(p: MockPerson): Connection {
  const { now, today, tz } = ctx();
  const s = statusAt(p, now, today, tz);
  return {
    ...toPerson(p),
    isFriend: p.isFriend,
    tier: p.tierForViewer,
    status: s.status,
    until: s.until,
    nextFreeAt: s.nextFreeAt,
    activity: redact(s.activity, p.tierForViewer),
    stale: Boolean(p.stale),
    groupIds: groupsOf(p.id).map((g) => g.id),
  };
}

/** Friends plus fellow group members (FR-SOC-5), without the viewer. */
export function connections(): MockPerson[] {
  const inGroups = new Set(viewerGroups().flatMap((g) => g.memberIds));
  return PEOPLE.filter((p) => p.isFriend || inGroups.has(p.id));
}

export function toGroupSummary(g: MockGroup): GroupSummary {
  const members = g.memberIds.map(findPerson).filter((p): p is MockPerson => Boolean(p));
  return {
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    memberCount: g.memberIds.length,
    freeNowCount: members.filter((m) => toStatus(m) === 'free').length,
    viewerRole: g.adminId === VIEWER.id ? 'admin' : 'member',
  };
}

function toStatus(p: MockPerson) {
  const { now, today, tz } = ctx();
  return statusAt(p, now, today, tz).status;
}

const ALL_PERMISSIONS: GroupPermissions = {
  invite: true,
  manageMembers: true,
  editGroup: true,
  groupPing: true,
};

export function permissionsFor(g: MockGroup, id: string): GroupPermissions {
  if (g.adminId === id) return ALL_PERMISSIONS; // FR-SOC-9
  return { ...DEFAULT_MEMBER_PERMISSIONS, ...g.permissions?.[id] };
}

export function toGroupDetail(g: MockGroup): GroupDetail {
  const members: GroupMember[] = g.memberIds
    .map(findPerson)
    .filter((p): p is MockPerson => Boolean(p))
    .map((p) => ({
      ...(p.id === VIEWER.id ? viewerAsConnection() : toConnection(p)),
      role: g.adminId === p.id ? 'admin' : 'member',
      permissions: permissionsFor(g, p.id),
      isViewer: p.id === VIEWER.id,
    }));
  return {
    ...toGroupSummary(g),
    members,
    maxMembers: g.maxMembers,
    viewerPermissions: permissionsFor(g, VIEWER.id),
    viewerTier: g.viewerTier,
    invite: g.inviteCode
      ? {
          code: g.inviteCode,
          url: `https://whosfree.app/i/${g.inviteCode}`,
          expiresAt: null,
          maxUses: null,
          uses: g.memberIds.length - 1,
        }
      : null,
  };
}

export function viewerAsConnection(): Connection {
  const { now, today, tz } = ctx();
  const s = statusAt(VIEWER, now, today, tz);
  return {
    ...toPerson(VIEWER),
    isFriend: false,
    tier: 3,
    status: s.status,
    until: s.until,
    nextFreeAt: s.nextFreeAt,
    activity: s.activity,
    stale: false,
    groupIds: viewerGroups().map((g) => g.id),
  };
}

/** A person's busy blocks on a date, redacted to `tier` (the viewer sees their own in full). */
export function visibleBlocks(p: MockPerson, date: string): VisibleBlock[] {
  const { today } = ctx();
  const tier = p.id === VIEWER.id ? 3 : p.tierForViewer;
  if (p.paused || p.noSchedule) return [];
  return eventsOn(p, date, today).map((e) => ({
    start: e.start,
    end: e.end,
    ...redact({ category: e.category, title: e.title }, tier),
  }));
}

/** Busy intervals per member for the overlap views. Times only (FR-SLOT-3). */
export function busyDays(people: MockPerson[], dates: string[]) {
  const { today } = ctx();
  const usable = people.filter((p) => !p.paused && !p.noSchedule);
  return dates.map((date) => ({
    date,
    members: usable.map((p): MemberBusyDay => ({
      personId: p.id,
      busy: busyIntervals(p, date, today),
    })),
  }));
}

export function excludedPeople(people: MockPerson[]) {
  return people
    .filter((p) => p.paused || p.noSchedule)
    .map((p) => ({
      person: toPerson(p),
      reason: p.paused ? ('paused' as const) : ('no_schedule' as const),
    }));
}

export const nextDates = (from: string, n: number) =>
  Array.from({ length: n }, (_, i) => addDays(from, i));

export const minutesAgo = (m: number) => new Date(ctx().now.getTime() - m * 60_000).toISOString();
