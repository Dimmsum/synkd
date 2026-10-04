import { describe, expect, it } from 'vitest';
import { statusAt } from '@whosfree/availability';
import type { NowConnection, NowEvent } from '@whosfree/backend';
import {
  computePresence,
  nowRowInput,
  nowRowToConnection,
  ownPresenceInput,
  settleOwnNow,
  DB_CLOCK_TOLERANCE_MS,
  type OwnRows,
} from './compute';

const JM = 'America/Jamaica'; // UTC-5, no DST
const now = Date.parse('2026-09-30T19:30:00Z'); // Wed 2:30 PM in Jamaica
const at = (local: string) => Date.parse(`${local}-05:00`);
const iso = (ms: number) => new Date(ms).toISOString();
const HOUR = 3_600_000;

/** A COMP2140 lecture today, 2–3 PM, as `now_for_viewer` sends it at `tier`. */
function lecture(tier: 1 | 2 | 3, over: Partial<NowEvent> = {}): NowEvent {
  return {
    id: 'ev-lecture',
    start: at('2026-09-30T14:00:00'),
    end: at('2026-09-30T15:00:00'),
    rrule: null,
    exdates: [],
    category: tier >= 2 ? 'class' : null,
    title: tier >= 3 ? 'COMP2140 Lecture' : null,
    ...over,
  };
}

function row(over: Partial<NowConnection> = {}): NowConnection {
  return {
    user_id: '00000000-0000-4000-8000-000000000001',
    name: 'Kemar',
    handle: 'kemar',
    avatar_url: null,
    relationship: 'friend',
    tier: 1,
    paused: false,
    has_schedule: true,
    group_ids: ['g1'],
    timezone: JM,
    available_hours: null,
    overrides: [],
    sources: [{ period: null, events: [] }],
    ...over,
  };
}

const connection = (r: NowConnection, t = now) => nowRowToConnection(r, t).connection;

describe('nowRowToConnection: tiers (FR-VIS-5, PRD §6.7)', () => {
  it('T1: busy until 3 PM with no reason', () => {
    const c = connection(row({ sources: [{ period: null, events: [lecture(1)] }] }));
    expect(c).toMatchObject({
      status: 'busy',
      until: iso(at('2026-09-30T15:00:00')),
      nextFreeAt: iso(at('2026-09-30T15:00:00')),
      tier: 1,
      isFriend: true,
      groupIds: ['g1'],
    });
    expect(c.activity).toBeUndefined();
  });

  it('T2: the category, never a title', () => {
    const c = connection(row({ tier: 2, sources: [{ period: null, events: [lecture(2)] }] }));
    expect(c.activity).toEqual({ category: 'class' });
  });

  it('T3: the title and category', () => {
    const c = connection(row({ tier: 3, sources: [{ period: null, events: [lecture(3)] }] }));
    expect(c.activity).toEqual({ category: 'class', title: 'COMP2140 Lecture' });
  });

  it('drops a category this build does not know rather than guessing', () => {
    const c = connection(
      row({
        tier: 2,
        sources: [{ period: null, events: [lecture(2, { category: 'party' })] }],
      }),
    );
    expect(c.activity).toBeUndefined();
  });

  it('free within available hours, until they end (FR-AVL-2)', () => {
    expect(connection(row())).toMatchObject({
      status: 'free',
      until: iso(at('2026-09-30T22:00:00')),
      nextFreeAt: null,
    });
  });

  it("a group co-member who isn't a friend", () => {
    expect(connection(row({ relationship: 'none' })).isFriend).toBe(false);
  });
});

describe('nowRowToConnection: not sharing (FR-VIEW-1, D22, FR-VIS-6)', () => {
  it('paused: "Sharing paused" with no until', () => {
    const c = connection(
      row({
        paused: true,
        has_schedule: false,
        timezone: null,
        available_hours: null,
        sources: [],
      }),
    );
    expect(c).toMatchObject({ status: 'paused', until: null, nextFreeAt: null });
    expect(c.upcoming).toEqual([]);
  });

  it('no schedule: no_schedule', () => {
    expect(connection(row({ has_schedule: false, sources: [] }))).toMatchObject({
      status: 'no_schedule',
      until: null,
    });
  });
});

