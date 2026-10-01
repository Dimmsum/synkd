import { describe, expect, it } from 'vitest';
import { PING_TEXT_MAX_LENGTH, PING_TEMPLATES } from '@whosfree/shared';
import { PUSH_LIMITS, parsePushPayload, serializePushPayload } from '@/lib/push/payload';
import { pingIdFromTag } from '@/lib/push/quick-reply';
import { pingPushPayload, replyPushPayload } from './push';

const PING_ID = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';

describe('pingPushPayload (WF-092)', () => {
  it('names the sender, shows the template and text, opens the inbox', () => {
    const payload = pingPushPayload({
      pingId: PING_ID,
      senderName: 'Kemar Brown',
      template: 'Free for food?',
      text: 'Patty run?',
    });
    expect(payload).toEqual({
      v: 1,
      kind: 'ping',
      title: 'Kemar Brown pinged you',
      body: 'Free for food? · Patty run?',
      url: '/inbox',
      tag: `ping:${PING_ID}`,
    });
    expect(parsePushPayload(payload)).toEqual(payload);
  });

  it('carries the ping id in its tag, for one-tap replies', () => {
    expect(pingIdFromTag(pingPushPayload({ pingId: PING_ID, senderName: 'K' }).tag)).toBe(PING_ID);
  });

  it('the longest ping (a template plus 140 characters) and name still fit the limits', () => {
    const payload = pingPushPayload({
      pingId: PING_ID,
      senderName: 'N'.repeat(100),
      template: PING_TEMPLATES[0],
      text: '🍗'.repeat(PING_TEXT_MAX_LENGTH),
    });
    expect(() => serializePushPayload(payload)).not.toThrow();
    expect([...payload.title].length).toBeLessThanOrEqual(PUSH_LIMITS.title);
    expect(payload.body).toContain('🍗'.repeat(PING_TEXT_MAX_LENGTH));
  });

  it('keeps newlines in the body but drops other control characters and collapses the name', () => {
    const payload = pingPushPayload({
      pingId: PING_ID,
      senderName: 'Kemar\u0007\n Brown',
      text: 'line one\r\nline\u001b two',
    });
    expect(payload.title).toBe('Kemar Brown pinged you');
    expect(payload.body).toBe('line one\nline  two');
    expect(() => serializePushPayload(payload)).not.toThrow();
  });

  it('a text-only ping has no template in the body; a blank name still reads well', () => {
    expect(pingPushPayload({ pingId: PING_ID, senderName: ' ', text: 'hi' })).toMatchObject({
      title: 'Someone pinged you',
      body: 'hi',
    });
  });
});

describe('replyPushPayload (WF-093)', () => {
  it('a one-tap reply', () => {
    const payload = replyPushPayload({ pingId: PING_ID, replierName: 'Tash', reply: 'In 10' });
    expect(payload).toEqual({
      v: 1,
      kind: 'ping_reply',
      title: 'Tash replied',
      body: 'In 10',
      url: '/inbox?tab=sent',
      tag: `reply:${PING_ID}`,
    });
    expect(parsePushPayload(payload)).toEqual(payload);
    expect(pingIdFromTag(payload.tag)).toBeNull();
  });

  it('a text reply', () => {
    expect(replyPushPayload({ pingId: PING_ID, replierName: 'Tash', text: 'Give me 5' }).body).toBe(
      'Give me 5',
    );
  });
});
