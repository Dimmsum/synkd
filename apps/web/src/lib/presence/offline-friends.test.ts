import { describe, expect, it } from 'vitest';
import type { OfflineFriend } from '@whosfree/backend';
import {
  computePresence,
  offlineFriendPresenceInput,
  ownPresenceInput,
  type OwnRows,
} from './compute';
import { offlineFriendsNow, type OfflineScheduleRows } from './offline-friends';

const JM = 'America/Jamaica'; // UTC-5, no DST
const now = Date.parse('2026-09-30T19:30:00Z'); // Wed 2:30 PM in Jamaica
const at = (local: string) => Date.parse(`${local}-05:00`);
const iso = (ms: number) => new Date(ms).toISOString();

const TASH = '00000000-0000-4000-8000-0000000000a1';
const DEV = '00000000-0000-4000-8000-0000000000a2';

function friend(id: string, nickname: string, hasSchedule = true): OfflineFriend {
  return {
    id,
    nickname,
    emoji: null,
    permission_confirmed_at: '2026-09-01T00:00:00Z',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    has_schedule: hasSchedule,
  };
}

const source = (id: string, offlineFriendId: string | null): OwnRows['sources'][number] => ({
  id,
  offline_friend_id: offlineFriendId,
  period_start: null,
  period_end: null,
  period_exceptions: [],
});

/** A class today, 2–3 PM in Jamaica, on `sourceId`. */
const lecture = (
  sourceId: string,
  offlineFriendId: string | null,
  over: Partial<OwnRows['events'][number]> = {},
): OwnRows['events'][number] => ({
  id: `ev-${sourceId}`,
  source_id: sourceId,
  offline_friend_id: offlineFriendId,
  starts_at: iso(at('2026-09-30T14:00:00')),
  ends_at: iso(at('2026-09-30T15:00:00')),
  rrule: null,
  exdates: [],
  busy: true,
  category: 'class',
  title: 'MATH1141 Tutorial',
  ...over,
});

describe("offlineFriendPresenceInput: an offline friend's status (WF-128)", () => {
  const rows: OfflineScheduleRows = {
    sources: [source('src-tash', TASH), source('src-dev', DEV), source('src-own', null)],
    events: [lecture('src-tash', TASH), lecture('src-own', null, { title: 'Owner class' })],
  };

  it('is busy from their own events, with the details the owner added (FR-SOC-15)', () => {
    const p = computePresence(offlineFriendPresenceInput(TASH, { timezone: JM, ...rows }), now);
    expect(p).toMatchObject({
      status: 'busy',
      until: iso(at('2026-09-30T15:00:00')),
      nextFreeAt: iso(at('2026-09-30T15:00:00')),
      activity: { category: 'class', title: 'MATH1141 Tutorial' },
    });
  });

  it("never counts the owner's events or another offline friend's (D44)", () => {
    // Dev has a source but no events: free, and the owner's class doesn't make Dev busy.
    const p = computePresence(offlineFriendPresenceInput(DEV, { timezone: JM, ...rows }), now);
    expect(p.status).toBe('free');
    expect(p.activity).toBeUndefined();
  });

  it('uses the default available hours, 08:00–22:00 (D24)', () => {
    const free = computePresence(
      offlineFriendPresenceInput(DEV, { timezone: JM, ...rows }),
      at('2026-09-30T16:00:00'),
    );
    expect(free).toMatchObject({ status: 'free', until: iso(at('2026-09-30T22:00:00')) });

    const late = computePresence(
      offlineFriendPresenceInput(DEV, { timezone: JM, ...rows }),
      at('2026-09-30T23:00:00'),
    );
    expect(late).toMatchObject({
      status: 'away',
      until: iso(at('2026-10-01T08:00:00')),
      nextFreeAt: iso(at('2026-10-01T08:00:00')),
    });
  });

  it('has no schedule without a source of their own', () => {
    const p = computePresence(
      offlineFriendPresenceInput('00000000-0000-4000-8000-0000000000ff', { timezone: JM, ...rows }),
      now,
    );
    expect(p.status).toBe('no_schedule');
  });

  it("doesn't change the owner's own status (WF-127)", () => {
    const own = computePresence(
      ownPresenceInput({
        timezone: JM,
        sharingPaused: false,
        weekly: null,
        overrides: [],
        sources: [source('src-tash', TASH)],
        events: [lecture('src-tash', TASH)],
      }),
      now,
    );
    expect(own.status).toBe('no_schedule');
  });
});

describe('offlineFriendsNow', () => {
  it("works out everyone's status at the same instant, with the changes ahead", () => {
    const { friends, errors } = offlineFriendsNow(
      [friend(TASH, 'Tash'), friend(DEV, 'Dev', false)],
      { sources: [source('src-tash', TASH)], events: [lecture('src-tash', TASH)] },
      JM,
      now,
    );
    expect(errors).toEqual([]);
    expect(friends).toEqual([
      expect.objectContaining({
        id: TASH,
        nickname: 'Tash',
        emoji: null,
        hasSchedule: true,
        status: 'busy',
        until: iso(at('2026-09-30T15:00:00')),
      }),
      expect.objectContaining({
        id: DEV,
        nickname: 'Dev',
        hasSchedule: false,
        status: 'no_schedule',
      }),
    ]);
    // The client timer moves Tash to free at 3 PM without asking the server.
    expect(friends[0]?.upcoming?.[0]).toMatchObject({
      at: iso(at('2026-09-30T15:00:00')),
      status: 'free',
      until: iso(at('2026-09-30T22:00:00')),
    });
  });

  it('gives one bad schedule `unknown` and a safe code, and still does the rest', () => {
    const { friends, errors } = offlineFriendsNow(
      [friend(TASH, 'Tash'), friend(DEV, 'Dev')],
      {
        sources: [source('src-tash', TASH), source('src-dev', DEV)],
        events: [lecture('src-tash', TASH, { rrule: 'NOT A RULE' }), lecture('src-dev', DEV)],
      },
      JM,
      now,
    );
    expect(friends.map((f) => f.status)).toEqual(['unknown', 'busy']);
    expect(errors).toHaveLength(1);
    // A class name, never the message (which could quote the rule or a title, NFR-SEC-11).
    expect(errors[0]).toMatch(/^[A-Za-z]*Error$/);
  });
});