describe('nowRowToConnection: manual statuses (FR-AVL-3, WF-063)', () => {
  const override = (status: string, label: string | null) => ({
    id: 'ov-1',
    status: status as 'busy',
    label,
    startsAt: now - HOUR,
    endsAt: now + HOUR,
  });

  it('with a label (T3): the note is the reason', () => {
    const c = connection(row({ tier: 3, overrides: [override('busy', 'Gym')] }));
    expect(c).toMatchObject({ status: 'busy', until: iso(now + HOUR), activity: { title: 'Gym' } });
  });

  it('without a label', () => {
    const c = connection(row({ overrides: [override('dnd', null)] }));
    expect(c).toMatchObject({ status: 'dnd', until: iso(now + HOUR) });
    expect(c.activity).toBeUndefined();
  });

  it('overrides "no schedule" too (precedence, D5)', () => {
    expect(connection(row({ sources: [], overrides: [override('free', null)] })).status).toBe(
      'free',
    );
  });

  it('focused below T2 arrives as busy and reads as plain busy', () => {
    const c = connection(row({ tier: 1, overrides: [override('busy', null)] }));
    expect(c.status).toBe('busy');
    expect(c.activity).toBeUndefined();
  });

  it('focused from T2 is busy with "Studying/Focused" as the reason', () => {
    const c = connection(row({ tier: 2, overrides: [override('focused', null)] }));
    expect(c).toMatchObject({ status: 'busy', activity: { focused: true } });
  });

  it('skips a status this build does not know', () => {
    expect(connection(row({ overrides: [override('sleeping', null)] })).status).toBe('free');
  });
});

describe('nowRowToConnection: one bad schedule never breaks the screen (WF-064)', () => {
  it('a malformed RRULE: unknown, with a loggable code only', () => {
    const r = row({
      sources: [{ period: null, events: [lecture(1, { rrule: 'FREQ=SOMETIMES;SECRET=yes' })] }],
    });
    const { connection: c, error } = nowRowToConnection(r, now);
    expect(c).toMatchObject({ id: r.user_id, name: 'Kemar', status: 'unknown', until: null });
    expect(c.upcoming).toEqual([]);
    expect(error).toBe('RangeError');
  });

  it('an unknown timezone', () => {
    const { connection: c, error } = nowRowToConnection(row({ timezone: 'Mars/Olympus' }), now);
    expect(c.status).toBe('unknown');
    expect(error).toBe('RangeError');
  });

  it('malformed jsonb columns', () => {
    const bad = row({ sources: [{ period: null, events: [{ id: 'x' } as NowEvent] }] });
    expect(nowRowToConnection(bad, now).error).toBe('TypeError');
    const badHours = row({ available_hours: [{ day: 'mon', start: '22:00', end: '08:00' }] });
    expect(nowRowToConnection(badHours, now).connection.status).toBe('unknown');
  });
});

