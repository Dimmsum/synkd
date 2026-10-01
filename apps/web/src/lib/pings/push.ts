// The Web Push payloads for a ping (WF-092) and a reply (WF-093), built from what the database
// functions return (D41: `send_ping`/`reply_to_ping` authorise and return the recipient). Pure,
// so the limits in lib/push/payload.ts are unit-tested here.
//
// The payload ends up on a lock screen, so it holds only what the notification shows: who, the
// template and/or text (plain text, D31), where tapping goes, and a collapse tag. The text is
// never logged (NFR-SEC-11); sendPushToUser logs only counts and statuses.

import { PUSH_LIMITS, PUSH_PAYLOAD_VERSION, type PushPayload } from '@/lib/push/payload';

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/g;
/** Control characters except tab and newline, which a body may keep. */
// eslint-disable-next-line no-control-regex
const BODY_CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/** `text` on one line without control characters, cut to `max` characters with an ellipsis. */
function fit(text: string, max: number): string {
  const clean = text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...clean];
  return chars.length <= max
    ? clean
    : `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`;
}

/** Body text: may keep newlines (notifications show them as line breaks). */
function fitBody(parts: (string | null | undefined)[]): string | undefined {
  const text = parts
    .map((p) => p?.replace(/\r\n?/g, '\n').replace(BODY_CONTROL, ' '))
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
    .join(' · ');
  if (!text) return undefined;
  const chars = [...text];
  return chars.length <= PUSH_LIMITS.body
    ? text
    : `${chars
        .slice(0, PUSH_LIMITS.body - 1)
        .join('')
        .trimEnd()}…`;
}

/** Room left for a name in "<name> pinged you" / "<name> replied". */
const NAME_MAX = 60;

/** "Kemar pinged you", with the template and/or text as the body. Taps open the inbox. */
export function pingPushPayload(input: {
  pingId: string;
  senderName: string;
  template?: string | null;
  text?: string | null;
}): PushPayload {
  return {
    v: PUSH_PAYLOAD_VERSION,
    kind: 'ping',
    title: `${fit(input.senderName, NAME_MAX) || 'Someone'} pinged you`,
    body: fitBody([input.template, input.text]),
    url: '/inbox',
    // The worker reads the ping id from this tag to offer one-tap replies (lib/push/quick-reply).
    tag: `ping:${input.pingId}`,
  };
}

/** "Kemar replied", with the reply as the body. Taps open the inbox's Sent tab. */
export function replyPushPayload(input: {
  pingId: string;
  replierName: string;
  reply?: string | null;
  text?: string | null;
}): PushPayload {
  return {
    v: PUSH_PAYLOAD_VERSION,
    kind: 'ping_reply',
    title: `${fit(input.replierName, NAME_MAX) || 'Someone'} replied`,
    body: fitBody([input.reply ?? input.text]),
    url: '/inbox?tab=sent',
    tag: `reply:${input.pingId}`,
  };
}
