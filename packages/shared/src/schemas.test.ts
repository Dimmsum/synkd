import { describe, expect, it } from 'vitest';
import {
  AvailableHours,
  DisplayName,
  EventDraft,
  LocalTime,
  OfflineFriendNickname,
  ParseDraft,
  PingText,
  SchedulePeriod,
  StatusLabel,
  Tier,
} from './schemas';

const lecture = {
  title: 'COMP2140 Lecture',
  category: 'class',
  start: '09:00',
  end: '10:30',
  when: { kind: 'weekly', days: ['mon', 'wed'], pattern: { type: 'every' } },
  confidence: 0.92,
} as const;

describe('EventDraft', () => {
  it('accepts a weekly event', () => {
    expect(EventDraft.parse(lecture)).toEqual(lecture);
  });

  it('accepts alternating-week and week-number patterns', () => {
    const ab = {
      ...lecture,
      when: { ...lecture.when, pattern: { type: 'alternating', parity: 'even' } },
    };
    const weeks = {
      ...lecture,
      when: { ...lecture.when, pattern: { type: 'weeks', weeks: [1, 2, 3, 4, 5, 6, 8, 9] } },
    };
    expect(EventDraft.safeParse(ab).success).toBe(true);
    expect(EventDraft.safeParse(weeks).success).toBe(true);
  });

  it('accepts an event on a specific date', () => {
    const shift = { ...lecture, category: 'work', when: { kind: 'date', date: '2026-10-14' } };
    expect(EventDraft.safeParse(shift).success).toBe(true);
  });

  it('accepts an overnight event (end before start)', () => {
    expect(EventDraft.safeParse({ ...lecture, start: '22:00', end: '06:00' }).success).toBe(true);
  });

  it('rejects a zero-length event', () => {
    expect(EventDraft.safeParse({ ...lecture, end: '09:00' }).success).toBe(false);
  });

  it('never keeps a location, room or other unknown field (D35)', () => {
    const parsed = EventDraft.parse({
      ...lecture,
      location: 'SLT 3',
      room: 'C4',
      studentId: '620012345',
    });
    expect(parsed).not.toHaveProperty('location');
    expect(parsed).not.toHaveProperty('room');
    expect(parsed).not.toHaveProperty('studentId');
  });

  it.each([
    ['empty title', { title: '   ' }],
    ['title over 120 chars', { title: 'x'.repeat(121) }],
    ['unknown category', { category: 'party' }],
    ['confidence above 1', { confidence: 1.01 }],
    ['confidence below 0', { confidence: -0.1 }],
    ['no days', { when: { kind: 'weekly', days: [], pattern: { type: 'every' } } }],
    [
      'duplicate days',
      { when: { kind: 'weekly', days: ['mon', 'mon'], pattern: { type: 'every' } } },
    ],
    ['week 0', { when: { kind: 'weekly', days: ['mon'], pattern: { type: 'weeks', weeks: [0] } } }],
    [
      'duplicate weeks',
      { when: { kind: 'weekly', days: ['mon'], pattern: { type: 'weeks', weeks: [2, 2] } } },
    ],
    [
      'empty weeks',
      { when: { kind: 'weekly', days: ['mon'], pattern: { type: 'weeks', weeks: [] } } },
    ],
    ['impossible date', { when: { kind: 'date', date: '2026-02-30' } }],
    ['unknown recurrence', { when: { kind: 'monthly' } }],
  ])('rejects %s', (_name, patch) => {
    expect(EventDraft.safeParse({ ...lecture, ...patch }).success).toBe(false);
  });

  it('trims the title', () => {
    expect(EventDraft.parse({ ...lecture, title: '  Lab  ' }).title).toBe('Lab');
  });
});

describe('LocalTime', () => {
  it.each(['00:00', '09:05', '23:59'])('accepts %s', (t) => {
    expect(LocalTime.safeParse(t).success).toBe(true);
  });
  it.each(['24:00', '9:00', '12:60', '12:00:00', '12h00', ''])('rejects %s', (t) => {
    expect(LocalTime.safeParse(t).success).toBe(false);
  });
});

describe('SchedulePeriod', () => {
  it('defaults exceptions to an empty list', () => {
    expect(SchedulePeriod.parse({ start: '2026-09-01', end: '2026-12-15' }).exceptions).toEqual([]);
  });
  it('accepts a single-day period', () => {
    expect(SchedulePeriod.safeParse({ start: '2026-09-01', end: '2026-09-01' }).success).toBe(true);
  });
  it('rejects an end before the start', () => {
    expect(SchedulePeriod.safeParse({ start: '2026-12-15', end: '2026-09-01' }).success).toBe(
      false,
    );
  });
  it('rejects a backwards exception', () => {
    const period = {
      start: '2026-09-01',
      end: '2026-12-15',
      exceptions: [{ start: '2026-10-20', end: '2026-10-19', label: 'Reading week' }],
    };
    expect(SchedulePeriod.safeParse(period).success).toBe(false);
  });
});

