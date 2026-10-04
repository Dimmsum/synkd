import { describe, expect, it } from 'vitest';
import {
  addDays,
  dateKey,
  daysBetween,
  formatAgo,
  formatClock,
  formatClockRange,
  formatDayLabel,
  formatDuration,
  formatHourLabel,
  formatTime,
  formatUntil,
  formatWeekRange,
  minutesIntoDay,
  startOfWeek,
  weekdayOf,
  zonedTimeToInstant,
} from './time';

const JM = 'America/Jamaica';

describe('clock formatting', () => {
  it('formats minutes since midnight as 12-hour time', () => {
    expect(formatClock(0)).toBe('12:00 AM');
    expect(formatClock(9 * 60)).toBe('9:00 AM');
    expect(formatClock(12 * 60)).toBe('12:00 PM');
    expect(formatClock(14 * 60 + 30)).toBe('2:30 PM');
    expect(formatClock(1440)).toBe('12:00 AM');
  });

  it('drops the repeated AM/PM in a range', () => {
    expect(formatClockRange(9 * 60, 10 * 60 + 30)).toBe('9:00 – 10:30 AM');
    expect(formatClockRange(11 * 60, 13 * 60)).toBe('11:00 AM – 1:00 PM');
    expect(formatClockRange(22 * 60, 1440)).toBe('10:00 PM – 12:00 AM');
  });

  it('marks a range that runs overnight (WF-136)', () => {
    expect(formatClockRange(10 * 60, 9 * 60)).toBe('10:00 AM – 9:00 AM (next day)');
    expect(formatClockRange(22 * 60, 2 * 60)).toBe('10:00 PM – 2:00 AM (next day)');
    expect(formatClockRange(22 * 60, 26 * 60)).toBe('10:00 PM – 2:00 AM (next day)');
  });

  it('uses compact hour labels for grids', () => {
    expect(formatHourLabel(8 * 60)).toBe('8 AM');
    expect(formatHourLabel(12 * 60)).toBe('12 PM');
    expect(formatHourLabel(15 * 60 + 30)).toBe('3:30 PM');
  });
});

describe('timezone conversion (America/Jamaica is UTC−5, no DST)', () => {
  it('reads wall-clock time in the viewer timezone', () => {
    const instant = '2026-09-30T19:30:00Z';
    expect(formatTime(instant, JM)).toBe('2:30 PM');
    expect(minutesIntoDay(instant, JM)).toBe(14 * 60 + 30);
    expect(dateKey(instant, JM)).toBe('2026-09-30');
  });

  it('handles the date boundary', () => {
    // 03:00 UTC on Oct 1 is still 10 PM on Sep 30 in Jamaica.
    expect(dateKey('2026-10-01T03:00:00Z', JM)).toBe('2026-09-30');
  });

  it('round-trips local wall time to an instant', () => {
    expect(zonedTimeToInstant('2026-09-30', 14 * 60, JM).toISOString()).toBe(
      '2026-09-30T19:00:00.000Z',
    );
  });

  it('round-trips across a DST change in another timezone', () => {
    // New York switches to EDT on 2026-03-08.
    expect(zonedTimeToInstant('2026-03-09', 9 * 60, 'America/New_York').toISOString()).toBe(
      '2026-03-09T13:00:00.000Z',
    );
  });
});

describe('formatUntil', () => {
  const now = '2026-09-30T19:30:00Z'; // Wed 2:30 PM in Jamaica

  it('shows only the time for today', () => {
    expect(formatUntil('2026-09-30T21:00:00Z', now, JM)).toBe('4:00 PM');
  });

  it('adds "tomorrow" for the next day', () => {
    expect(formatUntil('2026-10-01T13:00:00Z', now, JM)).toBe('8:00 AM tomorrow');
  });

  it('uses the weekday further out', () => {
    expect(formatUntil('2026-10-02T13:00:00Z', now, JM)).toBe('Fri 8:00 AM');
  });
});

describe('date keys', () => {
  it('does calendar arithmetic', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-09-30', '2026-10-02')).toBe(2);
  });

  it('starts weeks on Monday', () => {
    expect(weekdayOf('2026-09-28')).toBe(0);
    expect(weekdayOf('2026-10-04')).toBe(6);
    expect(startOfWeek('2026-09-30')).toBe('2026-09-28');
    expect(startOfWeek('2026-10-04')).toBe('2026-09-28');
  });

  it('labels days relative to today', () => {
    expect(formatDayLabel('2026-09-30', '2026-09-30')).toBe('Today');
    expect(formatDayLabel('2026-10-01', '2026-09-30')).toBe('Tomorrow');
    expect(formatDayLabel('2026-10-03', '2026-09-30')).toBe('Saturday');
    expect(formatDayLabel('2026-10-12', '2026-09-30')).toBe('Mon, Oct 12');
  });

  it('formats week ranges across months', () => {
    expect(formatWeekRange('2026-09-28')).toBe('Sep 28 – Oct 4, 2026');
    expect(formatWeekRange('2026-10-05')).toBe('Oct 5 – 11, 2026');
  });
});

describe('durations and relative times', () => {
  it('formats durations', () => {
    expect(formatDuration(30)).toBe('30 min');
    expect(formatDuration(60)).toBe('1 hr');
    expect(formatDuration(90)).toBe('1 hr 30 min');
  });

  it('formats time ago', () => {
    const now = '2026-09-30T19:30:00Z';
    expect(formatAgo('2026-09-30T19:29:40Z', now)).toBe('just now');
    expect(formatAgo('2026-09-30T19:18:00Z', now)).toBe('12 min ago');
    expect(formatAgo('2026-09-30T16:30:00Z', now)).toBe('3 hr ago');
    expect(formatAgo('2026-09-29T12:00:00Z', now)).toBe('Yesterday');
  });
});
