import { describe, expect, it } from 'vitest';
import { DB_ERROR } from '@synkd/backend';
import type { EventDraft } from '@synkd/shared';
import { scheduleErrorMessage, TRY_AGAIN } from './db-errors';
import {
  checkSchedule,
  defaultManualPeriod,
  endedMessage,
  firstEventOutsidePeriod,
  formatDateRange,
  withHolidays,
} from './schedule-draft';

const lecture: EventDraft = {
  title: 'COMP2140 Lecture',
  category: 'class',
  start: '10:00',
  end: '12:00',
  when: { kind: 'weekly', days: ['mon', 'wed'], pattern: { type: 'every' } },
  confidence: 1,
};
const semester = { start: '2026-08-31', end: '2026-12-12' };

describe('defaultManualPeriod (FR-IMP-7)', () => {
  it('runs 16 weeks from today', () => {
    expect(defaultManualPeriod('2026-09-30')).toEqual({ start: '2026-09-30', end: '2027-01-19' });
  });
});

describe('withHolidays (FR-IMP-8)', () => {
  it('pre-fills the Jamaican public holidays inside the period', () => {
    expect(withHolidays([], semester, [])).toEqual([
      { start: '2026-10-19', end: '2026-10-19', label: 'National Heroes Day', holiday: true },
    ]);
  });

  it('keeps the user’s own breaks and sorts everything by date', () => {
    const reading = { start: '2026-10-12', end: '2026-10-16', label: 'Reading week' };
    expect(withHolidays([reading], { start: '2026-08-01', end: '2026-12-31' }, [])).toEqual([
      { start: '2026-08-01', end: '2026-08-01', label: 'Emancipation Day', holiday: true },
      { start: '2026-08-06', end: '2026-08-06', label: 'Independence Day', holiday: true },
      reading,
      { start: '2026-10-19', end: '2026-10-19', label: 'National Heroes Day', holiday: true },
      { start: '2026-12-25', end: '2026-12-25', label: 'Christmas Day', holiday: true },
      { start: '2026-12-26', end: '2026-12-26', label: 'Boxing Day', holiday: true },
    ]);
  });

  it('follows the period and leaves out dismissed holidays', () => {
    const old = withHolidays([], semester, []);
    expect(withHolidays(old, { start: '2027-01-11', end: '2027-04-30' }, ['2027-02-10'])).toEqual([
      { start: '2027-03-26', end: '2027-03-26', label: 'Good Friday', holiday: true },
      { start: '2027-03-29', end: '2027-03-29', label: 'Easter Monday', holiday: true },
    ]);
  });

  it('doesn’t repeat a holiday inside a break the user added, or fill an invalid period', () => {
    const exams = { start: '2026-12-20', end: '2026-12-31', label: 'Christmas break' };
    expect(withHolidays([exams], { start: '2026-12-01', end: '2026-12-31' }, [])).toEqual([exams]);
    expect(withHolidays([], { start: '2026-12-31', end: '2026-01-01' }, [])).toEqual([]);
    expect(withHolidays([], { start: '', end: '2026-12-31' }, [])).toEqual([]);
  });
});

describe('formatDateRange', () => {
  it('shows one day or a range', () => {
    expect(formatDateRange({ start: '2026-10-19', end: '2026-10-19' })).toBe('Oct 19');
    expect(formatDateRange({ start: '2026-10-12', end: '2026-10-16' })).toBe('Oct 12 – Oct 16');
  });
});

describe('firstEventOutsidePeriod', () => {
  const period = { ...semester, exceptions: [] };
  it('finds a weekly event with no day in the period, and a date outside it', () => {
    const weekTwenty: EventDraft = {
      ...lecture,
      when: { kind: 'weekly', days: ['mon'], pattern: { type: 'weeks', weeks: [20] } },
    };
    const january: EventDraft = { ...lecture, when: { kind: 'date', date: '2027-01-05' } };
    expect(firstEventOutsidePeriod([lecture], period)).toBe(-1);
    expect(firstEventOutsidePeriod([lecture, weekTwenty], period)).toBe(1);
    expect(firstEventOutsidePeriod([january], period)).toBe(0);
  });
});

