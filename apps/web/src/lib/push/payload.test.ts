import { describe, expect, it } from 'vitest';
import {
  FALLBACK_PUSH,
  PUSH_LIMITS,
  parsePushPayload,
  parsePushText,
  safeAppPath,
  serializePushPayload,
} from './payload';
import type { PushPayload } from './payload';

const PING: PushPayload = {
  v: 1,
  kind: 'ping',
  title: 'Kemar pinged you',
  body: 'Free for food?',
  url: '/inbox',
  tag: 'ping:1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed',
};

describe('safeAppPath', () => {
  it('accepts paths on this site', () => {
    for (const p of ['/inbox', '/friends/abc?tab=week', '/settings/notifications#push'])
      expect(safeAppPath(p)).toBe(p);
  });

  it('refuses anything that could open another site', () => {
    for (const p of [
      'https://evil.test/',
      '//evil.test/x',
      '/\\evil.test',
      'javascript:alert(1)',
      'inbox',
      '',
      '/in box',
      '/inbox\u0000',
      `/${'a'.repeat(PUSH_LIMITS.url)}`,
      42,
      null,
    ])
      expect(safeAppPath(p)).toBeNull();
  });
});

describe('parsePushPayload', () => {
  it('reads a ping payload', () => {
    expect(parsePushPayload(PING)).toEqual(PING);
    expect(parsePushText(JSON.stringify(PING))).toEqual(PING);
  });

  it('body and tag are optional; text is trimmed', () => {
    expect(parsePushPayload({ v: 1, kind: 'test', title: '  Hi ', url: '/' })).toEqual({
      v: 1,
      kind: 'test',
      title: 'Hi',
      url: '/',
    });
  });

  it('drops unknown fields, so nothing else rides along to the lock screen', () => {
    expect(parsePushPayload({ ...PING, location: 'Room 4', fromId: 'x' })).toEqual(PING);
  });

  it('rejects wrong versions, kinds, unsafe URLs, over-long or control-character text', () => {
    for (const bad of [
      { ...PING, v: 2 },
      { ...PING, kind: 'marketing' },
      { ...PING, url: 'https://evil.test' },
      { ...PING, title: '' },
      { ...PING, title: 'x'.repeat(PUSH_LIMITS.title + 1) },
      { ...PING, body: 'x'.repeat(PUSH_LIMITS.body + 1) },
      { ...PING, body: 'bell\u0007' },
      { ...PING, body: 7 },
      { ...PING, tag: 'has space' },
      { ...PING, tag: 'x'.repeat(PUSH_LIMITS.tag + 1) },
      null,
      'text',
    ])
      expect(parsePushPayload(bad)).toBeNull();
  });

  it('counts characters, not UTF-16 units, so a full-length emoji ping fits', () => {
    expect(parsePushPayload({ ...PING, body: '🍗'.repeat(PUSH_LIMITS.body) })).not.toBeNull();
  });

  it('parsePushText is null for missing or non-JSON data (the worker then shows the fallback)', () => {
    expect(parsePushText(null)).toBeNull();
    expect(parsePushText('')).toBeNull();
    expect(parsePushText('{not json')).toBeNull();
    expect(parsePushPayload(FALLBACK_PUSH)).toEqual(FALLBACK_PUSH);
  });
});

describe('serializePushPayload', () => {
  it('returns the checked JSON', () => {
    expect(JSON.parse(serializePushPayload(PING))).toEqual(PING);
  });

  it('throws on a payload the worker would refuse, without echoing its content', () => {
    expect(() => serializePushPayload({ ...PING, url: 'https://evil.test' })).toThrow(
      /^Invalid push payload$/,
    );
  });
});
