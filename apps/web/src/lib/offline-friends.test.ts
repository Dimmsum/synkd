import { describe, expect, it } from 'vitest';
import { OFFLINE_FRIEND_ERRORS } from '@whosfree/backend';
import { MAX_OFFLINE_FRIENDS } from '@whosfree/shared';
import type { OfflineFriendView } from '@/lib/types';
import {
  canAddOfflineFriend,
  describeOfflineStatus,
  friendedHref,
  OFFLINE_FRIEND_HOURS_LABEL,
  OFFLINE_FRIEND_LIMIT_MESSAGE,
  offlineFriendErrorMessage,
  sortOfflineFriends,
} from './offline-friends';

const now = '2026-09-30T19:30:00.000Z'; // Wed 2:30 PM in Jamaica
const JM = 'America/Jamaica';
const inMin = (m: number) => new Date(Date.parse(now) + m * 60_000).toISOString();

function offline(nickname: string, over: Partial<OfflineFriendView> = {}): OfflineFriendView {
  return {
    id: nickname,
    nickname,
    emoji: null,
    hasSchedule: true,
    status: 'free',
    until: inMin(60),
    nextFreeAt: null,
    ...over,
  };
}

describe('sortOfflineFriends', () => {
  it('puts free first (longest first), then busy by free-again, then no schedule; ties by name', () => {
    const sorted = sortOfflineFriends([
      offline('Zed', { status: 'no_schedule', until: null, hasSchedule: false }),
      offline('Ann', { status: 'no_schedule', until: null, hasSchedule: false }),
      offline('Busy-late', { status: 'busy', until: inMin(120), nextFreeAt: inMin(120) }),
      offline('Away', { status: 'away', until: inMin(30), nextFreeAt: inMin(30) }),
      offline('Free-short', { until: inMin(15) }),
      offline('Free-long', { until: inMin(300) }),
      offline('Unknown', { status: 'unknown', until: null }),
    ]);
    expect(sorted.map((f) => f.nickname)).toEqual([
      'Free-long',
      'Free-short',
      'Away',
      'Busy-late',
      'Ann',
      'Unknown',
      'Zed',
    ]);
  });

  it("doesn't change the list it's given", () => {
    const list = [offline('B'), offline('A')];
    sortOfflineFriends(list);
    expect(list.map((f) => f.nickname)).toEqual(['B', 'A']);
  });
});

describe('describeOfflineStatus', () => {
  it('says "until X", in words next to an icon tone (NFR-UX-1)', () => {
    expect(describeOfflineStatus(offline('Tash', { until: inMin(90) }), now, JM)).toEqual({
      tone: 'free',
      label: 'Free until 4:00 PM',
    });
    expect(
      describeOfflineStatus(
        offline('Tash', {
          status: 'busy',
          until: inMin(30),
          nextFreeAt: inMin(30),
          activity: { category: 'class', title: 'MATH1141' },
        }),
        now,
        JM,
      ),
    ).toEqual({ tone: 'busy', label: 'MATH1141 until 3:00 PM', detail: 'In class' });
  });

  it('a missing schedule is for the viewer to add', () => {
    expect(
      describeOfflineStatus(offline('Tash', { status: 'no_schedule', until: null }), now, JM),
    ).toEqual({ tone: 'no_schedule', label: 'No schedule yet' });
  });
});

describe('the cap (FR-SOC-18)', () => {
  it(`allows up to ${MAX_OFFLINE_FRIENDS}`, () => {
    expect(canAddOfflineFriend(MAX_OFFLINE_FRIENDS - 1)).toBe(true);
    expect(canAddOfflineFriend(MAX_OFFLINE_FRIENDS)).toBe(false);
    expect(OFFLINE_FRIEND_LIMIT_MESSAGE).toContain(String(MAX_OFFLINE_FRIENDS));
  });
});

describe('offlineFriendErrorMessage', () => {
  it('maps every error the functions raise to plain words', () => {
    expect(
      offlineFriendErrorMessage({ code: 'P0001', message: OFFLINE_FRIEND_ERRORS.limitReached }),
    ).toBe(OFFLINE_FRIEND_LIMIT_MESSAGE);
    expect(
      offlineFriendErrorMessage({
        code: '22023',
        message: OFFLINE_FRIEND_ERRORS.permissionRequired,
      }),
    ).toBe('Tick the box to confirm you have their permission.');
    expect(
      offlineFriendErrorMessage({ code: '22023', message: OFFLINE_FRIEND_ERRORS.invalidNickname }),
    ).toBe('Give them a nickname of 1 to 40 characters.');
    expect(
      offlineFriendErrorMessage({ code: '22023', message: OFFLINE_FRIEND_ERRORS.invalidEmoji }),
    ).toBe('Pick a single emoji.');
    expect(
      offlineFriendErrorMessage({
        code: '22023',
        message: OFFLINE_FRIEND_ERRORS.nicknameControlCharacters,
      }),
    ).toMatch(/ordinary letters/);
    expect(offlineFriendErrorMessage({ code: 'P0002', message: 'x' })).toMatch(/couldn’t find/);
    expect(offlineFriendErrorMessage({ code: 'PT429' })).toMatch(/Try again tomorrow/);
    expect(offlineFriendErrorMessage({ code: 'WF001' })).toMatch(/Finish signing up/);
  });

  it('returns null for anything unexpected (logged by code, shown as "try again")', () => {
    expect(offlineFriendErrorMessage({ code: '42501', message: 'denied' })).toBeNull();
    expect(offlineFriendErrorMessage({ code: 'P0001', message: 'Something else' })).toBeNull();
    expect(offlineFriendErrorMessage({})).toBeNull();
  });
});

describe('labels and links', () => {
  it('shows the default available hours', () => {
    expect(OFFLINE_FRIEND_HOURS_LABEL).toBe('8:00 AM – 10:00 PM');
  });

  it('links to Friends with the new friend, for the offline copy prompt (FR-SOC-19)', () => {
    expect(friendedHref('00000000-0000-4000-8000-000000000001')).toBe(
      '/friends?friended=00000000-0000-4000-8000-000000000001',
    );
  });
});