describe('ParseDraft', () => {
  it('accepts an empty draft', () => {
    expect(ParseDraft.safeParse({ events: [] }).success).toBe(true);
  });
  it('rejects the whole draft if any event is invalid (NFR-SEC-7)', () => {
    expect(ParseDraft.safeParse({ events: [lecture, { ...lecture, start: 'soon' }] }).success).toBe(
      false,
    );
  });
  it('caps the number of events', () => {
    expect(ParseDraft.safeParse({ events: Array(201).fill(lecture) }).success).toBe(false);
  });
});

describe('AvailableHours', () => {
  it('accepts the default window', () => {
    expect(AvailableHours.safeParse({ day: 'mon', start: '08:00', end: '22:00' }).success).toBe(
      true,
    );
  });
  it('rejects an end at or before the start', () => {
    expect(AvailableHours.safeParse({ day: 'mon', start: '22:00', end: '08:00' }).success).toBe(
      false,
    );
    expect(AvailableHours.safeParse({ day: 'mon', start: '08:00', end: '08:00' }).success).toBe(
      false,
    );
  });
});

describe('Tier', () => {
  it.each([1, 2, 3])('accepts %s', (t) => expect(Tier.safeParse(t).success).toBe(true));
  it.each([0, 4, 1.5, '1'])('rejects %s', (t) => expect(Tier.safeParse(t).success).toBe(false));
});

describe('PingText', () => {
  it('accepts exactly 140 characters', () => {
    expect(PingText.safeParse('a'.repeat(140)).success).toBe(true);
  });
  it('rejects 141 characters', () => {
    expect(PingText.safeParse('a'.repeat(141)).success).toBe(false);
  });
  it('counts an emoji as one character', () => {
    expect(PingText.safeParse('🍗'.repeat(140)).success).toBe(true);
  });
  it('rejects whitespace-only text', () => {
    expect(PingText.safeParse('   ').success).toBe(false);
  });
});

describe('OfflineFriendNickname', () => {
  it('trims and accepts 1 to 40 characters', () => {
    expect(OfflineFriendNickname.parse('  Tash ')).toBe('Tash');
    expect(OfflineFriendNickname.safeParse('a'.repeat(40)).success).toBe(true);
  });
  it('rejects blank and 41 characters', () => {
    expect(OfflineFriendNickname.safeParse('   ').success).toBe(false);
    expect(OfflineFriendNickname.safeParse('a'.repeat(41)).success).toBe(false);
  });
  it('counts an emoji as one character', () => {
    expect(OfflineFriendNickname.safeParse('🍗'.repeat(40)).success).toBe(true);
  });
  it('rejects control characters', () => {
    expect(OfflineFriendNickname.safeParse('Ta\u0000sh').success).toBe(false);
    expect(OfflineFriendNickname.safeParse('Ta\u0007sh').success).toBe(false);
  });
});

describe('StatusLabel', () => {
  it('trims and accepts 1 to 40 characters', () => {
    expect(StatusLabel.parse('  Revising for MATH1141 ')).toBe('Revising for MATH1141');
    expect(StatusLabel.safeParse('a'.repeat(40)).success).toBe(true);
  });
  it('rejects blank, 41 characters and control characters', () => {
    expect(StatusLabel.safeParse('  ').success).toBe(false);
    expect(StatusLabel.safeParse('a'.repeat(41)).success).toBe(false);
    expect(StatusLabel.safeParse('Rev\u0000ising').success).toBe(false);
  });
  it('counts an emoji as one character', () => {
    expect(StatusLabel.safeParse('📚'.repeat(40)).success).toBe(true);
  });
});

describe('DisplayName', () => {
  it('trims and accepts 1 to 100 characters', () => {
    expect(DisplayName.parse(' Kemar Brown ')).toBe('Kemar Brown');
    expect(DisplayName.safeParse('a'.repeat(100)).success).toBe(true);
  });
  it('rejects blank, 101 characters and control characters', () => {
    expect(DisplayName.safeParse('   ').success).toBe(false);
    expect(DisplayName.safeParse('a'.repeat(101)).success).toBe(false);
    expect(DisplayName.safeParse('Ke\u0007mar').success).toBe(false);
  });
});
