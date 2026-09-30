import { describe, expect, it } from 'vitest';
import { newProfile, pickTimezone } from './profile';
import type { ClerkProfile } from './profile';

const google: ClerkProfile = {
  fullName: 'Kemar Brown',
  firstName: 'Kemar',
  lastName: 'Brown',
  username: null,
  imageUrl: 'https://img.clerk.com/abc',
  hasImage: true,
};

describe('pickTimezone (FR-AUTH-3)', () => {
  it('keeps a real IANA name', () => {
    expect(pickTimezone('America/New_York')).toBe('America/New_York');
    expect(pickTimezone('UTC')).toBe('UTC');
  });

  it('defaults to America/Jamaica when missing or unknown', () => {
    expect(pickTimezone(undefined)).toBe('America/Jamaica');
    expect(pickTimezone('')).toBe('America/Jamaica');
    expect(pickTimezone('Mars/Olympus_Mons')).toBe('America/Jamaica');
    expect(pickTimezone('<+05>-05')).toBe('America/Jamaica');
    expect(pickTimezone('America/Jamaica; drop table users')).toBe('America/Jamaica');
  });
});

describe('newProfile (WF-004)', () => {
  it('uses the Google name, photo and detected timezone', () => {
    expect(newProfile(google, 'America/Toronto')).toEqual({
      name: 'Kemar Brown',
      avatar_url: 'https://img.clerk.com/abc',
      timezone: 'America/Toronto',
    });
  });

  it('defaults the timezone to America/Jamaica', () => {
    expect(newProfile(google, undefined).timezone).toBe('America/Jamaica');
  });

  it('leaves out Clerk’s generated avatar and non-https URLs', () => {
    expect(newProfile({ ...google, hasImage: false }, undefined)).not.toHaveProperty('avatar_url');
    expect(
      newProfile({ ...google, imageUrl: 'http://x.test/a.png' }, undefined),
    ).not.toHaveProperty('avatar_url');
  });

  it('falls back through first/last name and username, and never sends an empty name', () => {
    expect(newProfile({ ...google, fullName: null }, undefined).name).toBe('Kemar Brown');
    expect(
      newProfile(
        { ...google, fullName: null, firstName: null, lastName: null, username: 'kb' },
        undefined,
      ).name,
    ).toBe('kb');
    expect(
      newProfile(
        { ...google, fullName: '  ', firstName: null, lastName: null, username: null },
        undefined,
      ).name,
    ).toBe('New member');
  });

  it('fits the database rules: 1–100 characters, no control characters', () => {
    const long = newProfile({ ...google, fullName: 'a'.repeat(150) }, undefined).name;
    expect(long).toHaveLength(100);
    expect(newProfile({ ...google, fullName: 'Ke\u0000mar\nB' }, undefined).name).toBe('KemarB');
  });
});
