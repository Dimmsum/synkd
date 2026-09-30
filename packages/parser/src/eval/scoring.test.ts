import type { DayOfWeek, EventDraft, ParseDraft, WeekPattern } from '@whosfree/shared';
import { describe, expect, it } from 'vitest';
import {
  expandUnits,
  matchUnits,
  median,
  normalizeTitle,
  percentile,
  samePattern,
  scoreSample,
  summarizeScores,
  titleSimilarity,
  toMinutes,
} from './scoring';

function weekly(
  title: string,
  days: DayOfWeek[],
  start: string,
  end: string,
  extra: { category?: EventDraft['category']; pattern?: WeekPattern } = {},
): EventDraft {
  return {
    title,
    category: extra.category ?? 'class',
    start,
    end,
    when: { kind: 'weekly', days, pattern: extra.pattern ?? { type: 'every' } },
    confidence: 1,
  };
}

function dated(title: string, date: string, start: string, end: string): EventDraft {
  return { title, category: 'work', start, end, when: { kind: 'date', date }, confidence: 1 };
}

const draft = (
  events: EventDraft[],
  suggestedPeriod?: ParseDraft['suggestedPeriod'],
): ParseDraft => (suggestedPeriod ? { events, suggestedPeriod } : { events });

describe('toMinutes / expandUnits', () => {
  it('converts HH:MM to minutes', () => {
    expect(toMinutes('00:00')).toBe(0);
    expect(toMinutes('09:30')).toBe(570);
    expect(toMinutes('23:59')).toBe(1439);
  });

  it('makes one unit per day of a weekly event', () => {
    const units = expandUnits([weekly('Maths', ['mon', 'wed'], '09:00', '10:00')]);
    expect(units.map((u) => u.key)).toEqual(['w:mon', 'w:wed']);
    expect(units.every((u) => u.event === 0)).toBe(true);
  });

  it('keys dated events by date and gives them no pattern', () => {
    const [unit] = expandUnits([dated('Shift', '2026-10-05', '08:00', '16:00')]);
    expect(unit).toMatchObject({ key: 'd:2026-10-05', pattern: null });
  });

  it('moves the end of an overnight event into the next day', () => {
    const [unit] = expandUnits([dated('Night shift', '2026-10-05', '22:00', '06:00')]);
    expect(unit).toMatchObject({ start: 1320, end: 1800 });
  });
});

describe('titles', () => {
  it('normalises case, accents and punctuation', () => {
    expect(normalizeTitle('  Café – Intro to ÉCON!! ')).toBe('cafe intro to econ');
  });

  it('keeps letters from any script', () => {
    expect(normalizeTitle('数学 101')).toBe('数学 101');
  });

  it('scores equal titles 1 regardless of formatting', () => {
    expect(titleSimilarity('COMP1161 - Lecture', 'comp1161 lecture')).toBe(1);
  });

  it('scores a title that contains a course code of the other as 0.9', () => {
    expect(titleSimilarity('COMP1161', 'COMP1161 Object-Oriented Programming')).toBe(0.9);
  });

  it('scores word containment covering half the words as 0.9', () => {
    expect(titleSimilarity('Chemistry Lab', 'Organic Chemistry Lab')).toBe(0.9);
  });

  it("doesn't treat a single generic word as containment", () => {
    expect(titleSimilarity('Lab', 'Organic Chemistry Lab')).toBeLessThan(0.5);
  });

  it('scores small typos high and unrelated titles low', () => {
    expect(titleSimilarity('Programming', 'Programing')).toBeGreaterThan(0.9);
    expect(titleSimilarity('Physics', 'Spanish Literature')).toBeLessThan(0.3);
  });

  it('scores an empty title 0 against a real one', () => {
    expect(titleSimilarity('!!!', 'Maths')).toBe(0);
  });
});

describe('samePattern', () => {
  it('compares types and parities', () => {
    expect(samePattern({ type: 'every' }, { type: 'every' })).toBe(true);
    expect(samePattern({ type: 'every' }, { type: 'alternating', parity: 'odd' })).toBe(false);
    expect(
      samePattern({ type: 'alternating', parity: 'odd' }, { type: 'alternating', parity: 'even' }),
    ).toBe(false);
  });

  it('compares week lists as sets', () => {
    expect(
      samePattern({ type: 'weeks', weeks: [3, 1, 2] }, { type: 'weeks', weeks: [1, 2, 3] }),
    ).toBe(true);
    expect(samePattern({ type: 'weeks', weeks: [1, 2] }, { type: 'weeks', weeks: [1, 2, 3] })).toBe(
      false,
    );
  });

  it('treats dated units (null) as equal only to each other', () => {
    expect(samePattern(null, null)).toBe(true);
    expect(samePattern(null, { type: 'every' })).toBe(false);
  });
});

