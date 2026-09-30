import { fc, test } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  HOUR_MS,
  dateFromDay,
  dayFromDate,
  localDayOf,
  localToUtc,
  msFromLocalTime,
  offsetAt,
  toLocalMs,
  weekdayIndex,
  weekdayOf,
} from './time';

const NY = 'America/New_York';
const JM = 'America/Jamaica';
const at = (iso: string) => Date.parse(iso);
const local = (date: string, time: string, tz: string) =>
  localToUtc(dayFromDate(date), msFromLocalTime(time), tz);

describe('offsetAt', () => {
  it('is UTC−5 all year in Jamaica', () => {
    expect(offsetAt(at('2026-01-15T12:00Z'), JM)).toBe(-5 * HOUR_MS);
    expect(offsetAt(at('2026-07-15T12:00Z'), JM)).toBe(-5 * HOUR_MS);
  });

  it('switches exactly at the New York DST transitions', () => {
    expect(offsetAt(at('2026-03-08T06:59:59Z'), NY)).toBe(-5 * HOUR_MS);
    expect(offsetAt(at('2026-03-08T07:00:00Z'), NY)).toBe(-4 * HOUR_MS);
    expect(offsetAt(at('2026-11-01T05:59:59Z'), NY)).toBe(-4 * HOUR_MS);
    expect(offsetAt(at('2026-11-01T06:00:00Z'), NY)).toBe(-5 * HOUR_MS);
  });

  it('ignores milliseconds and handles half-hour zones', () => {
    expect(offsetAt(at('2026-07-15T12:00:00.999Z'), NY)).toBe(-4 * HOUR_MS);
    expect(offsetAt(at('2026-07-15T12:00Z'), 'Asia/Kolkata')).toBe(5.5 * HOUR_MS);
  });

  it('throws for an unknown timezone', () => {
    expect(() => offsetAt(0, 'Not/A_Zone')).toThrow(RangeError);
  });
});

describe('localToUtc', () => {
  it('converts ordinary wall times', () => {
    expect(local('2026-09-30', '09:00', JM)).toBe(at('2026-09-30T09:00-05:00'));
    expect(local('2026-07-01', '09:00', NY)).toBe(at('2026-07-01T09:00-04:00'));
    expect(local('2026-01-05', '23:30', NY)).toBe(at('2026-01-05T23:30-05:00'));
  });

  it('keeps 09:00 at 09:00 local on both sides of a DST change', () => {
    expect(local('2026-03-07', '09:00', NY)).toBe(at('2026-03-07T14:00Z'));
    expect(local('2026-03-08', '09:00', NY)).toBe(at('2026-03-08T13:00Z'));
    expect(local('2026-11-01', '09:00', NY)).toBe(at('2026-11-01T14:00Z'));
  });

  it('moves a time skipped by spring-forward forward by the gap', () => {
    expect(local('2026-03-08', '02:30', NY)).toBe(at('2026-03-08T03:30-04:00'));
    expect(local('2026-03-08', '02:00', NY)).toBe(at('2026-03-08T03:00-04:00'));
    expect(local('2026-03-08', '03:00', NY)).toBe(at('2026-03-08T03:00-04:00'));
  });

  it('picks the first of two identical wall times at fall-back', () => {
    expect(local('2026-11-01', '01:30', NY)).toBe(at('2026-11-01T01:30-04:00'));
    expect(local('2026-11-01', '01:00', NY)).toBe(at('2026-11-01T01:00-04:00'));
    expect(local('2026-11-01', '02:00', NY)).toBe(at('2026-11-01T02:00-05:00'));
  });

  it('handles midnight and times past 24 h', () => {
    expect(local('2026-03-08', '00:00', NY)).toBe(at('2026-03-08T00:00-05:00'));
    expect(localToUtc(dayFromDate('2026-03-07'), DAY_MS + 9 * HOUR_MS, NY)).toBe(
      at('2026-03-08T09:00-04:00'),
    );
  });

  test.prop([fc.integer({ min: at('1990-01-01'), max: at('2060-01-01') })])(
    'round-trips every real instant in New York, apart from the repeated fall-back hour',
    (t) => {
      const wall = toLocalMs(t, NY);
      const day = Math.floor(wall / DAY_MS);
      const back = localToUtc(day, wall - day * DAY_MS, NY);
      // Either the same instant, or (in the repeated hour) the first instant with that wall time.
      expect(back === t || (back === t - HOUR_MS && toLocalMs(back, NY) === wall)).toBe(true);
    },
  );
});

describe('calendar days', () => {
  it('converts between dates and day numbers', () => {
    expect(dayFromDate('1970-01-01')).toBe(0);
    expect(dayFromDate('2026-09-30')).toBe(at('2026-09-30T00:00Z') / DAY_MS);
    expect(dateFromDay(dayFromDate('2028-02-29'))).toBe('2028-02-29');
    expect(() => dayFromDate('not-a-date')).toThrow(RangeError);
    expect(() => dayFromDate('2026-02-30')).toThrow(RangeError);
  });

  it('numbers weekdays from Monday = 0', () => {
    expect(weekdayOf(dayFromDate('2026-09-28'))).toBe(0);
    expect(weekdayOf(dayFromDate('2026-09-30'))).toBe(2);
    expect(weekdayOf(dayFromDate('2026-10-04'))).toBe(6);
    expect(weekdayOf(dayFromDate('1969-12-29'))).toBe(0);
    expect(weekdayIndex('mon')).toBe(0);
    expect(weekdayIndex('sun')).toBe(6);
  });

  it('finds the local day of an instant, which may differ from the UTC day', () => {
    // 23:30 in Jamaica is already the next day in UTC.
    expect(dateFromDay(localDayOf(at('2026-09-30T23:30-05:00'), JM))).toBe('2026-09-30');
    expect(dateFromDay(localDayOf(at('2026-09-30T23:30-05:00'), 'UTC'))).toBe('2026-10-01');
  });

  it('parses HH:MM times', () => {
    expect(msFromLocalTime('00:00')).toBe(0);
    expect(msFromLocalTime('22:15')).toBe(22 * HOUR_MS + 15 * 60_000);
    expect(() => msFromLocalTime('noon')).toThrow(RangeError);
  });
});
