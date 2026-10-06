import { describe, expect, it } from 'vitest';
import { DAYS_OF_WEEK } from '@synkd/shared';
import type { AvailableHoursDay } from '@/lib/types';
import { daysToWeekly, weeklyToDays } from './available-hours';

const everyDay = (start: string, end: string): AvailableHoursDay[] =>
  DAYS_OF_WEEK.map((day) => ({ day, enabled: true, start, end }));

describe('weeklyToDays (FR-AVL-2)', () => {
  it('reads the database default as 08:00–22:00 every day (D24)', () => {
    const weekly = DAYS_OF_WEEK.map((day) => ({ day, start: '08:00', end: '22:00' }));
    expect(weeklyToDays(weekly)).toEqual(everyDay('08:00', '22:00'));
  });

  it('shows a missing day as switched off, with the default times', () => {
    const days = weeklyToDays([{ day: 'sat', start: '10:00', end: '23:30' }]);
    expect(days.map((d) => d.day)).toEqual([...DAYS_OF_WEEK]);
    expect(days.find((d) => d.day === 'sat')).toEqual({
      day: 'sat',
      enabled: true,
      start: '10:00',
      end: '23:30',
    });
    expect(days.find((d) => d.day === 'mon')).toEqual({
      day: 'mon',
      enabled: false,
      start: '08:00',
      end: '22:00',
    });
  });

  it('treats an empty week, or anything that is not an array, as away every day', () => {
    expect(weeklyToDays([]).every((d) => !d.enabled)).toBe(true);
    expect(weeklyToDays(null).every((d) => !d.enabled)).toBe(true);
    expect(weeklyToDays({ mon: '08:00' }).every((d) => !d.enabled)).toBe(true);
  });

  it('ignores invalid entries and keeps the first window for a day', () => {
    const days = weeklyToDays([
      { day: 'mon', start: '22:00', end: '08:00' },
      { day: 'tue', start: '09:00', end: '17:00' },
      { day: 'tue', start: '10:00', end: '18:00' },
      { day: 'xyz', start: '09:00', end: '17:00' },
    ]);
    expect(days[0]?.enabled).toBe(false);
    expect(days[1]).toEqual({ day: 'tue', enabled: true, start: '09:00', end: '17:00' });
  });
});

describe('daysToWeekly (FR-AVL-2)', () => {
  it('stores every day switched on, in mon..sun order', () => {
    const days = [...everyDay('08:00', '22:00')].reverse();
    const result = daysToWeekly(days);
    expect(result).toEqual({
      ok: true,
      weekly: DAYS_OF_WEEK.map((day) => ({ day, start: '08:00', end: '22:00' })),
    });
  });

  it('leaves out days switched off, even with bad times', () => {
    const days = everyDay('08:00', '22:00').map((d) =>
      d.day === 'sun' ? { ...d, enabled: false, start: '23:00', end: '01:00' } : d,
    );
    const result = daysToWeekly(days);
    expect(result.ok && result.weekly.map((h) => h.day)).toEqual([
      'mon',
      'tue',
      'wed',
      'thu',
      'fri',
      'sat',
    ]);
  });

  it('rejects an end at or before the start (no overnight windows)', () => {
    const days = everyDay('08:00', '22:00').map((d) =>
      d.day === 'wed' ? { ...d, start: '22:00', end: '02:00' } : d,
    );
    expect(daysToWeekly(days)).toEqual({ ok: false, reason: 'invalid_day', day: 'wed' });
    expect(daysToWeekly([{ day: 'mon', enabled: true, start: '09:00', end: '09:00' }]).ok).toBe(
      false,
    );
  });

  it('rejects malformed times and a day given twice (one window per day)', () => {
    expect(daysToWeekly([{ day: 'mon', enabled: true, start: '9:00', end: '17:00' }]).ok).toBe(
      false,
    );
    expect(
      daysToWeekly([
        { day: 'mon', enabled: true, start: '09:00', end: '12:00' },
        { day: 'mon', enabled: true, start: '13:00', end: '17:00' },
      ]),
    ).toEqual({ ok: false, reason: 'duplicate_day', day: 'mon' });
  });

  it('round-trips through weeklyToDays', () => {
    const result = daysToWeekly(weeklyToDays([{ day: 'fri', start: '07:30', end: '23:00' }]));
    expect(result).toEqual({ ok: true, weekly: [{ day: 'fri', start: '07:30', end: '23:00' }] });
  });
});
