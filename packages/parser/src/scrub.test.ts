import { describe, expect, it } from 'vitest';
import { scrubDraft, scrubTitle } from './scrub';

describe('scrubTitle (D35)', () => {
  it.each([
    ['COMP1161 Lecture - Room 12', 'COMP1161 Lecture'],
    ['COMP1161 Lecture (Rm. 4B)', 'COMP1161 Lecture'],
    ['MATH1141 Tutorial, Bldg C', 'MATH1141 Tutorial'],
    ['CHEM1901 Lab | Lecture Theatre 2', 'CHEM1901 Lab'],
    ['FOUN1101 Seminar @ SLT 2', 'FOUN1101 Seminar'],
    ['Biology Location: Main Campus', 'Biology'],
    ['Biology - Venue: SLT 2', 'Biology'],
    ['COMP2140 Lecture - Dr. Brown', 'COMP2140 Lecture'],
    ['COMP2140 Lecture (Prof Anne-Marie Smith)', 'COMP2140 Lecture'],
    ['Physics Lab - Lecturer: J. Brown', 'Physics Lab'],
    ['Physics Lab taught by Grant', 'Physics Lab'],
    ['Cashier shift, Staff ID: A12345', 'Cashier shift'],
    ['Cashier shift ID 620123456', 'Cashier shift'],
    ['Team meeting call 876-555-0123', 'Team meeting call'],
    ['Team meeting jane.doe@example.com', 'Team meeting'],
    ['Team meeting https://meet.example.com/abc', 'Team meeting'],
    ['Volunteering at 12 Hope Road', 'Volunteering at'],
  ])('%s → %s', (input, expected) => {
    expect(scrubTitle(input, 'class')).toBe(expected);
  });

  it.each([
    'COMP1161 Lecture',
    'CHEM1901 Lab',
    'Lab Group B',
    'Theatre Studies',
    'Office hours',
    'Staff meeting',
    'Level 1 Spanish',
    'Block release training',
    'Tutorial 3',
    'Weeks 1-6',
    'MS Excel training',
    'Morning shift',
    'Café shift',
  ])('keeps %s as it is', (title) => {
    expect(scrubTitle(title, 'class')).toBe(title);
  });

  it('falls back to the kind of event when nothing is left', () => {
    expect(scrubTitle('Room 12', 'class')).toBe('Class');
    expect(scrubTitle('Dr. Brown', 'meeting')).toBe('Meeting');
    expect(scrubTitle('876-555-0123', 'work')).toBe('Work');
    expect(scrubTitle('—', 'other')).toBe('Busy');
  });

  it('scrubs every event of a draft and leaves the rest alone', () => {
    const draft = scrubDraft({
      events: [
        {
          title: 'COMP1161 Lecture - Room 12',
          category: 'class',
          start: '09:00',
          end: '10:00',
          when: { kind: 'weekly', days: ['mon'], pattern: { type: 'every' } },
          confidence: 0.8,
        },
      ],
      suggestedPeriod: { start: '2026-08-31', end: '2026-12-12', exceptions: [] },
    });
    expect(draft.events[0]?.title).toBe('COMP1161 Lecture');
    expect(draft.events[0]?.confidence).toBe(0.8);
    expect(draft.suggestedPeriod?.start).toBe('2026-08-31');
  });
});
