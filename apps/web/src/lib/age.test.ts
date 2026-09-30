import { describe, expect, it } from 'vitest';
import { ageOn, checkAge } from './age';

describe('age gate (WF-005)', () => {
  const today = '2026-09-30';

  it('lets in someone turning 18 today', () => {
    expect(checkAge('2008-09-30', today)).toEqual({ ok: true, birthYear: 2008 });
  });

  it('blocks someone turning 18 tomorrow', () => {
    expect(checkAge('2008-10-01', today)).toEqual({ ok: false, reason: 'under_18' });
  });

  it('only returns the birth year', () => {
    const result = checkAge('1999-04-12', today);
    expect(result).toEqual({ ok: true, birthYear: 1999 });
    expect(Object.keys(result)).not.toContain('dateOfBirth');
  });

  it('rejects impossible and future dates', () => {
    expect(checkAge('2000-02-30', today)).toEqual({ ok: false, reason: 'invalid' });
    expect(checkAge('not a date', today)).toEqual({ ok: false, reason: 'invalid' });
    expect(checkAge('2027-01-01', today)).toEqual({ ok: false, reason: 'future' });
  });

  it('treats Feb 29 birthdays as turning a year older on Mar 1 in common years', () => {
    expect(ageOn('2008-02-29', '2026-02-28')).toBe(17);
    expect(ageOn('2008-02-29', '2026-03-01')).toBe(18);
  });
});
