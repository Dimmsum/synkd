import type { Ping } from '@/lib/types';
import { GROUPS, PINGS, VIEWER } from '@/lib/mock/data';
import { findPerson, minutesAgo, toGroupSummary, toPerson } from '@/lib/mock/selectors';

/** Pings expire after 2 hours (FR-PING-9). */
const PING_TTL_MIN = 120;

function toPing(p: (typeof PINGS)[number]): Ping {
  const from = findPerson(p.fromId);
  if (!from) throw new Error('unknown sender');
  const toId = p.toId;
  const group = typeof toId === 'object' ? GROUPS.find((g) => g.id === toId.groupId) : null;
  const toPersonRecord = typeof toId === 'string' ? findPerson(toId) : null;
  return {
    id: p.id,
    from: toPerson(from),
    to: group ? { group: toGroupSummary(group) } : toPerson(toPersonRecord ?? from),
    template: p.template,
    text: p.text,
    sentAt: minutesAgo(p.minutesAgo),
    expiresAt: minutesAgo(p.minutesAgo - PING_TTL_MIN),
    reply: p.replies?.map((r) => {
      const who = findPerson(r.fromId);
      return {
        from: who ? toPerson(who) : toPerson(from),
        reply: r.reply,
        text: r.text,
        at: minutesAgo(r.minutesAgo),
      };
    }),
    read: p.read,
  };
}

/**
 * Received and sent pings, newest first (WF-092, FR-PING-3).
 * TODO(WF-092): query pings (RLS: only sender and recipient can read) and subscribe to
 * Realtime for new ones.
 */
export async function getInbox(): Promise<{ received: Ping[]; sent: Ping[] }> {
  return {
    received: PINGS.filter((p) => p.toId === VIEWER.id).map(toPing),
    sent: PINGS.filter((p) => p.fromId === VIEWER.id).map(toPing),
  };
}

export async function getUnreadCount(): Promise<number> {
  return PINGS.filter((p) => p.toId === VIEWER.id && !p.read).length;
}
