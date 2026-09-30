import { describe, expect, it } from 'vitest';
import { describeStatus } from './status';
import { pingCharsLeft, pingPolicy } from './ping-rules';

const JM = 'America/Jamaica';
const now = '2026-09-30T19:30:00Z'; // 2:30 PM in Jamaica
const at3pm = '2026-09-30T20:00:00Z';

describe('describeStatus', () => {
  it('shows free with "until X"', () => {
    expect(describeStatus({ status: 'free', until: at3pm, nextFreeAt: null }, now, JM)).toEqual({
      tone: 'free',
      label: 'Free until 3:00 PM',
    });
  });

  it('T1: busy with no reason', () => {
    expect(describeStatus({ status: 'busy', until: at3pm, nextFreeAt: at3pm }, now, JM).label).toBe(
      'Busy until 3:00 PM',
    );
  });

  it('T2: adds the category', () => {
    const s = describeStatus(
      { status: 'busy', until: at3pm, nextFreeAt: at3pm, activity: { category: 'class' } },
      now,
      JM,
    );
    expect(s.label).toBe('In class until 3:00 PM');
  });

  it('T2: Google events read "Busy · Calendar event"', () => {
    const s = describeStatus(
      { status: 'busy', until: at3pm, nextFreeAt: at3pm, activity: { category: 'event' } },
      now,
      JM,
    );
    expect(s).toEqual({ tone: 'busy', label: 'Busy until 3:00 PM', detail: 'Calendar event' });
  });

  it('T3: shows the title with the category underneath', () => {
    const s = describeStatus(
      {
        status: 'busy',
        until: at3pm,
        nextFreeAt: at3pm,
        activity: { category: 'class', title: 'COMP2140 Lecture' },
      },
      now,
      JM,
    );
    expect(s).toEqual({
      tone: 'busy',
      label: 'COMP2140 Lecture until 3:00 PM',
      detail: 'In class',
    });
  });

  it('covers dnd, away, no schedule and paused', () => {
    expect(describeStatus({ status: 'dnd', until: at3pm, nextFreeAt: at3pm }, now, JM).label).toBe(
      'Do not disturb until 3:00 PM',
    );
    expect(
      describeStatus({ status: 'away', until: '2026-10-01T13:00:00Z', nextFreeAt: null }, now, JM)
        .label,
    ).toBe('Away until 8:00 AM tomorrow');
    expect(
      describeStatus({ status: 'no_schedule', until: null, nextFreeAt: null }, now, JM),
    ).toEqual({ tone: 'no_schedule', label: 'Hasn’t added a schedule yet' });
    expect(describeStatus({ status: 'paused', until: null, nextFreeAt: null }, now, JM).label).toBe(
      'Sharing paused',
    );
  });

  it('describes Free soon people by when they free up', () => {
    const s = describeStatus(
      { status: 'busy', until: at3pm, nextFreeAt: at3pm, activity: { category: 'lab' } },
      now,
      JM,
      { soon: true },
    );
    expect(s).toEqual({ tone: 'soon', label: 'Free from 3:00 PM', detail: 'In a lab' });
  });
});

describe('ping rules (FR-PING-1, D31)', () => {
  it('allows, confirms or blocks by status', () => {
    expect(pingPolicy('free')).toBe('allowed');
    expect(pingPolicy('busy')).toBe('confirm');
    expect(pingPolicy('away')).toBe('confirm');
    expect(pingPolicy('dnd')).toBe('blocked');
    expect(pingPolicy('paused')).toBe('blocked');
  });

  it('counts emoji as one character', () => {
    expect(pingCharsLeft('🍔🍔')).toBe(138);
  });
});
