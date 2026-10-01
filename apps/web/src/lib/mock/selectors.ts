// Builds view models from the mock data. Only lib/data/* should import this.
// The Now screen, statuses and the viewer are real since WF-064. What's left feeds the screens
// that aren't wired yet: My schedule and group week/day timelines (WF-065/066), the slot
// finder (WF-098), the inbox (WF-092) and "Who can see me" (WF-048).
// Delete each part with the issue that replaces it.

import { DEFAULT_TIMEZONE } from '@whosfree/shared';
import { addDays, dateKey } from '@whosfree/ui/lib/time';
import type { GroupSummary, MemberBusyDay, Person, VisibleBlock } from '@/lib/types';
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
