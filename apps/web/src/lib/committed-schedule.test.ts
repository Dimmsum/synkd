// A typed-in schedule, as commit_schedule stores it, read back by the viewer's own status
// (lib/presence/compute.ts, used by lib/data/now.ts) and My schedule (lib/my-schedule.ts).
// The rows come from eventTimesFromDraft, which the backend tests prove commit_schedule
// matches for any draft (packages/backend/test/commit-schedule.test.ts), so this checks the web
// side of the round trip: the RRULE, UNTIL, EXDATEs and period exceptions it writes are what
// the screens expand (WF-030, WF-031, WF-064).

import { describe, expect, it } from 'vitest';
import { eventTimesFromDraft } from '@synkd/availability';
import type { EventDraft } from '@synkd/shared';
import { scheduleOnDates } from './my-schedule';
import { computePresence, ownPresenceInput, type OwnRows } from './presence/compute';
import { checkSchedule } from './schedule-draft';

const JM = 'America/Jamaica'; // UTC-5, no DST
const at = (local: string) => Date.parse(`${local}-05:00`);
// timestamptz as PostgREST returns it.
const pg = (ms: number) => new Date(ms).toISOString().replace('.000Z', '+00:00');

const lecture: EventDraft = {
  title: 'COMP2140 Lecture',
  category: 'class',
  start: '10:00',
  end: '12:00',
  confidence: 1,
  when: { kind: 'weekly', days: ['mon', 'wed'], pattern: { type: 'every' } },
};

const checked = checkSchedule({
  period: {
    start: '2026-08-31',
    end: '2026-12-12',
    exceptions: [{ start: '2026-10-19', end: '2026-10-19', label: 'National Heroes Day' }],
  },
  events: [
    lecture,
    {
      ...lecture,
      title: 'Lab',
      category: 'lab',
      start: '09:00',
      end: '12:00',
      when: { kind: 'weekly', days: ['tue'], pattern: { type: 'alternating', parity: 'odd' } },
    },
    {
      ...lecture,
      title: 'Tutorial',
      category: 'tutorial',
      start: '13:00',
      end: '14:00',
      when: { kind: 'weekly', days: ['thu'], pattern: { type: 'weeks', weeks: [2, 3, 5] } },
    },
  ],
});
if (!checked.ok) throw new Error(checked.error);
const draft = checked.draft;

/** The viewer's rows after commit_schedule, plus an offline friend's that must be ignored. */
const rows: OwnRows = {
  timezone: JM,
  sharingPaused: false,
  weekly: null,
  overrides: [],
  sources: [
    {
      id: 'src-manual',
      offline_friend_id: null,
      period_start: draft.period.start,
      period_end: draft.period.end,
      period_exceptions: draft.period.exceptions,
    },
  ],
  events: draft.events.map((e, i) => {
    const times = eventTimesFromDraft(e, draft.period, JM);
    if (!times) throw new Error('every event happens in the period');
    return {
      id: `ev-${i}`,
      source_id: 'src-manual',
      offline_friend_id: null,
      starts_at: pg(times.start),
      ends_at: pg(times.end),
      rrule: times.rrule,
      exdates: times.exdates.map(pg),
      busy: true,
      category: e.category,
      title: e.title,
    };
  }),
};

const statusAt = (local: string) => computePresence(ownPresenceInput(rows), at(local));

describe('a committed schedule in the viewer’s own status (WF-030, WF-064)', () => {
  it('stores bounded weekly rules', () => {
    expect(rows.events.map((e) => e.rrule)).toEqual([
      'FREQ=WEEKLY;WKST=MO;BYDAY=MO,WE;UNTIL=20261209T150000Z',
      'FREQ=WEEKLY;INTERVAL=2;WKST=MO;BYDAY=TU;UNTIL=20261208T140000Z',
      'FREQ=WEEKLY;WKST=MO;BYDAY=TH;UNTIL=20261001T180000Z',
    ]);
    // Week 4's tutorial is skipped.
    expect(rows.events[2]?.exdates).toEqual([pg(at('2026-09-24T13:00:00'))]);
  });

  it('is busy in a class, until it ends, with its title', () => {
    expect(statusAt('2026-09-07T10:30:00')).toMatchObject({
      status: 'busy',
      until: new Date(at('2026-09-07T12:00:00')).toISOString(),
      activity: { category: 'class', title: 'COMP2140 Lecture' },
    });
  });

  it('follows alternating and chosen weeks', () => {
    expect(statusAt('2026-09-01T09:30:00').status).toBe('busy'); // week 1: odd, lab
    expect(statusAt('2026-09-08T09:30:00').status).toBe('free'); // week 2: even, no lab
    expect(statusAt('2026-09-10T13:30:00').status).toBe('busy'); // week 2: tutorial
    expect(statusAt('2026-09-24T13:30:00').status).toBe('free'); // week 4: EXDATE
    expect(statusAt('2026-10-08T13:30:00').status).toBe('free'); // week 6: past UNTIL
  });

  it('is free on an exception and after the period', () => {
    expect(statusAt('2026-10-19T10:30:00').status).toBe('free'); // National Heroes Day
    expect(statusAt('2026-10-21T10:30:00').status).toBe('busy');
    expect(statusAt('2026-12-14T10:30:00').status).toBe('free');
  });
});

describe('a committed schedule in My schedule (WF-031)', () => {
  const week = (dates: string[]) =>
    scheduleOnDates(
      rows.sources.map((s) => ({ ...s, type: 'manual', status: 'healthy' })),
      rows.events,
      dates,
      JM,
    ).map((e) => `${e.date} ${e.start}-${e.end} ${e.title}`);

  it('shows each occurrence, skipping the exception', () => {
    // Week 8: Heroes Day Monday off, and no lab in an even week.
    expect(week(['2026-10-19', '2026-10-20', '2026-10-21'])).toEqual([
      '2026-10-21 600-720 COMP2140 Lecture',
    ]);
    // Week 9: an odd week.
    expect(week(['2026-10-26', '2026-10-27'])).toEqual([
      '2026-10-26 600-720 COMP2140 Lecture',
      '2026-10-27 540-720 Lab',
    ]);
  });
});
