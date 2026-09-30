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
 * - Busy/Away (including Do not disturb): free again soonest first.
 * - Not sharing yet: no schedule, then paused.
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
