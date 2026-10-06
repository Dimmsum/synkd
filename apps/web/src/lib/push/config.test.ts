import { describe, expect, it, vi } from 'vitest';
import { readVapidConfig } from './config';

vi.mock('server-only', () => ({}));

const PUBLIC =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const PRIVATE = 'UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls';

describe('readVapidConfig', () => {
  it('returns the config when all three variables are valid', () => {
    expect(
      readVapidConfig({
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: PUBLIC,
        VAPID_PRIVATE_KEY: ` ${PRIVATE} `,
        VAPID_SUBJECT: 'mailto:support@getsynked.com',
      }),
    ).toEqual({
      ok: true,
      config: { publicKey: PUBLIC, privateKey: PRIVATE, subject: 'mailto:support@getsynked.com' },
    });
    expect(
      readVapidConfig({
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: PUBLIC,
        VAPID_PRIVATE_KEY: PRIVATE,
        VAPID_SUBJECT: 'https://getsynked.com',
      }).ok,
    ).toBe(true);
  });

  it('names every missing variable', () => {
    expect(readVapidConfig({})).toEqual({
      ok: false,
      problems: [
        'NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set',
        'VAPID_PRIVATE_KEY is not set',
        'VAPID_SUBJECT is not set',
      ],
    });
    expect(readVapidConfig({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: ' ', VAPID_PRIVATE_KEY: '' }).ok).toBe(
      false,
    );
  });

  it('rejects malformed values without echoing them (safe to log, NFR-SEC-11)', () => {
    const secret = 'this-is-not-a-key';
    const result = readVapidConfig({
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: PRIVATE, // swapped keys are a common mistake
      VAPID_PRIVATE_KEY: secret,
      VAPID_SUBJECT: 'https://localhost:3000',
    });
    expect(result).toEqual({
      ok: false,
      problems: [
        'NEXT_PUBLIC_VAPID_PUBLIC_KEY is not a VAPID public key',
        'VAPID_PRIVATE_KEY is not a VAPID private key',
        'VAPID_SUBJECT must be a mailto: address or a public https: URL',
      ],
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    for (const subject of ['support@getsynked.com', 'http://getsynked.com', 'mailto:nobody'])
      expect(
        readVapidConfig({
          NEXT_PUBLIC_VAPID_PUBLIC_KEY: PUBLIC,
          VAPID_PRIVATE_KEY: PRIVATE,
          VAPID_SUBJECT: subject,
        }).ok,
      ).toBe(false);
  });
});
