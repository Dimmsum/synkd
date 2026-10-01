import { describe, expect, it } from 'vitest';
import { describeSources, formatPeriod, scheduleOnDates } from './my-schedule';
import type { StoredEvent, StoredSource } from './my-schedule';

const JM = 'America/Jamaica'; // UTC-5, no DST

const source: StoredSource = {
  id: 's1',
  type: 'manual',
  status: 'healthy',
  period_start: '2026-08-31',
  period_end: '2026-12-12',
  period_exceptions: [{ start: '2026-10-19', end: '2026-10-19', label: 'National Heroes Day' }],
};

// What commit_schedule writes for "Mon & Wed 10:00–12:00" and "Fri 22:00–02:00".
const lecture: StoredEvent = {
  id: 'e1',
  source_id: 's1',
  title: 'COMP2140 Lecture',
  category: 'class',
  starts_at: '2026-08-31T15:00:00+00:00',
  ends_at: '2026-08-31T17:00:00+00:00',
  rrule: 'FREQ=WEEKLY;WKST=MO;BYDAY=MO,WE;UNTIL=20261209T150000Z',
  exdates: [],
  busy: true,
};
const shift: StoredEvent = {
  ...lecture,
  id: 'e2',
  title: null,
  category: 'work',
  starts_at: '2026-09-05T03:00:00+00:00',
  ends_at: '2026-09-05T07:00:00+00:00',
  rrule: 'FREQ=WEEKLY;WKST=MO;BYDAY=FR;UNTIL=20261212T030000Z',
};

describe('scheduleOnDates (FR-VIEW-5)', () => {
  it('expands recurring events onto the dates, splitting at midnight', () => {
    const week = [
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
    ];
    expect(
      scheduleOnDates([source], [lecture, shift], week, JM).map(
        (e) => `${e.date} ${e.start}-${e.end} ${e.title} (${e.category}, ${e.source})`,
      ),
    ).toEqual([
      // Monday the 19th is a holiday (a period exception).
      '2026-10-21 600-720 COMP2140 Lecture (class, manual)',
      '2026-10-23 1320-1440 Work (work, manual)',
      '2026-10-24 0-120 Work (work, manual)',
    ]);
  });

  it('shows nothing outside the period, for non-busy events or unknown sources', () => {
    expect(scheduleOnDates([source], [lecture], ['2026-12-14'], JM)).toEqual([]);
    expect(scheduleOnDates([source], [{ ...lecture, busy: false }], ['2026-09-02'], JM)).toEqual(
      [],
    );
    expect(scheduleOnDates([], [lecture], ['2026-09-02'], JM)).toEqual([]);
    expect(scheduleOnDates([source], [lecture], [], JM)).toEqual([]);
  });

  it('skips a rule the engine doesn’t support instead of failing', () => {
    const odd = { ...lecture, rrule: 'FREQ=MONTHLY;BYMONTHDAY=2' };
    expect(scheduleOnDates([source], [odd], ['2026-09-02'], JM)).toEqual([]);
  });

  it('ignores malformed exceptions rather than dropping the schedule', () => {
    const broken = { ...source, period_exceptions: [{ start: 'soon' }] };
    expect(scheduleOnDates([broken], [lecture], ['2026-10-19'], JM)).toHaveLength(1);
  });
});

describe('describeSources (FR-GCAL-10)', () => {
  it('lists the typed-in schedule with its dates and size, then Google Calendar', () => {
    expect(describeSources([source], [lecture, shift])).toEqual([
      {
        id: 's1',
        type: 'manual',
        label: 'Typed in by you',
        status: 'healthy',
        detail: 'Aug 31 – Dec 12, 2026 · 2 events',
        periodEnd: '2026-12-12',
      },
      { type: 'gcal', label: 'Google Calendar', status: 'not_connected', detail: 'Not connected' },
    ]);
  });

  it('formats periods within and across years', () => {
    expect(formatPeriod({ start: '2026-08-31', end: '2026-12-12' })).toBe('Aug 31 – Dec 12, 2026');
    expect(formatPeriod({ start: '2026-12-01', end: '2027-01-05' })).toBe(
      'Dec 1, 2026 – Jan 5, 2027',
    );
  });
});
