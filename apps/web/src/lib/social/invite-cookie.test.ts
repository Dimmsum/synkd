import { describe, expect, it } from 'vitest';
import {
  FRIEND_INVITE_RESUME_PATH,
  INVITE_COOKIE_MAX_AGE,
  inviteCodeFromPath,
  inviteCookieOptions,
  inviteToResume,
  isInviteCode,
} from './invite-cookie';

const CODE = 'AbCdEfGhIjKlMnOpQr_-12';

describe('inviteToResume (WF-042)', () => {
  it('resumes a remembered code on Now only', () => {
    expect(inviteToResume(FRIEND_INVITE_RESUME_PATH, CODE)).toBe(CODE);
    expect(inviteToResume('/friends', CODE)).toBeNull();
    expect(inviteToResume('/onboarding/visibility', CODE)).toBeNull();
    expect(inviteToResume(`/join/${CODE}`, CODE)).toBeNull();
  });

  it('ignores a missing or mangled cookie', () => {
    expect(inviteToResume(FRIEND_INVITE_RESUME_PATH, undefined)).toBeNull();
    expect(inviteToResume(FRIEND_INVITE_RESUME_PATH, 'nope')).toBeNull();
  });
});

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
