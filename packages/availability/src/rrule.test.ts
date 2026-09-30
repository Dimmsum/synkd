import { describe, expect, it } from 'vitest';
import { formatUtcDateTime, parseRRule } from './rrule';
import { dayFromDate } from './time';

describe('parseRRule', () => {
  it('parses the weekly rules we write', () => {
    expect(parseRRule('FREQ=WEEKLY;INTERVAL=2;WKST=MO;BYDAY=WE,MO')).toEqual({
      freq: 'WEEKLY',
      interval: 2,
      byDay: [0, 2],
      count: null,
      until: null,
      weekStart: 0,
    });
    expect(parseRRule('FREQ=WEEKLY;WKST=MO;BYDAY=TU;UNTIL=20261212T140000Z').until).toEqual({
      kind: 'instant',
      at: Date.parse('2026-12-12T14:00:00Z'),
    });
  });

  it('fills in RFC 5545 defaults', () => {
    expect(parseRRule('FREQ=DAILY')).toEqual({
      freq: 'DAILY',
      interval: 1,
      byDay: null,
      count: null,
      until: null,
      weekStart: 0,
    });
  });

  it('accepts a prefix, lower case, spaces, duplicate days and a trailing semicolon', () => {
    expect(parseRRule(' RRULE:freq=weekly; byday=su,mo,su; wkst=su; count=4; ')).toEqual({
      freq: 'WEEKLY',
      interval: 1,
      byDay: [0, 6],
      count: 4,
      until: null,
      weekStart: 6,
    });
  });

  it('parses a date-only UNTIL as a local date', () => {
    expect(parseRRule('FREQ=WEEKLY;UNTIL=20261212').until).toEqual({
      kind: 'date',
      day: dayFromDate('2026-12-12'),
    });
  });

  it.each([
    ['', /FREQ/],
    ['INTERVAL=2', /FREQ/],
    ['FREQ=MONTHLY', /FREQ: MONTHLY/],
    ['FREQ=WEEKLY;INTERVAL=0', /INTERVAL/],
    ['FREQ=WEEKLY;COUNT=-1', /COUNT/],
    ['FREQ=WEEKLY;BYDAY=2MO', /weekday: 2MO/],
    ['FREQ=WEEKLY;WKST=XX', /weekday: XX/],
    ['FREQ=WEEKLY;BYMONTH=1', /part: BYMONTH/],
    ['FREQ=WEEKLY;COUNT=2;UNTIL=20261212', /both COUNT and UNTIL/],
    ['FREQ=WEEKLY;FREQ=DAILY', /Malformed/],
    ['FREQ', /Malformed/],
    ['FREQ=WEEKLY;BYDAY=MO=TU', /Malformed/],
    ['=WEEKLY', /Malformed/],
    ['FREQ=WEEKLY;UNTIL=tomorrow', /UNTIL/],
    ['FREQ=WEEKLY;UNTIL=20261212T140000', /UNTIL/],
    ['FREQ=WEEKLY;UNTIL=20261312T140000Z', /UNTIL/],
    ['FREQ=WEEKLY;UNTIL=20261332', /Invalid date/],
  ])('rejects %j', (rule, message) => {
    expect(() => parseRRule(rule)).toThrow(RangeError);
    expect(() => parseRRule(rule)).toThrow(message);
  });
});

describe('formatUtcDateTime', () => {
  it('formats an instant as an RFC 5545 UTC date-time', () => {
    expect(formatUtcDateTime(Date.parse('2026-12-12T09:05:07.000Z'))).toBe('20261212T090507Z');
  });
});
