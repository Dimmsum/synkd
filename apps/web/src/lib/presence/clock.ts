// The Now screen's client timer (PRD §8.5 step 4, WF-064): the server sends each person's status
// now plus how it changes over the next day (`Connection.upcoming`), and the client moves people
// between sections as "until X" passes, without polling the server. Pure, for tests.

import { FREE_SOON_MINUTES } from '@/lib/now-sections';
import type { Connection, PresenceChange } from '@/lib/types';

/** `c` as of `t` (UTC epoch ms): the latest of its upcoming changes that has started applies. */
export function presenceAt<C extends Connection>(c: C, t: number): C {
  let latest: PresenceChange | undefined;
  for (const change of c.upcoming ?? []) {
    if (Date.parse(change.at) > t) break;
    latest = change;
  }
  if (!latest) return c;
  const { at: _at, ...presence } = latest;
  const next: C = { ...c, ...presence };
  // The reason belongs to the old status: a change without one clears it.
  if (!presence.activity) delete next.activity;
  return next;
}

/**
 * The next moment after `t` at which something on the Now screen changes on its own: someone's
 * status changes, someone comes within the "Free soon" window, or the client runs out of what it
 * was sent and must re-fetch. `null` when nothing is due.
 */
export function nextChangeAt(
  connections: readonly Connection[],
  t: number,
  freeSoonMinutes = FREE_SOON_MINUTES,
): number | null {
  let next = Infinity;
  const consider = (instant: string | null | undefined, offsetMs = 0) => {
    if (!instant) return;
    const at = Date.parse(instant) - offsetMs;
    if (at > t && at < next) next = at;
  };
  for (const c of connections) {
    for (const change of c.upcoming ?? []) {
      consider(change.at);
      // Each upcoming state may enter "Free soon" before it ends.
      consider(change.nextFreeAt, freeSoonMinutes * 60_000);
    }
    consider(c.nextFreeAt, freeSoonMinutes * 60_000);
    consider(c.refreshAt);
  }
  return Number.isFinite(next) ? next : null;
}

/** True once `t` has passed what the client was sent for someone, so it must re-fetch. */
export function needsRefetch(connections: readonly Connection[], t: number): boolean {
  return connections.some((c) => c.refreshAt != null && Date.parse(c.refreshAt) <= t);
}
