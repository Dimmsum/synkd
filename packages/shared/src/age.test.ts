import { describe, expect, it } from 'vitest';
import {
  ageOn,
  checkAge,
  DateOfBirth,
  isAdult,
  localDateIn,
  MAXIMUM_AGE,
  MIN_BIRTH_YEAR,
  MINIMUM_AGE,
} from './age';

const TODAY = '2026-09-30';

describe('isAdult', () => {
  it('lets in someone who turns 18 today', () => {
    expect(isAdult('2008-09-30', TODAY)).toBe(true);
  });

  it('blocks someone who turns 18 tomorrow', () => {
    expect(isAdult('2008-10-01', TODAY)).toBe(false);
  });

  it('lets in someone who turned 18 yesterday', () => {
    expect(isAdult('2008-09-29', TODAY)).toBe(true);
  });

  it('blocks someone born later in the year that makes them 18', () => {
    expect(isAdult('2008-12-31', TODAY)).toBe(false);
    expect(isAdult('2008-01-01', TODAY)).toBe(true);
  });

  it('crosses the year boundary correctly', () => {
    expect(isAdult('2008-01-01', '2025-12-31')).toBe(false);
    expect(isAdult('2008-01-01', '2026-01-01')).toBe(true);
  });

  describe('29 February birthdays', () => {
    it('in a non-leap year, turn 18 on 1 March, not 28 February', () => {
      // 2008-02-29 + 18 years = 2026, not a leap year.
      expect(isAdult('2008-02-29', '2026-02-28')).toBe(false);
      expect(isAdult('2008-02-29', '2026-03-01')).toBe(true);
    });

    it('an 18th birthday is never in a leap year, but other birthdays on 29 February count', () => {
      // A leap birth year plus 18 is never a leap year (18 isn't a multiple of 4), so the
      // 1 March rule always applies to the age gate. Other ages use the real 29 February.
      expect(ageOn('2004-02-29', '2024-02-28')).toBe(19);
      expect(ageOn('2004-02-29', '2024-02-29')).toBe(20);
    });

    it('someone born on 28 February or 1 March is unaffected', () => {
      expect(isAdult('2008-02-28', '2026-02-28')).toBe(true);
      expect(isAdult('2008-03-01', '2026-02-28')).toBe(false);
      expect(isAdult('2008-03-01', '2026-03-01')).toBe(true);
    });
  });

  it('throws for impossible dates', () => {
    expect(() => isAdult('2008-02-30', TODAY)).toThrow(RangeError);
    expect(() => isAdult('2007-02-29', TODAY)).toThrow(RangeError);
    expect(() => isAdult('2008-13-01', TODAY)).toThrow(RangeError);
    expect(() => isAdult('08-09-30', TODAY)).toThrow(RangeError);
    expect(() => isAdult('2008-09-30', 'today')).toThrow(RangeError);
  });

  it('throws for a date of birth in the future', () => {
    expect(() => isAdult('2026-10-01', TODAY)).toThrow(/future/);
  });
});

describe('ageOn', () => {
  it('counts completed years', () => {
    expect(ageOn(TODAY, TODAY)).toBe(0);
    expect(ageOn('1990-10-01', TODAY)).toBe(35);
    expect(ageOn('1990-09-30', TODAY)).toBe(36);
  });
});

describe('checkAge', () => {
  it('returns only the birth year for an adult', () => {
    expect(checkAge('2008-09-30', TODAY)).toEqual({ ok: true, birthYear: 2008 });
    expect(checkAge('1990-05-17', TODAY)).toEqual({ ok: true, birthYear: 1990 });
  });

  it('refuses someone under 18 as under_age', () => {
    expect(checkAge('2008-10-01', TODAY)).toEqual({ ok: false, reason: 'under_age' });
    expect(checkAge(TODAY, TODAY)).toEqual({ ok: false, reason: 'under_age' });
  });

  it('refuses a date of birth in the future', () => {
    expect(checkAge('2026-10-01', TODAY)).toEqual({ ok: false, reason: 'in_future' });
    expect(checkAge('2999-01-01', TODAY)).toEqual({ ok: false, reason: 'in_future' });
  });

  it(`refuses ages over ${MAXIMUM_AGE} as implausible`, () => {
    expect(checkAge('1905-10-01', TODAY)).toEqual({ ok: true, birthYear: 1905 });
    expect(checkAge('1905-09-30', TODAY)).toEqual({ ok: false, reason: 'implausible' });
    expect(checkAge('1901-01-01', TODAY)).toEqual({ ok: false, reason: 'implausible' });
  });

  it.each([
    ['an impossible date', '2008-02-30'],
    ['29 February in a non-leap year', '2007-02-29'],
    ['a year before 1900', '1899-12-31'],
    ['year zero', '0000-01-01'],
    ['a five-digit year', '20080-01-01'],
    ['another format', '30/09/2008'],
    ['a timestamp', '2008-09-30T00:00:00Z'],
    ['an empty string', ''],
    ['a number', 20080930],
    ['null', null],
    ['undefined', undefined],
  ])('refuses %s as invalid_date', (_case, dob) => {
    expect(checkAge(dob, TODAY)).toEqual({ ok: false, reason: 'invalid_date' });
  });

  it('throws if the caller passes an invalid today', () => {
    expect(() => checkAge('2000-01-01', '2026-02-30')).toThrow(RangeError);
  });
});

describe('DateOfBirth', () => {
  it(`accepts real dates from ${MIN_BIRTH_YEAR}`, () => {
    expect(DateOfBirth.safeParse('1900-01-01').success).toBe(true);
    expect(DateOfBirth.safeParse('2004-02-29').success).toBe(true);
    expect(DateOfBirth.safeParse('1899-12-31').success).toBe(false);
  });
});

describe('localDateIn', () => {
  it('defaults to America/Jamaica (UTC-5, no DST)', () => {
    // 04:59 UTC on 1 Oct is still 23:59 on 30 Sep in Kingston.
    expect(localDateIn(Date.UTC(2026, 9, 1, 4, 59))).toBe('2026-09-30');
    expect(localDateIn(Date.UTC(2026, 9, 1, 5, 0))).toBe('2026-10-01');
  });

  it('uses another timezone when given', () => {
    expect(localDateIn(new Date(Date.UTC(2026, 9, 1, 4, 59)), 'UTC')).toBe('2026-10-01');
    expect(localDateIn(Date.UTC(2026, 8, 30, 14, 0), 'Pacific/Kiritimati')).toBe('2026-10-01');
  });

  it('the evening before an 18th birthday is still blocked in Jamaica, though UTC has moved on', () => {
    const eveningBefore = Date.UTC(2026, 9, 1, 2, 0); // 21:00 on 30 Sep in Kingston
    expect(isAdult('2008-10-01', localDateIn(eveningBefore))).toBe(false);
    expect(isAdult('2008-10-01', localDateIn(eveningBefore, 'UTC'))).toBe(true);
  });
});

it('the minimum age is 18 (D13)', () => {
  expect(MINIMUM_AGE).toBe(18);
});
