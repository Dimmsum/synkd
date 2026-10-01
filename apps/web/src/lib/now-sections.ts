import type { Connection, GroupId } from '@/lib/types';

/** "Free soon" means free within this many minutes (FR-VIEW-1). */
export const FREE_SOON_MINUTES = 60;

export interface NowSections {
  freeNow: Connection[];
  freeSoon: Connection[];
  busyAway: Connection[];
  notSharing: Connection[];
}

const ms = (iso: string | null) => (iso ? Date.parse(iso) : Infinity);
const byName = (a: Connection, b: Connection) => a.name.localeCompare(b.name);

export function isFreeSoon(c: Connection, now: Date, windowMinutes = FREE_SOON_MINUTES): boolean {
  if (c.status !== 'busy' && c.status !== 'away' && c.status !== 'dnd') return false;
  if (!c.nextFreeAt) return false;
  const wait = ms(c.nextFreeAt) - now.getTime();
  return wait >= 0 && wait <= windowMinutes * 60_000;
}

/**
 * Splits connections into the Now screen's sections (FR-VIEW-1):
 * - Free now: longest free time first.
 * - Free soon (within 60 min): soonest first.
 * - Busy/Away (including Do not disturb): free again soonest first. Anyone whose status
 *   couldn't be worked out (`unknown`, WF-064) goes last here: it isn't "not sharing".
 * - Not sharing yet: no schedule, then paused ("Sharing paused").
 */
export function groupIntoNowSections(connections: Connection[], now: Date): NowSections {
  const s: NowSections = { freeNow: [], freeSoon: [], busyAway: [], notSharing: [] };
  for (const c of connections) {
    if (c.status === 'free') s.freeNow.push(c);
    else if (c.status === 'no_schedule' || c.status === 'paused') s.notSharing.push(c);
    else if (isFreeSoon(c, now)) s.freeSoon.push(c);
    else s.busyAway.push(c);
  }
  s.freeNow.sort((a, b) => ms(b.until) - ms(a.until) || byName(a, b));
  s.freeSoon.sort((a, b) => ms(a.nextFreeAt) - ms(b.nextFreeAt) || byName(a, b));
  s.busyAway.sort((a, b) => ms(a.until) - ms(b.until) || byName(a, b));
  s.notSharing.sort(
    (a, b) => Number(a.status === 'paused') - Number(b.status === 'paused') || byName(a, b),
  );
  return s;
}

/** The Now screen's group filter (FR-VIEW-2). */
export function filterByGroup(connections: Connection[], groupId: GroupId | null): Connection[] {
  return groupId ? connections.filter((c) => c.groupIds.includes(groupId)) : connections;
}

/**
 * How many of the viewer's connections in each group are free right now (the groups rail and
 * group pages). Counts other members only; the viewer has their own status chip.
 */
export function freeNowByGroup(connections: readonly Connection[]): Map<GroupId, number> {
  const counts = new Map<GroupId, number>();
  for (const c of connections) {
    if (c.status !== 'free') continue;
    for (const g of c.groupIds) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return counts;
}
