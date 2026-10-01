// What a Web Push message carries (WF-091, FR-PING-3). Shared by the server (lib/push/send.ts,
// which builds it) and the service worker (app/sw.ts, which shows it), so this file must stay
// dependency-free: the worker is bundled separately with esbuild.
//
// Keep payloads minimal. The push service can't read them (they are encrypted to the device,
// RFC 8291), but they end up on a lock screen, so they hold only what the notification shows:
// a title, an optional short body, where tapping it goes, and a collapse tag. Never ids of
// other people, schedules, event titles or anything location-like (D35, NFR-SEC-1).
//
// For WF-092 (pings), e.g.:
//   { v: 1, kind: 'ping', title: 'Kemar pinged you', body: 'Free for food?', url: '/inbox',
//     tag: 'ping:<ping id>' }
// `body` is the template and/or the free text (plain text; notifications never render HTML or
// make links clickable, matching D31). Ping text must never be logged (NFR-SEC-11).

/** Payload format version, so the worker can tell old and new messages apart. */
export const PUSH_PAYLOAD_VERSION = 1;

/** What a notification is about. The worker treats all of them the same for now. */
export const PUSH_KINDS = [
  'ping', // WF-092
  'ping_reply', // WF-093
  'friend_request', // WF-115 "Friend requests"
  'group', // WF-115 "Group joins and invites"
  'schedule_reminder', // WF-115 "Schedule ending reminders"
  'test', // "Send a test notification" to your own devices
] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

/** Length limits, in characters. The body fits a 140-character ping plus a template. */
export const PUSH_LIMITS = { title: 80, body: 200, url: 512, tag: 64 } as const;

export interface PushPayload {
  v: typeof PUSH_PAYLOAD_VERSION;
  kind: PushKind;
  title: string;
  body?: string;
  /** A same-origin path to open on tap, e.g. `/inbox`. */
  url: string;
  /** Collapse key: a newer notification with the same tag replaces the older one. */
  tag?: string;
}

/** Where a notification goes when its payload can't be read or names no safe path. */
export const DEFAULT_PUSH_URL = '/inbox';

/**
 * Shown when a push arrives without a readable payload. Browsers require every push to show a
 * notification (`userVisibleOnly`), and Safari revokes the subscription after silent pushes, so
 * the worker never drops one.
 */
export const FALLBACK_PUSH: PushPayload = {
  v: PUSH_PAYLOAD_VERSION,
  kind: 'ping',
  title: "Who's Free",
  body: 'You have something new. Open the app to see it.',
  url: DEFAULT_PUSH_URL,
};

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/**
 * `url` if it is a path on this site (`/inbox`, `/friends/abc?x=1`), else null. Rejects
 * absolute URLs, protocol-relative `//host`, backslash tricks and control characters, so a
 * notification can never open another site.
 */
export function safeAppPath(url: unknown): string | null {
  if (typeof url !== 'string' || url.length === 0 || url.length > PUSH_LIMITS.url) return null;
  if (!url.startsWith('/') || url.startsWith('//') || url.includes('\\')) return null;
  if (CONTROL.test(url) || /\s/.test(url)) return null;
  return url;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || [...trimmed].length > max || CONTROL.test(trimmed)) return null;
  return trimmed;
}

/** Reads a payload (already JSON-parsed). Null when it isn't one we can show safely. */
export function parsePushPayload(raw: unknown): PushPayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== PUSH_PAYLOAD_VERSION) return null;
  if (typeof r.kind !== 'string' || !(PUSH_KINDS as readonly string[]).includes(r.kind)) {
    return null;
  }
  const title = text(r.title, PUSH_LIMITS.title);
  const url = safeAppPath(r.url);
  if (title === null || url === null) return null;

  const payload: PushPayload = { v: PUSH_PAYLOAD_VERSION, kind: r.kind as PushKind, title, url };
  if (r.body !== undefined) {
    const body = text(r.body, PUSH_LIMITS.body);
    if (body === null) return null;
    payload.body = body;
  }
  if (r.tag !== undefined) {
    if (
      typeof r.tag !== 'string' ||
      r.tag.length === 0 ||
      r.tag.length > PUSH_LIMITS.tag ||
      !/^[A-Za-z0-9:_-]+$/.test(r.tag)
    ) {
      return null;
    }
    payload.tag = r.tag;
  }
  return payload;
}

/** Reads the raw text of a push message. Null for anything that isn't a valid payload. */
export function parsePushText(data: string | null | undefined): PushPayload | null {
  if (!data) return null;
  try {
    return parsePushPayload(JSON.parse(data));
  } catch {
    return null;
  }
}

/**
 * The JSON to send, after checking it the same way the worker will, so a bad payload fails on
 * the server instead of turning into the fallback text on the phone. Throws on an invalid one.
 */
export function serializePushPayload(payload: PushPayload): string {
  const checked = parsePushPayload(payload);
  if (checked === null) throw new Error('Invalid push payload');
  return JSON.stringify(checked);
}
