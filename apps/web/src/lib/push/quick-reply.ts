// One-tap replies from a ping notification's action buttons (FR-PING-4, WF-093). Shared by the
// service worker (app/sw.ts) and the inbox page, so like payload.ts this file must stay
// dependency-free: the worker is bundled on its own.
//
// How it works, and why:
//   1. A `ping` notification (tag `ping:<ping id>`) gets one action button per quick reply,
//      where the platform supports them (Chrome on Android and desktop show the first two; iOS
//      shows none, and the reply buttons in the app cover it).
//   2. Tapping one makes the worker store `{ pingId, reply, at }` under a random one-time key in
//      the Cache API and open `/inbox?quick=<key>`.
//   3. The inbox page takes the entry (reading deletes it), checks it is fresh, and sends the
//      reply through the normal server action, signed in as usual.
//   The worker never calls the API itself: it has no fresh Clerk session token while the app is
//   closed. And the reply can't be triggered by a link: a URL holds only a random key, which
//   does nothing unless this browser's own worker stored it moments before. The entry holds no
//   ping text and no names, only the ping id and which reply was tapped.

/** The one-tap replies, in button order. Same as PING_REPLIES in @whosfree/shared (tested). */
export const PING_QUICK_REPLIES = ["I'm down", 'In 10', "Can't right now"] as const;
export type PingQuickReply = (typeof PING_QUICK_REPLIES)[number];

/** Cache API cache that holds pending quick replies for a moment. */
export const QUICK_REPLY_CACHE = 'whosfree-quick-replies';
/** The inbox URL parameter that names a pending quick reply. */
export const QUICK_REPLY_PARAM = 'quick';
/** A pending quick reply older than this is ignored (the tap was too long ago). */
export const QUICK_REPLY_MAX_AGE_MS = 5 * 60_000;

const ACTION_PREFIX = 'reply:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[0-9a-f-]{36}$/i;

/** The notification action id for the quick reply at `index`. */
export function quickReplyAction(index: number): string {
  return `${ACTION_PREFIX}${index}`;
}

/** The quick reply an action id stands for, or null. */
export function quickReplyFromAction(action: unknown): PingQuickReply | null {
  if (typeof action !== 'string' || !action.startsWith(ACTION_PREFIX)) return null;
  const digits = action.slice(ACTION_PREFIX.length);
  if (!/^\d$/.test(digits)) return null;
  return PING_QUICK_REPLIES[Number(digits)] ?? null;
}

/** The ping id in a ping notification's tag (`ping:<id>`), or null. */
export function pingIdFromTag(tag: unknown): string | null {
  if (typeof tag !== 'string' || !tag.startsWith('ping:')) return null;
  const id = tag.slice('ping:'.length);
  return UUID.test(id) ? id : null;
}

/** The same-origin request path a pending quick reply is stored under, or null for a bad key. */
export function quickReplyPath(key: unknown): string | null {
  return typeof key === 'string' && KEY.test(key) ? `/__quick-reply/${key}` : null;
}

export interface PendingQuickReply {
  pingId: string;
  reply: PingQuickReply;
  /** When the button was tapped, epoch ms. */
  at: number;
}

/** Reads a stored pending quick reply. Null when it isn't one, or is older than the max age. */
export function parsePendingQuickReply(raw: unknown, now: number): PendingQuickReply | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.pingId !== 'string' || !UUID.test(r.pingId)) return null;
  if (typeof r.reply !== 'string' || !(PING_QUICK_REPLIES as readonly string[]).includes(r.reply))
    return null;
  if (typeof r.at !== 'number' || !Number.isFinite(r.at)) return null;
  if (r.at > now + 60_000 || now - r.at > QUICK_REPLY_MAX_AGE_MS) return null;
  return { pingId: r.pingId, reply: r.reply as PingQuickReply, at: r.at };
}
