import { describe, expect, it } from 'vitest';
import { easterSunday, jamaicanHolidayExceptions, jamaicanPublicHolidays } from './holidays';
import { DateRange } from './schemas';

describe('easterSunday', () => {
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2028, '2028-04-16'],
    [2038, '2038-04-25'],
  ])('%i: %s', (year, date) => {
    expect(easterSunday(year)).toBe(date);
  });
});

describe('jamaicanPublicHolidays (FR-IMP-8)', () => {
  it('lists the ten holidays of 2026 (none on a Sunday; Saturdays are not moved)', () => {
    expect(jamaicanPublicHolidays('2026-01-01', '2026-12-31')).toEqual([
      { date: '2026-01-01', name: "New Year's Day" },
      { date: '2026-02-18', name: 'Ash Wednesday' },
      { date: '2026-04-03', name: 'Good Friday' },
      { date: '2026-04-06', name: 'Easter Monday' },
      { date: '2026-05-23', name: 'Labour Day' },
      { date: '2026-08-01', name: 'Emancipation Day' },
      { date: '2026-08-06', name: 'Independence Day' },
      { date: '2026-10-19', name: 'National Heroes Day' },
      { date: '2026-12-25', name: 'Christmas Day' },
      { date: '2026-12-26', name: 'Boxing Day' },
    ]);
  });

  it('moves Sunday holidays to the Monday after (2027)', () => {
    expect(jamaicanPublicHolidays('2027-01-01', '2027-12-31')).toEqual([
      { date: '2027-01-01', name: "New Year's Day" },
      { date: '2027-02-10', name: 'Ash Wednesday' },
      { date: '2027-03-26', name: 'Good Friday' },
      { date: '2027-03-29', name: 'Easter Monday' },
      { date: '2027-05-24', name: 'Labour Day (observed)' },
      { date: '2027-08-02', name: 'Emancipation Day (observed)' },
      { date: '2027-08-06', name: 'Independence Day' },
      { date: '2027-10-18', name: 'National Heroes Day' },
      { date: '2027-12-25', name: 'Christmas Day' },
      { date: '2027-12-27', name: 'Boxing Day (observed)' },
    ]);
  });

  it('a Sunday Christmas moves past Boxing Day to the Tuesday (2022)', () => {
    expect(jamaicanPublicHolidays('2022-12-20', '2022-12-31')).toEqual([
      { date: '2022-12-26', name: 'Boxing Day' },
      { date: '2022-12-27', name: 'Christmas Day (observed)' },
    ]);
  });

  it('keeps only the days inside the range, across a new year', () => {
    expect(jamaicanPublicHolidays('2026-12-26', '2027-01-01').map((h) => h.date)).toEqual([
      '2026-12-26',
      '2027-01-01',
    ]);
    expect(jamaicanPublicHolidays('2026-09-01', '2026-09-30')).toEqual([]);
    expect(jamaicanPublicHolidays('2026-12-31', '2026-01-01')).toEqual([]);
  });

  it('a semester gets its holidays as one-day exceptions the schema accepts', () => {
    expect(jamaicanHolidayExceptions('2026-08-31', '2026-12-12')).toEqual([
      { start: '2026-10-19', end: '2026-10-19', label: 'National Heroes Day' },
    ]);
    for (const e of jamaicanHolidayExceptions('2026-01-01', '2027-12-31')) {
      expect(DateRange.safeParse(e).success).toBe(true);
    }
  });
});
