import { describe, expect, it } from 'vitest';
import { PING_REPLIES } from '@synkd/shared';
import {
  PING_QUICK_REPLIES,
  QUICK_REPLY_MAX_AGE_MS,
  parsePendingQuickReply,
  pingIdFromTag,
  quickReplyAction,
  quickReplyFromAction,
  quickReplyPath,
} from './quick-reply';

const PING_ID = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
const NOW = Date.parse('2026-10-05T14:00:00Z');

describe('quick replies from notification buttons (FR-PING-4, WF-093)', () => {
  it('are exactly PING_REPLIES, in order', () => {
    expect([...PING_QUICK_REPLIES]).toEqual([...PING_REPLIES]);
  });

  it('round-trip through the action id; anything else is ignored', () => {
    PING_QUICK_REPLIES.forEach((reply, i) =>
      expect(quickReplyFromAction(quickReplyAction(i))).toBe(reply),
    );
    for (const action of ['', 'reply:', 'reply:3', 'reply:-1', 'reply:1.5', 'open', 7, null])
      expect(quickReplyFromAction(action)).toBeNull();
  });

  it('read the ping id only from a ping tag', () => {
    expect(pingIdFromTag(`ping:${PING_ID}`)).toBe(PING_ID);
    for (const tag of [`reply:${PING_ID}`, 'ping:1', 'ping:', 'test', undefined])
      expect(pingIdFromTag(tag)).toBeNull();
  });

  it('store under a random key path; a mangled key gives nothing', () => {
    expect(quickReplyPath(PING_ID)).toBe(`/__quick-reply/${PING_ID}`);
    for (const key of ['../x', '', 'abc', `${PING_ID}/x`, null])
      expect(quickReplyPath(key)).toBeNull();
  });

  it('accept a fresh, well-formed pending reply only', () => {
    const pending = { pingId: PING_ID, reply: 'In 10', at: NOW - 1000 };
    expect(parsePendingQuickReply(pending, NOW)).toEqual(pending);
    for (const bad of [
      { ...pending, at: NOW - QUICK_REPLY_MAX_AGE_MS - 1 },
      { ...pending, at: NOW + 120_000 },
      { ...pending, reply: 'Sure!' },
      { ...pending, pingId: 'not-a-uuid' },
      { ...pending, at: 'now' },
      null,
      'x',
    ])
      expect(parsePendingQuickReply(bad, NOW)).toBeNull();
  });
});
