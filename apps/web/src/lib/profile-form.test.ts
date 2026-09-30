import { describe, expect, it } from 'vitest';
import { DB_ERROR } from '@whosfree/backend';
import { hoursErrorMessage, profileErrorMessage, statusErrorMessage, TRY_AGAIN } from './db-errors';
import { parseProfileInput } from './profile-form';

const base = { name: 'Kemar Brown', handle: 'kemar', timeZone: 'America/Jamaica' };

describe('parseProfileInput (FR-AUTH-2)', () => {
  it('trims the name and normalises the handle', () => {
    expect(parseProfileInput({ ...base, name: ' Kemar ', handle: ' @KemarB ' })).toEqual({
      ok: true,
      name: 'Kemar',
      handle: 'KemarB',
      timezone: 'America/Jamaica',
    });
  });

  it('an empty handle clears it (handles are optional)', () => {
    const r = parseProfileInput({ ...base, handle: '  @ ' });
    expect(r.ok && r.handle).toBeNull();
  });

  it('needs a name of 1–100 characters on one line', () => {
    expect(parseProfileInput({ ...base, name: '  ' })).toEqual({
      ok: false,
      error: 'Add your name.',
    });
    expect(parseProfileInput({ ...base, name: 'a'.repeat(101) }).ok).toBe(false);
    expect(parseProfileInput({ ...base, name: 'Ke\u0000mar' }).ok).toBe(false);
  });

  it('checks the handle with the shared rules', () => {
    expect(parseProfileInput({ ...base, handle: 'km' }).ok).toBe(false);
    expect(parseProfileInput({ ...base, handle: '1kemar' }).ok).toBe(false);
    expect(parseProfileInput({ ...base, handle: 'kemar.b' }).ok).toBe(false);
    expect(parseProfileInput({ ...base, handle: 'kémar' }).ok).toBe(false);
    expect(parseProfileInput({ ...base, handle: 'Admin' })).toEqual({
      ok: false,
      error: 'That handle is reserved.',
    });
    expect(parseProfileInput({ ...base, handle: 'the_whosfree_team' }).ok).toBe(false);
  });

  it('needs a known timezone', () => {
    expect(parseProfileInput({ ...base, timeZone: 'Mars/Olympus' }).ok).toBe(false);
    expect(parseProfileInput({ ...base, timeZone: 'Europe/London' }).ok).toBe(true);
  });
});

describe('database error messages', () => {
  it('tells handle problems apart (WF-040)', () => {
    expect(profileErrorMessage(DB_ERROR.handleTaken)).toMatch(/taken/);
    expect(profileErrorMessage(DB_ERROR.handleReserved)).toMatch(/reserved/);
    expect(profileErrorMessage(DB_ERROR.handleInvalid)).toMatch(/3–30/);
    expect(profileErrorMessage(DB_ERROR.rateLimited)).toMatch(/tomorrow/);
  });

  it('falls back to a generic message for anything unexpected', () => {
    for (const fn of [profileErrorMessage, statusErrorMessage, hoursErrorMessage]) {
      expect(fn('XX000')).toBe(TRY_AGAIN);
      expect(fn(undefined)).toBe(TRY_AGAIN);
    }
  });

  it('explains bad arguments for status and hours', () => {
    expect(statusErrorMessage('22023')).toMatch(/end time/);
    expect(hoursErrorMessage('22023')).toMatch(/end time must be after/);
    expect(statusErrorMessage('P0002')).toMatch(/signing up/);
  });
});
