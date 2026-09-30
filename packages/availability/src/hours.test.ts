import { DAYS_OF_WEEK } from '@whosfree/shared';
import { describe, expect, it } from 'vitest';
import { availableHoursIntervals, defaultAvailableHours } from './hours';
import { HOUR_MS } from './time';

const at = (iso: string) => Date.parse(iso);
const JM = 'America/Jamaica';
const NY = 'America/New_York';

describe('defaultAvailableHours', () => {
  it('is 08:00–22:00 on every day (D24)', () => {
    const hours = defaultAvailableHours();
    expect(hours.map((h) => h.day)).toEqual([...DAYS_OF_WEEK]);
    expect(hours.every((h) => h.start === '08:00' && h.end === '22:00')).toBe(true);
  });

  it('returns a fresh array each time', () => {
    const hours = defaultAvailableHours();
    hours.pop();
    expect(defaultAvailableHours()).toHaveLength(7);
  });
});

describe('availableHoursIntervals', () => {
  it('gives one window per day in local time', () => {
    const week = { start: at('2026-09-28T00:00-05:00'), end: at('2026-10-05T00:00-05:00') };
    const intervals = availableHoursIntervals(defaultAvailableHours(), week, JM);
    expect(intervals).toHaveLength(7);
    expect(intervals[0]).toEqual({
      start: at('2026-09-28T08:00-05:00'),
      end: at('2026-09-28T22:00-05:00'),
    });
    expect(intervals[6]).toEqual({
      start: at('2026-10-04T08:00-05:00'),
      end: at('2026-10-04T22:00-05:00'),
    });
  });

  it('leaves days without an entry out, and merges several windows on one day', () => {
    const hours = [
      { day: 'wed', start: '08:00', end: '12:00' },
      { day: 'wed', start: '12:00', end: '14:00' },
      { day: 'wed', start: '18:00', end: '20:00' },
    ] as const;
    const range = { start: at('2026-09-28T00:00-05:00'), end: at('2026-10-05T00:00-05:00') };
    expect(availableHoursIntervals(hours, range, JM)).toEqual([
      { start: at('2026-09-30T08:00-05:00'), end: at('2026-09-30T14:00-05:00') },
      { start: at('2026-09-30T18:00-05:00'), end: at('2026-09-30T20:00-05:00') },
    ]);
  });

  it('clips to the range, and returns [] for an empty range or no hours', () => {
    const range = { start: at('2026-09-30T10:00-05:00'), end: at('2026-09-30T12:00-05:00') };
    expect(availableHoursIntervals(defaultAvailableHours(), range, JM)).toEqual([range]);
    expect(availableHoursIntervals(defaultAvailableHours(), { start: 5, end: 5 }, JM)).toEqual([]);
    expect(availableHoursIntervals([], range, JM)).toEqual([]);
  });

  it('reads windows in the local day of a zone far from UTC', () => {
    // 08:00–10:00 Tokyo on Thursday Oct 1 is 23:00–01:00 UTC, starting on Wednesday Sep 30.
    const range = { start: at('2026-09-30T00:00Z'), end: at('2026-10-01T12:00Z') };
    const hours = [{ day: 'thu', start: '08:00', end: '10:00' }] as const;
    expect(availableHoursIntervals(hours, range, 'Asia/Tokyo')).toEqual([
      { start: at('2026-10-01T08:00+09:00'), end: at('2026-10-01T10:00+09:00') },
    ]);
  });

  it('keeps local wall times on DST-change days', () => {
    const hours = [{ day: 'sun', start: '00:00', end: '12:00' }] as const;
    const spring = availableHoursIntervals(
      hours,
      { start: at('2026-03-07T00:00Z'), end: at('2026-03-10T00:00Z') },
      NY,
    );
    expect(spring).toEqual([
      { start: at('2026-03-08T00:00-05:00'), end: at('2026-03-08T12:00-04:00') },
    ]);
    expect((spring[0]?.end ?? 0) - (spring[0]?.start ?? 0)).toBe(11 * HOUR_MS);

    const fall = availableHoursIntervals(
      hours,
      { start: at('2026-10-31T00:00Z'), end: at('2026-11-03T00:00Z') },
      NY,
    );
    expect(fall).toEqual([
      { start: at('2026-11-01T00:00-04:00'), end: at('2026-11-01T12:00-05:00') },
    ]);
    expect((fall[0]?.end ?? 0) - (fall[0]?.start ?? 0)).toBe(13 * HOUR_MS);
  });
});
