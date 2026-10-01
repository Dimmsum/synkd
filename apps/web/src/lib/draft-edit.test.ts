import { describe, expect, it } from 'vitest';
import { EventDraft } from '@whosfree/shared';
import type { DraftEvent } from '@/lib/types';
import {
  durationMinutes,
  formatWeekList,
  mergeEvents,
  parseWeekList,
  splitEvent,
  splitKind,
} from './draft-edit';

describe('week lists (FR-IMP-5)', () => {
  it('reads "weeks 1-6, 8-12" style lists and writes them back', () => {
    expect(parseWeekList('1-6, 8-12')).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12]);
    expect(parseWeekList('3 1 2 2')).toEqual([1, 2, 3]);
    expect(parseWeekList('10–12')).toEqual([10, 11, 12]);
    for (const bad of ['', 'a', '0', '61', '5-3', '1-']) expect(parseWeekList(bad)).toBeNull();
    expect(formatWeekList([1, 2, 3, 5, 8, 9])).toBe('1–3, 5, 8–9');
    expect(parseWeekList(formatWeekList([2, 3, 4, 7]))).toEqual([2, 3, 4, 7]);
  });
});

const ev = (overrides: Partial<DraftEvent> = {}): DraftEvent => ({
  id: 'e1',
  title: 'COMP2140 Lecture',
  category: 'class',
  start: '10:00',
  end: '12:00',
  when: { kind: 'weekly', days: ['mon', 'wed'], pattern: { type: 'every' } },
  confidence: 0.9,
  ...overrides,
});

const valid = (events: DraftEvent[]) =>
  events.every(({ id: _id, ...e }) => EventDraft.safeParse(e).success);

describe('splitEvent (FR-IMP-11)', () => {
  it('splits an event on several days into one per day', () => {
    const parts = splitEvent(ev());
    expect(splitKind(ev())).toBe('days');
    expect(parts.map((p) => [p.id, p.when.kind === 'weekly' && p.when.days])).toEqual([
      ['e1-mon', ['mon']],
      ['e1-wed', ['wed']],
    ]);
    expect(valid(parts)).toBe(true);
  });

  it('splits a one-day event into two halves on a 5-minute boundary', () => {
    const one = ev({
      start: '09:00',
      end: '11:50',
      when: { kind: 'weekly', days: ['tue'], pattern: { type: 'alternating', parity: 'odd' } },
    });
    expect(splitKind(one)).toBe('halves');
    const [a, b] = splitEvent(one);
    expect([a?.start, a?.end, b?.start, b?.end]).toEqual(['09:00', '10:25', '10:25', '11:50']);
    expect(b?.when).toEqual(one.when);
    expect(valid(splitEvent(one))).toBe(true);
  });

  it('splits an overnight shift across midnight', () => {
    const night = ev({ start: '22:00', end: '06:00', when: { kind: 'date', date: '2026-10-01' } });
    expect(durationMinutes(night)).toBe(480);
    const [a, b] = splitEvent(night);
    expect([a?.start, a?.end, b?.start, b?.end]).toEqual(['22:00', '02:00', '02:00', '06:00']);
  });

  it('leaves a very short single-day event alone', () => {
    const short = ev({
      start: '10:00',
      end: '10:05',
      when: { kind: 'weekly', days: ['mon'], pattern: { type: 'every' } },
    });
    expect(splitKind(short)).toBeNull();
    expect(splitEvent(short)).toEqual([short]);
  });
});

describe('mergeEvents (FR-IMP-11)', () => {
  it('merges the same time on different days into one event, keeping the lowest confidence', () => {
    const merged = mergeEvents([
      ev({ id: 'a', when: { kind: 'weekly', days: ['wed'], pattern: { type: 'every' } } }),
      ev({
        id: 'b',
        confidence: 0.4,
        when: { kind: 'weekly', days: ['mon'], pattern: { type: 'every' } },
      }),
    ]);
    expect(merged?.when).toEqual({
      kind: 'weekly',
      days: ['mon', 'wed'],
      pattern: { type: 'every' },
    });
    expect(merged?.confidence).toBe(0.4);
    expect(merged && valid([merged])).toBe(true);
  });

  it('merges back-to-back or overlapping events on the same days into one span', () => {
    const merged = mergeEvents([
      ev({ id: 'a', start: '13:00', end: '14:00' }),
      ev({ id: 'b', start: '10:00', end: '12:00' }),
      ev({ id: 'c', start: '11:30', end: '13:00' }),
    ]);
    expect([merged?.start, merged?.end]).toEqual(['10:00', '14:00']);
  });

  it('refuses events with a gap, different weeks, different days and times, or one event', () => {
    expect(mergeEvents([ev({ start: '08:00', end: '09:00' }), ev()])).toBeNull();
    expect(
      mergeEvents([
        ev(),
        ev({
          when: {
            kind: 'weekly',
            days: ['mon', 'wed'],
            pattern: { type: 'alternating', parity: 'odd' },
          },
        }),
      ]),
    ).toBeNull();
    expect(
      mergeEvents([
        ev({ start: '09:00', end: '10:00' }),
        ev({ when: { kind: 'weekly', days: ['fri'], pattern: { type: 'every' } } }),
      ]),
    ).toBeNull();
    expect(mergeEvents([ev()])).toBeNull();
    expect(mergeEvents([ev(), ev({ when: { kind: 'date', date: '2026-10-01' } })])).toBeNull();
  });
});