describe('computePresence', () => {
  const busyDay = row({
    tier: 3,
    sources: [
      {
        period: null,
        events: [
          lecture(3),
          lecture(3, {
            id: 'ev-lab',
            start: at('2026-09-30T15:00:00'),
            end: at('2026-09-30T17:00:00'),
            category: 'lab',
            title: 'Chem Lab',
          }),
        ],
      },
    ],
  });

  it('matches statusAt at every instant (same engine, same now)', () => {
    const input = nowRowInput(busyDay);
    for (const t of [now, at('2026-09-30T15:30:00'), at('2026-09-30T23:00:00'), now + 3 * HOUR]) {
      const engine = statusAt(input.engine, t);
      const p = computePresence(input, t);
      expect(p.status).toBe(engine.status);
      expect(p.until).toBe(engine.until === null ? null : iso(engine.until));
    }
  });

  it('back-to-back events: busy until the last ends, with each reason as it comes', () => {
    const p = computePresence(nowRowInput(busyDay), now);
    expect(p).toMatchObject({
      status: 'busy',
      until: iso(at('2026-09-30T17:00:00')),
      activity: { title: 'COMP2140 Lecture' },
    });
    expect(p.upcoming.map((c) => [c.at, c.status, c.activity?.title, c.until])).toEqual([
      [iso(at('2026-09-30T15:00:00')), 'busy', 'Chem Lab', iso(at('2026-09-30T17:00:00'))],
      [iso(at('2026-09-30T17:00:00')), 'free', undefined, iso(at('2026-09-30T22:00:00'))],
      [iso(at('2026-09-30T22:00:00')), 'away', undefined, iso(at('2026-10-01T08:00:00'))],
      [iso(at('2026-10-01T08:00:00')), 'free', undefined, iso(at('2026-10-01T22:00:00'))],
    ]);
    // Past the 24-hour look-ahead the client re-fetches.
    expect(p.refreshAt).toBe(iso(at('2026-10-01T22:00:00')));
  });

  it('nextFreeAt skips a busy-then-away run to the next free time', () => {
    const late = row({
      sources: [
        {
          period: null,
          events: [
            lecture(1, { start: at('2026-09-30T14:00:00'), end: at('2026-09-30T22:30:00') }),
          ],
        },
      ],
    });
    const p = computePresence(nowRowInput(late), now);
    expect(p).toMatchObject({
      status: 'busy',
      until: iso(at('2026-09-30T22:30:00')),
      nextFreeAt: iso(at('2026-10-01T08:00:00')),
    });
  });

  it('identical consecutive states are not repeated (T1 back-to-back classes)', () => {
    const t1 = row({
      sources: [
        {
          period: null,
          events: [
            lecture(1),
            lecture(1, {
              id: 'ev-2',
              start: at('2026-09-30T15:00:00'),
              end: at('2026-09-30T16:00:00'),
            }),
          ],
        },
      ],
    });
    const p = computePresence(nowRowInput(t1), now);
    expect(p.upcoming[0]).toMatchObject({ at: iso(at('2026-09-30T16:00:00')), status: 'free' });
  });

  it('caps the changes sent ahead and says when to re-fetch', () => {
    const p = computePresence(nowRowInput(busyDay), now, { maxChanges: 1 });
    expect(p.upcoming).toHaveLength(1);
    expect(p.refreshAt).toBe(iso(at('2026-09-30T17:00:00')));
  });

  it('expands recurring events within their period (FR-AVL-6)', () => {
    const weekly = row({
      sources: [
        {
          period: { start: '2026-09-01', end: '2026-12-18', exceptions: [] },
          events: [
            lecture(1, {
              start: at('2026-09-02T14:00:00'),
              end: at('2026-09-02T15:00:00'),
              rrule: 'FREQ=WEEKLY;BYDAY=WE',
            }),
          ],
        },
      ],
    });
    expect(computePresence(nowRowInput(weekly), now).status).toBe('busy');
    const onBreak = row({
      sources: [
        {
          period: {
            start: '2026-09-01',
            end: '2026-12-18',
            exceptions: [{ start: '2026-09-28', end: '2026-10-02' }],
          },
          events: weekly.sources[0]?.events ?? [],
        },
      ],
    });
    expect(computePresence(nowRowInput(onBreak), now).status).toBe('free');
  });

  it("reports the override in charge, even while paused (the owner's chip)", () => {
    const input = ownPresenceInput({
      ...own(),
      sharingPaused: true,
      overrides: [
        {
          id: 'ov',
          status: 'focused',
          label: 'Revising',
          starts_at: iso(now - HOUR),
          ends_at: null,
        },
      ],
    });
    const p = computePresence(input, now);
    expect(p.status).toBe('paused');
    expect(p.override).toEqual({ status: 'focused', label: 'Revising', endsAt: null });
  });
});

function own(over: Partial<OwnRows> = {}): OwnRows {
  return {
    timezone: JM,
    sharingPaused: false,
    weekly: null,
    overrides: [],
    sources: [
      {
        id: 'src-own',
        offline_friend_id: null,
        period_start: null,
        period_end: null,
        period_exceptions: [],
      },
    ],
    events: [],
    ...over,
  };
}

const ownEvent = (over: Partial<OwnRows['events'][number]> = {}): OwnRows['events'][number] => ({
  id: 'ev-own',
  source_id: 'src-own',
  offline_friend_id: null,
  starts_at: iso(at('2026-09-30T14:00:00')),
  ends_at: iso(at('2026-09-30T15:00:00')),
  rrule: null,
  exdates: [],
  busy: true,
  category: 'class',
  title: 'COMP2140 Lecture',
  ...over,
});

