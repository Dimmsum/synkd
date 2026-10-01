import { describe, expect, it } from 'vitest';
import type { Connection } from '@/lib/types';
import { filterByGroup, freeNowByGroup, groupIntoNowSections, isFreeSoon } from './now-sections';

const now = new Date('2026-09-30T19:30:00Z');
const inMin = (m: number) => new Date(now.getTime() + m * 60_000).toISOString();

function person(id: string, over: Partial<Connection>): Connection {
  return {
    id,
    name: id,
    handle: id,
    hue: 0,
    isFriend: true,
    tier: 1,
    status: 'free',
    until: inMin(60),
    nextFreeAt: null,
    stale: false,
    groupIds: [],
    ...over,
  };
}

describe('groupIntoNowSections', () => {
  const people = [
    person('free-short', { status: 'free', until: inMin(30) }),
    person('free-long', { status: 'free', until: inMin(240) }),
    person('soon-late', { status: 'busy', until: inMin(55), nextFreeAt: inMin(55) }),
    person('soon-early', { status: 'away', until: inMin(10), nextFreeAt: inMin(10) }),
    person('busy-long', { status: 'busy', until: inMin(300), nextFreeAt: inMin(300) }),
    person('dnd', { status: 'dnd', until: inMin(120), nextFreeAt: inMin(120) }),
    person('paused', { status: 'paused', until: null }),
    person('no-schedule', { status: 'no_schedule', until: null }),
  ];
  const s = groupIntoNowSections(people, now);
  const ids = (list: Connection[]) => list.map((c) => c.id);

  it('puts free people first, longest free time first', () => {
    expect(ids(s.freeNow)).toEqual(['free-long', 'free-short']);
  });

  it('treats people free within 60 minutes as free soon, soonest first', () => {
    expect(ids(s.freeSoon)).toEqual(['soon-early', 'soon-late']);
  });

  it('keeps busy, away and do-not-disturb together, free again soonest first', () => {
    expect(ids(s.busyAway)).toEqual(['dnd', 'busy-long']);
  });

  it('groups no schedule and paused as not sharing yet', () => {
    expect(ids(s.notSharing)).toEqual(['no-schedule', 'paused']);
  });

  it('uses an inclusive 60-minute window', () => {
    expect(isFreeSoon(person('x', { status: 'busy', nextFreeAt: inMin(60) }), now)).toBe(true);
    expect(isFreeSoon(person('x', { status: 'busy', nextFreeAt: inMin(61) }), now)).toBe(false);
  });

  it('puts someone whose status is unknown last in busy/away, never in not sharing (WF-064)', () => {
    const s2 = groupIntoNowSections(
      [
        person('unknown', { status: 'unknown', until: null, nextFreeAt: null }),
        person('busy', { status: 'busy', until: inMin(30), nextFreeAt: inMin(90) }),
      ],
      now,
    );
    expect(ids(s2.busyAway)).toEqual(['busy', 'unknown']);
    expect(s2.notSharing).toEqual([]);
  });
});

describe('filterByGroup', () => {
  it('keeps only members of the group, or everyone when no group is picked', () => {
    const a = person('a', { groupIds: ['flat-4'] });
    const b = person('b', { groupIds: ['netball'] });
    expect(filterByGroup([a, b], 'flat-4')).toEqual([a]);
    expect(filterByGroup([a, b], null)).toEqual([a, b]);
  });
});

describe('freeNowByGroup', () => {
  it('counts free people per group', () => {
    const counts = freeNowByGroup([
      person('a', { status: 'free', groupIds: ['flat-4', 'netball'] }),
      person('b', { status: 'free', groupIds: ['flat-4'] }),
      person('c', { status: 'busy', groupIds: ['flat-4'] }),
      person('d', { status: 'free', groupIds: [] }),
    ]);
    expect(Object.fromEntries(counts)).toEqual({ 'flat-4': 2, netball: 1 });
  });
});
