import { describe, expect, it } from 'vitest';
import {
  INVITE_COOKIE_MAX_AGE,
  inviteCodeFromPath,
  inviteCookieOptions,
  isInviteCode,
} from './invite-cookie';

const CODE = 'AbCdEfGhIjKlMnOpQr_-12';

describe('isInviteCode (WF-045)', () => {
  it('accepts the 22-character base64url codes the database makes', () => {
    expect(isInviteCode(CODE)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isInviteCode(undefined)).toBe(false);
    expect(isInviteCode('')).toBe(false);
    expect(isInviteCode('abc123')).toBe(false);
    expect(isInviteCode(`${CODE}x`)).toBe(false);
    expect(isInviteCode('AbCdEfGhIjKlMnOpQr+/12')).toBe(false);
    expect(isInviteCode(42)).toBe(false);
  });
});

describe('inviteCodeFromPath', () => {
  it('reads the code from an invite page path', () => {
    expect(inviteCodeFromPath(`/i/${CODE}`)).toBe(CODE);
    expect(inviteCodeFromPath(`/i/${CODE}/`)).toBe(CODE);
  });

  it('ignores other paths and malformed codes', () => {
    expect(inviteCodeFromPath('/i')).toBeNull();
    expect(inviteCodeFromPath('/i/short')).toBeNull();
    expect(inviteCodeFromPath(`/i/${CODE}/more`)).toBeNull();
    expect(inviteCodeFromPath(`/join/${CODE}`)).toBeNull();
    expect(inviteCodeFromPath('/now')).toBeNull();
  });
});

describe('inviteCookieOptions', () => {
  it('is http-only, same-site lax and short-lived', () => {
    expect(inviteCookieOptions(true)).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      maxAge: INVITE_COOKIE_MAX_AGE,
    });
    expect(INVITE_COOKIE_MAX_AGE).toBeLessThanOrEqual(60 * 60 * 24);
    expect(inviteCookieOptions(false).secure).toBe(false);
  });
});