describe('matchUnits', () => {
  it('never matches across days', () => {
    const p = expandUnits([weekly('Maths', ['tue'], '09:00', '10:00')]);
    const e = expandUnits([weekly('Maths', ['mon'], '09:00', '10:00')]);
    expect(matchUnits(p, e)).toEqual([]);
  });

  it('matches on title even when the times are off', () => {
    const p = expandUnits([weekly('Maths', ['mon'], '11:00', '12:00')]);
    const e = expandUnits([weekly('Maths', ['mon'], '09:00', '10:00')]);
    expect(matchUnits(p, e)).toEqual([{ predicted: 0, expected: 0 }]);
  });

  it('matches on time alone when the title is wrong', () => {
    const p = expandUnits([weekly('Physics', ['mon'], '09:03', '10:00')]);
    const e = expandUnits([weekly('Spanish', ['mon'], '09:00', '10:00')]);
    expect(matchUnits(p, e)).toHaveLength(1);
  });

  it("doesn't match when both title and time are wrong", () => {
    const p = expandUnits([weekly('Physics', ['mon'], '09:30', '10:30')]);
    const e = expandUnits([weekly('Spanish', ['mon'], '09:00', '10:00')]);
    expect(matchUnits(p, e)).toEqual([]);
  });

  it('pairs a repeated title by the closest time', () => {
    const p = expandUnits([
      weekly('Tutorial', ['mon'], '14:00', '15:00'),
      weekly('Tutorial', ['mon'], '09:00', '10:00'),
    ]);
    const e = expandUnits([
      weekly('Tutorial', ['mon'], '09:00', '10:00'),
      weekly('Tutorial', ['mon'], '14:00', '15:00'),
    ]);
    expect(matchUnits(p, e)).toEqual([
      { predicted: 1, expected: 0 },
      { predicted: 0, expected: 1 },
    ]);
  });

  it('uses each unit at most once', () => {
    const p = expandUnits([weekly('Maths', ['mon'], '09:00', '10:00')]);
    const e = expandUnits([
      weekly('Maths', ['mon'], '09:00', '10:00'),
      weekly('Maths', ['mon'], '09:00', '10:00'),
    ]);
    expect(matchUnits(p, e)).toHaveLength(1);
  });
});

