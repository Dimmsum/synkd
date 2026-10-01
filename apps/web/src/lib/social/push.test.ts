import { describe, expect, it } from 'vitest';
import { PUSH_LIMITS, parsePushPayload, serializePushPayload } from '@/lib/push/payload';
import { friendAcceptedPushPayload, friendRequestPushPayload } from './push';

describe('friend request push payloads (WF-042)', () => {
  it('a new request names the sender and opens Friends', () => {
    const payload = friendRequestPushPayload('Kemar Brown');
    expect(payload).toEqual({
      v: 1,
      kind: 'friend_request',
      title: 'Kemar Brown wants to be friends',
      body: 'Choose what they can see before you accept.',
      url: '/friends',
      tag: 'friend_request',
    });
    expect(parsePushPayload(payload)).toEqual(payload);
  });

  it('an accepted request names who accepted', () => {
    expect(friendAcceptedPushPayload('Shanice')).toMatchObject({
      kind: 'friend_request',
      title: 'Shanice accepted your friend request',
      url: '/friends',
    });
  });

  it('long or odd names still fit, on one line', () => {
    for (const build of [friendRequestPushPayload, friendAcceptedPushPayload]) {
      const long = build('🍗'.repeat(200));
      expect(() => serializePushPayload(long)).not.toThrow();
      expect([...long.title].length).toBeLessThanOrEqual(PUSH_LIMITS.title);
      expect(build('Ke\nmar\u0007').title).toMatch(/^Ke mar /);
      expect(build('   ').title).toMatch(/^Someone /);
    }
  });

  it('carries no ids', () => {
    const json = JSON.stringify([friendRequestPushPayload('A'), friendAcceptedPushPayload('B')]);
    expect(json).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});
