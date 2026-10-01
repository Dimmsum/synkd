// Web Push payloads for friend requests (WF-042, WF-091; FR-SOC-1, FR-PING-3). Pure, so the
// limits in lib/push/payload.ts are unit-tested here.
//
// Who is notified is decided by Postgres (D41): the actions only notify the person a database
// function has just accepted a request to or from, as the signed-in user (send_friend_request,
// accept_friend_request, request_friend_by_invite check blocks and limits first).
//
// Like a ping ("Kemar pinged you"), the title names the person acting, and nothing else: no ids,
// handles, tiers or schedules. Taps open Friends, where the request is.

import { PUSH_LIMITS, PUSH_PAYLOAD_VERSION, type PushPayload } from '@/lib/push/payload';

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/g;

/** Room left for a name in "<name> accepted your friend request" (80 characters in all). */
const NAME_MAX = PUSH_LIMITS.title - ' accepted your friend request'.length;

/** `name` on one line without control characters, cut to fit the title with an ellipsis. */
function fitName(name: string): string {
  const clean = name.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...clean];
  if (chars.length === 0) return 'Someone';
  return chars.length <= NAME_MAX
    ? clean
    : `${chars
        .slice(0, NAME_MAX - 1)
        .join('')
        .trimEnd()}…`;
}

/** To the recipient of a new request: "Kemar wants to be friends". */
export function friendRequestPushPayload(senderName: string): PushPayload {
  return {
    v: PUSH_PAYLOAD_VERSION,
    kind: 'friend_request',
    title: `${fitName(senderName)} wants to be friends`,
    body: 'Choose what they can see before you accept.',
    url: '/friends',
    tag: 'friend_request',
  };
}

/** To the person whose request was accepted: "Kemar accepted your friend request". */
export function friendAcceptedPushPayload(accepterName: string): PushPayload {
  return {
    v: PUSH_PAYLOAD_VERSION,
    kind: 'friend_request',
    title: `${fitName(accepterName)} accepted your friend request`,
    url: '/friends',
    tag: 'friend_accepted',
  };
}
