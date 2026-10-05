import { describe, expect, it } from 'vitest';
import { DB_ERROR, GROUP_ERRORS } from '@synkd/backend';
import { dbErrorMessage, isAlreadyMember, knownDbErrorMessage, TRY_AGAIN } from './errors';

describe('knownDbErrorMessage', () => {
  it('maps rate limits by code (NFR-SEC-9)', () => {
    expect(knownDbErrorMessage({ code: DB_ERROR.rateLimited, message: 'Too many attempts' })).toBe(
      'You’re doing that a lot. Take a break and try again later.',
    );
  });

  it('maps every friend error code (WF-042)', () => {
    for (const code of [
      DB_ERROR.noAccount,
      DB_ERROR.userNotFound,
      DB_ERROR.cannotTargetSelf,
      DB_ERROR.alreadyFriends,
      DB_ERROR.requestAlreadySent,
      DB_ERROR.requestNotFound,
      DB_ERROR.blockedByYou,
    ]) {
      expect(knownDbErrorMessage({ code }), code).toEqual(expect.any(String));
    }
  });

  it('says the same for a missing and a blocking user (FR-SOC-6)', () => {
    expect(knownDbErrorMessage({ code: DB_ERROR.userNotFound, message: 'User not found' })).toBe(
      'We couldn’t find that person.',
    );
  });

  it('shows "This group is full" for a full group (FR-SOC-11)', () => {
    expect(knownDbErrorMessage({ code: 'P0001', message: GROUP_ERRORS.groupFull })).toBe(
      'This group is full',
    );
  });

  it('picks the wording by message only for the shared SQLSTATEs', () => {
    expect(knownDbErrorMessage({ code: 'P0001', message: GROUP_ERRORS.mustTransferAdmin })).toBe(
      'Make someone else admin before you leave.',
    );
    expect(knownDbErrorMessage({ code: 'P0002', message: GROUP_ERRORS.inviteNotFound })).toBe(
      'That invite link doesn’t work.',
    );
    expect(knownDbErrorMessage({ code: '22023', message: GROUP_ERRORS.invalidName })).toBe(
      'Give the group a name (up to 60 characters).',
    );
    // A known message under an unrelated code isn't trusted.
    expect(knownDbErrorMessage({ code: 'XX000', message: GROUP_ERRORS.groupFull })).toBeNull();
  });

  it('maps a lost permission (42501) and approval-only groups (0A000)', () => {
    expect(knownDbErrorMessage({ code: '42501', message: GROUP_ERRORS.notAllowed })).toMatch(
      /permission/,
    );
    expect(knownDbErrorMessage({ code: '0A000' })).toMatch(/approval/);
  });

  it('returns null for anything unexpected', () => {
    expect(knownDbErrorMessage({ code: '22023', message: 'tier must be 1, 2 or 3' })).toBeNull();
    expect(knownDbErrorMessage({ code: '08006' })).toBeNull();
    expect(knownDbErrorMessage({})).toBeNull();
  });
});

describe('dbErrorMessage', () => {
  it('falls back to "try again"', () => {
    expect(dbErrorMessage({ code: '08006', message: 'connection failure' })).toBe(TRY_AGAIN);
  });
});

describe('isAlreadyMember', () => {
  it('recognises join_group’s "already a member" error only', () => {
    expect(isAlreadyMember({ code: 'P0001', message: GROUP_ERRORS.alreadyMember })).toBe(true);
    expect(isAlreadyMember({ code: 'P0001', message: GROUP_ERRORS.groupFull })).toBe(false);
    expect(isAlreadyMember({ code: '42501', message: GROUP_ERRORS.alreadyMember })).toBe(false);
  });
});