describe('checkSchedule (WF-030)', () => {
  it('refuses a schedule that ended before today, so it would never show', () => {
    const lastYear = { start: '2025-08-31', end: '2025-12-12' };
    expect(checkSchedule({ events: [lecture], period: lastYear }, '2026-09-30')).toEqual({
      ok: false,
      error: endedMessage(lastYear),
    });
    expect(endedMessage(lastYear)).toMatch(/ended on Dec 12, 2025/);
    // Ending today is fine, and so is a schedule that starts later.
    expect(checkSchedule({ events: [lecture], period: semester }, '2026-12-12').ok).toBe(true);
    expect(checkSchedule({ events: [lecture], period: semester }, '2026-01-05').ok).toBe(true);
  });

  const holiday = { start: '2026-10-19', end: '2026-10-19', label: 'Heroes', holiday: true };

  it('returns the draft without editor-only fields', () => {
    const result = checkSchedule({
      events: [{ ...lecture, id: 'new-1' }],
      period: { ...semester, exceptions: [holiday] },
    });
    expect(result).toEqual({
      ok: true,
      draft: {
        events: [lecture],
        period: {
          ...semester,
          exceptions: [{ start: '2026-10-19', end: '2026-10-19', label: 'Heroes' }],
        },
      },
    });
  });

  it.each([
    ['no events', { events: [], period: semester }, 'Add at least one event first.'],
    [
      'a broken event',
      { events: [{ ...lecture, start: 'soon' }], period: semester },
      'One of the events needs fixing.',
    ],
    [
      'backwards dates',
      { events: [lecture], period: { start: '2026-12-12', end: '2026-08-31' } },
      'Check the start and end dates of your schedule.',
    ],
    [
      'a missing date',
      { events: [lecture], period: { start: '', end: '2026-12-12' } },
      'Check the start and end dates of your schedule.',
    ],
    [
      'more than a year',
      { events: [lecture], period: { start: '2026-01-01', end: '2027-06-01' } },
      'A schedule can cover at most 366 days. Shorten the dates.',
    ],
    [
      'a backwards break',
      {
        events: [lecture],
        period: { ...semester, exceptions: [{ start: '2026-10-16', end: '2026-10-12' }] },
      },
      'Check the dates of your breaks and holidays.',
    ],
    [
      'too many breaks',
      { events: [lecture], period: { ...semester, exceptions: Array(51).fill(holiday) } },
      'That’s a lot of breaks. Keep at most 50.',
    ],
    [
      'an event outside the dates',
      {
        events: [{ ...lecture, title: 'Lab', when: { kind: 'date', date: '2027-01-05' } }],
        period: semester,
      },
      '“Lab” doesn’t happen between Aug 31 and Dec 12. Check its days and the dates.',
    ],
  ])('refuses %s', (_name, input, error) => {
    expect(checkSchedule(input)).toEqual({ ok: false, error });
  });

  it('never passes a location on (D35)', () => {
    const result = checkSchedule({
      events: [{ ...lecture, location: 'SLT 3', room: 'C2' }],
      period: { ...semester, location: 'Mona' },
    });
    expect(JSON.stringify(result)).not.toMatch(/SLT|C2|Mona|location|room/);
  });
});

describe('scheduleErrorMessage (commit_schedule errors)', () => {
  const draft = { events: [lecture, { ...lecture, title: 'Lab' }], period: semester };

  it('names the event that never happens in the period, from the error detail', () => {
    expect(scheduleErrorMessage(DB_ERROR.scheduleEventOutsidePeriod, '{"event": 1}', draft)).toBe(
      '“Lab” doesn’t happen between Aug 31 and Dec 12. Check its days and the dates.',
    );
    expect(scheduleErrorMessage(DB_ERROR.scheduleEventOutsidePeriod, 'oops', draft)).toBe(
      'One of the events doesn’t happen between Aug 31 and Dec 12. Check its days and the dates.',
    );
  });

  it.each([
    [DB_ERROR.scheduleInvalid, 'Check your events and dates'],
    [DB_ERROR.rateLimited, 'Try again tomorrow'],
    [DB_ERROR.noAccount, 'Finish signing up'],
    ['P0002', 'couldn’t find that friend'],
  ])('%s has its own message', (code, text) => {
    expect(scheduleErrorMessage(code, undefined, draft)).toContain(text);
  });

  it('anything else is a generic retry', () => {
    expect(scheduleErrorMessage('42501', undefined, draft)).toBe(TRY_AGAIN);
    expect(scheduleErrorMessage(undefined, undefined, draft)).toBe(TRY_AGAIN);
  });
});