describe('scoreSample', () => {
  const expected = draft([
    weekly('COMP1161 Lecture', ['mon', 'wed'], '09:00', '10:00'),
    weekly('COMP1161 Lab', ['fri'], '13:00', '15:00', { category: 'lab' }),
  ]);

  it('gives a perfect prediction full marks and zero edits', () => {
    const s = scoreSample(expected, expected);
    expect(s.events).toEqual({
      expected: 3,
      predicted: 3,
      matched: 3,
      recall: 1,
      precision: 1,
      f1: 1,
    });
    expect(s.time).toEqual({ matched: 3, exact: 3, within5: 3 });
    expect(s.recurrence).toMatchObject({ weeklyMatched: 3, patternCorrect: 3, rangeCorrect: true });
    expect(s.edits).toEqual({
      adds: 0,
      deletes: 0,
      fieldChanges: 0,
      period: 0,
      total: 0,
      acceptable: true,
    });
  });

  it('scores the same schedule split into one event per day as perfect', () => {
    const split = draft([
      weekly('COMP1161 Lecture', ['mon'], '09:00', '10:00'),
      weekly('COMP1161 Lecture', ['wed'], '09:00', '10:00'),
      weekly('COMP1161 Lab', ['fri'], '13:00', '15:00', { category: 'lab' }),
    ]);
    expect(scoreSample(split, expected).edits.total).toBe(0);
  });

  it('scores a failed parse (null) as an empty draft', () => {
    const s = scoreSample(null, expected);
    expect(s.events).toEqual({
      expected: 3,
      predicted: 0,
      matched: 0,
      recall: 0,
      precision: 1,
      f1: 0,
    });
    expect(s.time).toEqual({ matched: 0, exact: 0, within5: 0 });
    // Two events to add, not three units.
    expect(s.edits).toMatchObject({ adds: 2, deletes: 0, total: 2, acceptable: true });
  });

  it('treats an empty expected and empty predicted draft as perfect', () => {
    const s = scoreSample(draft([]), draft([]));
    expect(s.events).toMatchObject({ recall: 1, precision: 1, f1: 1 });
    expect(s.edits.total).toBe(0);
  });

  it('counts events invented from a blank file as deletes', () => {
    const s = scoreSample(expected, draft([]));
    expect(s.events).toMatchObject({ recall: 1, precision: 0, f1: 0 });
    expect(s.edits).toMatchObject({ deletes: 2, total: 2 });
  });

  it('counts a missing day as one edit on the event', () => {
    const pred = draft([
      weekly('COMP1161 Lecture', ['mon'], '09:00', '10:00'),
      weekly('COMP1161 Lab', ['fri'], '13:00', '15:00', { category: 'lab' }),
    ]);
    const s = scoreSample(pred, expected);
    expect(s.events).toMatchObject({ matched: 2, recall: 2 / 3, precision: 1 });
    expect(s.edits).toMatchObject({ adds: 1, deletes: 0, fieldChanges: 0, total: 1 });
  });

  it('counts an extra day as one edit on the event', () => {
    const pred = draft([
      weekly('COMP1161 Lecture', ['mon', 'wed', 'thu'], '09:00', '10:00'),
      weekly('COMP1161 Lab', ['fri'], '13:00', '15:00', { category: 'lab' }),
    ]);
    const s = scoreSample(pred, expected);
    expect(s.events).toMatchObject({ predicted: 4, matched: 3, precision: 0.75 });
    expect(s.edits).toMatchObject({ adds: 0, deletes: 1, total: 1 });
  });

  it('separates exact times from times within 5 minutes and counts time edits', () => {
    const pred = draft([
      weekly('COMP1161 Lecture', ['mon', 'wed'], '09:05', '10:00'),
      weekly('COMP1161 Lab', ['fri'], '13:00', '15:10', { category: 'lab' }),
    ]);
    const s = scoreSample(pred, expected);
    expect(s.time).toEqual({ matched: 3, exact: 0, within5: 2 });
    // One wrong start on the lecture (one event, two days) and one wrong end on the lab.
    expect(s.edits).toMatchObject({ fieldChanges: 2, total: 2 });
  });

  it('counts title, category and pattern changes as separate field edits', () => {
    const exp = draft([
      weekly('Organic Chemistry', ['tue'], '10:00', '12:00', { category: 'lab' }),
    ]);
    const pred = draft([
      weekly('Physics', ['tue'], '10:00', '12:00', {
        category: 'class',
        pattern: { type: 'alternating', parity: 'odd' },
      }),
    ]);
    const s = scoreSample(pred, exp);
    expect(s.events.matched).toBe(1);
    expect(s.recurrence).toMatchObject({ weeklyMatched: 1, patternCorrect: 0 });
    expect(s.edits).toMatchObject({ fieldChanges: 3, total: 3, acceptable: true });
  });

  it("doesn't count a title edit for a close-enough title", () => {
    const exp = draft([weekly('COMP1161 Object-Oriented Programming', ['tue'], '10:00', '12:00')]);
    const pred = draft([weekly('COMP1161', ['tue'], '10:00', '12:00')]);
    expect(scoreSample(pred, exp).edits.total).toBe(0);
  });

  it('scores week-number patterns as sets', () => {
    const exp = draft([
      weekly('Lab', ['thu'], '14:00', '16:00', { pattern: { type: 'weeks', weeks: [1, 3, 5] } }),
    ]);
    const good = draft([
      weekly('Lab', ['thu'], '14:00', '16:00', { pattern: { type: 'weeks', weeks: [5, 3, 1] } }),
    ]);
    const bad = draft([
      weekly('Lab', ['thu'], '14:00', '16:00', { pattern: { type: 'weeks', weeks: [1, 3] } }),
    ]);
    expect(scoreSample(good, exp).recurrence.patternCorrect).toBe(1);
    expect(scoreSample(bad, exp).recurrence.patternCorrect).toBe(0);
  });

  it('scores dated events (rosters) and keeps them out of pattern accuracy', () => {
    const exp = draft([
      dated('Shift', '2026-10-05', '08:00', '16:00'),
      dated('Shift', '2026-10-07', '22:00', '06:00'),
    ]);
    const pred = draft([
      dated('Shift', '2026-10-05', '08:00', '16:00'),
      dated('Shift', '2026-10-08', '22:00', '06:00'),
    ]);
    const s = scoreSample(pred, exp);
    expect(s.events).toMatchObject({ matched: 1, recall: 0.5, precision: 0.5 });
    expect(s.recurrence.weeklyMatched).toBe(0);
    expect(s.edits).toMatchObject({ adds: 1, deletes: 1, total: 2 });
  });

  it("doesn't match a weekly prediction to a dated expectation", () => {
    const exp = draft([dated('Shift', '2026-10-05', '08:00', '16:00')]);
    const pred = draft([weekly('Shift', ['mon'], '08:00', '16:00')]);
    expect(scoreSample(pred, exp).events.matched).toBe(0);
  });

  it('matches overnight events by their real end time', () => {
    const exp = draft([weekly('Night shift', ['sat'], '22:00', '06:00', { category: 'work' })]);
    const pred = draft([weekly('Night shift', ['sat'], '22:00', '06:00', { category: 'work' })]);
    expect(scoreSample(pred, exp).time.exact).toBe(1);
  });

  it('marks more than 3 edits as not acceptable', () => {
    const exp = draft([
      weekly('A1', ['mon'], '08:00', '09:00'),
      weekly('B2', ['tue'], '08:00', '09:00'),
      weekly('C3', ['wed'], '08:00', '09:00'),
      weekly('D4', ['thu'], '08:00', '09:00'),
    ]);
    const s = scoreSample(draft([]), exp);
    expect(s.edits).toMatchObject({ total: 4, acceptable: false });
  });

  describe('suggested period', () => {
    const period = {
      start: '2026-09-01',
      end: '2026-12-15',
      exceptions: [
        { start: '2026-10-20', end: '2026-10-20', label: 'Heroes Day' },
        { start: '2026-11-02', end: '2026-11-06', label: 'Reading week' },
      ],
    };
    const events = [weekly('Maths', ['mon'], '09:00', '10:00')];

    it('is correct when neither side has one', () => {
      const s = scoreSample(draft(events), draft(events));
      expect(s.recurrence.rangeCorrect).toBe(true);
      expect(s.edits.period).toBe(0);
    });

    it('is correct when equal, ignoring exception labels', () => {
      const pred = {
        ...period,
        exceptions: period.exceptions.map((e) => ({ start: e.start, end: e.end })),
      };
      const s = scoreSample(draft(events, pred), draft(events, period));
      expect(s.recurrence).toMatchObject({
        rangeCorrect: true,
        exceptions: { expected: 2, predicted: 2, matched: 2 },
      });
      expect(s.edits.period).toBe(0);
    });

    it('costs one edit for a wrong range, and one per missing or extra exception', () => {
      const pred = {
        start: '2026-09-02',
        end: '2026-12-15',
        exceptions: [period.exceptions[0]!, { start: '2026-12-01', end: '2026-12-01' }],
      };
      const s = scoreSample(draft(events, pred), draft(events, period));
      expect(s.recurrence).toMatchObject({
        rangeCorrect: false,
        exceptions: { expected: 2, predicted: 2, matched: 1 },
      });
      expect(s.edits.period).toBe(3);
    });

    it('costs the range plus every exception when the period is missing', () => {
      const s = scoreSample(draft(events), draft(events, period));
      expect(s.recurrence.rangeCorrect).toBe(false);
      expect(s.edits.period).toBe(3);
    });

    it('costs one edit to remove an invented period, exceptions included', () => {
      const s = scoreSample(draft(events, period), draft(events));
      expect(s.recurrence).toMatchObject({
        rangeCorrect: false,
        exceptions: { expected: 0, predicted: 2, matched: 0 },
      });
      expect(s.edits.period).toBe(1);
    });
  });
});

