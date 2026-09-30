import { minutesIntoDay, startOfWeek } from '@whosfree/ui/lib/time';
import { rankSlots } from '@/lib/overlap';
import type { OverlapWeek, Person, Slot } from '@/lib/types';
import { GROUPS, VIEWER, type MockPerson } from '@/lib/mock/data';
import {
  busyDays,
  ctx,
  excludedPeople,
  findPerson,
  nextDates,
  toPerson,
} from '@/lib/mock/selectors';

export interface SlotQuery {
  groupId?: string;
  personIds?: string[];
  /** First day, `YYYY-MM-DD`. */
  from: string;
  /** 1–14 days (FR-SLOT-1). */
  days: number;
  minDuration: number;
  /** Time-of-day window in local minutes. */
  window: [number, number];
}

export interface SlotResult {
  participants: Person[];
  excluded: OverlapWeek['excluded'];
  slots: Slot[];
  week: OverlapWeek;
}

/**
 * Ranked shared free slots (FR-SLOT-1..4): everyone first (soonest, then longest), then
 * "all but N" naming who can't make it. People without a schedule or with sharing paused
 * are flagged and left out. Only *when* people are free is returned, never why.
 * TODO(WF-098): call the server-side slot finder (packages/availability, ≤ 1 s for 20
 * people over 14 days, NFR-PERF-5) with the same inputs.
 */
export async function findSlots(q: SlotQuery): Promise<SlotResult> {
  const { now, today, tz } = ctx();
  const group = q.groupId ? GROUPS.find((g) => g.id === q.groupId) : undefined;
  const ids = group ? group.memberIds : [VIEWER.id, ...(q.personIds ?? [])];
  const people = [...new Set(ids)]
    .slice(0, 20)
    .map(findPerson)
    .filter((p): p is MockPerson => Boolean(p));
  const usable = people.filter((p) => !p.paused && !p.noSchedule);
  const byId = new Map(
    usable.map((p) => [p.id, p.id === VIEWER.id ? { ...toPerson(p), name: 'You' } : toPerson(p)]),
  );
  const toPeople = (list: string[]) =>
    list.map((id) => byId.get(id)).filter((p): p is Person => Boolean(p));

  const days = Math.min(Math.max(q.days, 1), 14);
  const ranked = rankSlots(busyDays(people, nextDates(q.from, days)), {
    minDuration: q.minDuration,
    window: q.window,
    maxMissing: usable.length > 3 ? 2 : usable.length > 2 ? 1 : 0,
    notBefore: { date: today, minute: minutesIntoDay(now, tz) },
  });

  const weekStart = startOfWeek(q.from);
  return {
    participants: usable.map(toPerson),
    excluded: excludedPeople(people),
    slots: ranked.slice(0, 12).map((s) => ({
      date: s.date,
      start: s.start,
      end: s.end,
      free: toPeople(s.free),
      missing: toPeople(s.missing),
    })),
    week: {
      weekStart,
      days: busyDays(people, nextDates(weekStart, 7)),
      people: usable.map(toPerson),
      excluded: excludedPeople(people),
    },
  };
}
