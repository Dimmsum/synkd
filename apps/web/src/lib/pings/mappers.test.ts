import { describe, expect, it } from 'vitest';
import type { InboxPing } from '@synkd/backend';
import { hueFor } from '@/lib/hue';
import { splitInbox, toPing } from './mappers';

const KEMAR = '6f1c1a3e-9a52-4c1e-9f55-2b0d0c1e7a11';

function row(over: Partial<InboxPing> = {}): InboxPing {
  return {
    id: '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed',
    direction: 'received',
    other_id: KEMAR,
    other_name: 'Kemar Brown',
    other_handle: null,
    other_avatar_url: null,
    template: 'Free for food?',
    text: null,
    reply: null,
    reply_text: null,
    replied_at: null,
    created_at: '2026-10-05T14:00:00+00:00',
    expires_at: '2026-10-05T16:00:00+00:00',
    unread: true,
    ...over,
  };
}

describe('toPing', () => {
  it('maps a received ping', () => {
    expect(toPing(row())).toEqual({
      id: '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed',
      direction: 'received',
      other: { id: KEMAR, name: 'Kemar Brown', handle: '', hue: hueFor(KEMAR) },
      template: 'Free for food?',
      sentAt: '2026-10-05T14:00:00.000Z',
      expiresAt: '2026-10-05T16:00:00.000Z',
      unread: true,
    });
  });

  it('keeps text as is (plain text, D31) and maps a quick or text reply', () => {
    const text = '<b>hi</b> https://example.test';
    expect(toPing(row({ template: null, text })).text).toBe(text);
    expect(
      toPing(row({ direction: 'sent', reply: 'In 10', replied_at: '2026-10-05T14:05:00Z' })).reply,
    ).toEqual({ reply: 'In 10', at: '2026-10-05T14:05:00.000Z' });
    expect(
      toPing(row({ reply_text: 'Give me 5', replied_at: '2026-10-05T14:05:00Z' })).reply,
    ).toEqual({ text: 'Give me 5', at: '2026-10-05T14:05:00.000Z' });
  });

  it('drops an unknown template rather than showing it as one', () => {
    expect(toPing(row({ template: 'Something else' })).template).toBeUndefined();
  });
});

describe('splitInbox', () => {
  it('splits into Received and Sent, keeping order', () => {
    const rows = [
      row({ id: 'a', direction: 'received' }),
      row({ id: 'b', direction: 'sent' }),
      row({ id: 'c', direction: 'received' }),
    ];
    const { received, sent } = splitInbox(rows);
    expect(received.map((p) => p.id)).toEqual(['a', 'c']);
    expect(sent.map((p) => p.id)).toEqual(['b']);
  });
});