describe('summarizeScores', () => {
  it('micro-averages events and reports acceptance', () => {
    const perfect = draft([weekly('Maths', ['mon'], '09:00', '10:00')]);
    const big = draft([
      weekly('A1', ['mon'], '08:00', '09:00'),
      weekly('B2', ['tue'], '08:00', '09:00'),
      weekly('C3', ['wed'], '08:00', '09:00'),
      weekly('D4', ['thu'], '08:00', '09:00'),
    ]);
    const summary = summarizeScores([scoreSample(perfect, perfect), scoreSample(null, big)]);
    expect(summary.samples).toBe(2);
    expect(summary.acceptance).toBe(0.5);
    expect(summary.events).toMatchObject({
      expected: 5,
      predicted: 1,
      matched: 1,
      recall: 0.2,
      precision: 1,
    });
    expect(summary.macroF1).toBe(0.5);
    expect(summary.timeExactRate).toBe(1);
    expect(summary.patternAccuracy).toBe(1);
    expect(summary.rangeAccuracy).toBe(1);
    expect(summary.exceptionRecall).toBeNull();
    expect(summary.edits).toEqual({ mean: 2, median: 2, max: 4 });
  });

  it('returns nulls for an empty run', () => {
    const summary = summarizeScores([]);
    expect(summary.acceptance).toBeNull();
    expect(summary.timeExactRate).toBeNull();
    expect(summary.edits).toEqual({ mean: null, median: null, max: null });
  });
});

describe('median / percentile', () => {
  it('computes medians of odd and even lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('uses nearest rank for percentiles', () => {
    const xs = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(xs, 95)).toBe(19);
    expect(percentile(xs, 50)).toBe(10);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 95)).toBeNull();
  });
});