describe("ownPresenceInput: the viewer's own status (WF-064, WF-127)", () => {
  it('their own events, with their own details', () => {
    const p = computePresence(ownPresenceInput(own({ events: [ownEvent()] })), now);
    expect(p).toMatchObject({
      status: 'busy',
      until: iso(at('2026-09-30T15:00:00')),
      activity: { category: 'class', title: 'COMP2140 Lecture' },
    });
  });

  it("never their offline friends' sources or events (D44)", () => {
    const rows = own({
      sources: [
        {
          id: 'src-tash',
          offline_friend_id: 'of-tash',
          period_start: null,
          period_end: null,
          period_exceptions: [],
        },
      ],
      events: [ownEvent({ source_id: 'src-tash', offline_friend_id: 'of-tash' })],
    });
    // An offline friend's schedule doesn't count as having one.
    expect(computePresence(ownPresenceInput(rows), now).status).toBe('no_schedule');

    const mixed = own({
      sources: [...own().sources, ...rows.sources],
      events: [
        ownEvent({ id: 'ev-tash', source_id: 'src-tash', offline_friend_id: 'of-tash' }),
        // Even if an event row were to point at the owner's source, the flag rules it out.
        ownEvent({ id: 'ev-flagged', offline_friend_id: 'of-tash' }),
      ],
    });
    expect(computePresence(ownPresenceInput(mixed), now).status).toBe('free');
  });

  it('ignores events that are not busy (FR-GCAL-6)', () => {
    const p = computePresence(ownPresenceInput(own({ events: [ownEvent({ busy: false })] })), now);
    expect(p.status).toBe('free');
  });

  it('applies their hours and a period with exceptions, dropping malformed ones', () => {
    const rows = own({
      weekly: [{ day: 'wed', start: '15:00', end: '20:00' }],
      sources: [
        {
          id: 'src-own',
          offline_friend_id: null,
          period_start: '2026-09-01',
          period_end: '2026-12-18',
          period_exceptions: [{ start: 'soon', end: 'later' }, 'nonsense'],
        },
      ],
    });
    expect(computePresence(ownPresenceInput(rows), now)).toMatchObject({
      status: 'away',
      until: iso(at('2026-09-30T15:00:00')),
    });
  });

  it('their manual status, as the chip shows it', () => {
    const rows = own({
      overrides: [
        {
          id: 'ov',
          status: 'dnd',
          label: 'Exam',
          starts_at: iso(now - HOUR),
          ends_at: iso(now + HOUR),
        },
      ],
    });
    const p = computePresence(ownPresenceInput(rows), now);
    expect(p).toMatchObject({ status: 'dnd', activity: { title: 'Exam' } });
    expect(p.override).toEqual({ status: 'dnd', label: 'Exam', endsAt: iso(now + HOUR) });
  });
});

describe('settleOwnNow: a status change the database stamped a moment "ahead" (WF-132)', () => {
  // The app server's clock is 300 ms behind the database's: the re-render right after the chip
  // changes the status reads rows stamped with a `now()` that is still in its future.
  const stamp = now + 300;
  const changed = [
    { id: 'old', status: 'free', label: null, starts_at: iso(now - HOUR), ends_at: iso(stamp) },
    { id: 'new', status: 'busy', label: null, starts_at: iso(stamp), ends_at: iso(stamp + HOUR) },
  ];

  it('shows the new status, not the old one ending "now"', () => {
    const rows = own({ overrides: changed });
    const p = computePresence(ownPresenceInput(rows), settleOwnNow(now, rows.overrides));
    expect(p.status).toBe('busy');
    expect(p.until).toBe(iso(stamp + HOUR));
    expect(p.override).toMatchObject({ status: 'busy' });
  });

  it('shows the calendar again right after "Back to automatic"', () => {
    const cleared = [
      {
        id: 'old',
        status: 'busy',
        label: 'Revising',
        starts_at: iso(now - HOUR),
        ends_at: iso(stamp),
      },
    ];
    const rows = own({ overrides: cleared });
    const p = computePresence(ownPresenceInput(rows), settleOwnNow(now, rows.overrides));
    expect(p.status).toBe('free');
    expect(p.override).toBeNull();
  });

  it('leaves `now` alone when nothing changed just now', () => {
    expect(settleOwnNow(now, [])).toBe(now);
    const later = [
      {
        id: 'a',
        status: 'busy',
        label: null,
        starts_at: iso(now - HOUR),
        ends_at: iso(now + 60_000),
      },
      { id: 'b', status: 'busy', label: null, starts_at: iso(now - 2 * HOUR), ends_at: null },
    ];
    expect(settleOwnNow(now, later)).toBe(now);
    const past = [
      { id: 'c', status: 'busy', label: null, starts_at: iso(now - HOUR), ends_at: iso(now - 1) },
    ];
    expect(settleOwnNow(now, past)).toBe(now);
  });

  it('only reaches as far as the tolerance', () => {
    const edge = now + DB_CLOCK_TOLERANCE_MS;
    const rows = [
      { id: 'a', status: 'busy', label: null, starts_at: iso(edge), ends_at: null },
      { id: 'b', status: 'busy', label: null, starts_at: iso(edge + 1), ends_at: null },
    ];
    expect(settleOwnNow(now, rows)).toBe(edge);
  });
});
