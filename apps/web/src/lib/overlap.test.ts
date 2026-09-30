import { describe, expect, it } from 'vitest';
import { freeCounts, freeWindows, rankSlots } from './overlap';

const h = (x: number) => x * 60;

const members = [
  { personId: 'a', busy: [[h(9), h(12)]] as [number, number][] },
  { personId: 'b', busy: [[h(13), h(14)]] as [number, number][] },
  { personId: 'c', busy: [[h(8), h(10)]] as [number, number][] },
];

describe('freeWindows', () => {
  it('merges steps with the same free people', () => {
    expect(freeWindows(members, h(8), h(15))).toEqual([
      { start: h(8), end: h(9), free: ['a', 'b'] },
      { start: h(9), end: h(10), free: ['b'] },
      { start: h(10), end: h(12), free: ['b', 'c'] },
      { start: h(12), end: h(13), free: ['a', 'b', 'c'] },
      { start: h(13), end: h(14), free: ['a', 'c'] },
      { start: h(14), end: h(15), free: ['a', 'b', 'c'] },
    ]);
  });

  it('counts free people per step', () => {
    expect(freeCounts(members, h(12), h(14), 60)).toEqual([3, 2]);
  });
});

describe('rankSlots', () => {
  const days = [
    { date: '2026-09-30', members },
    {
      date: '2026-10-01',
      members: members.map((m) => ({ ...m, busy: [] as [number, number][] })),
    },
  ];

  it('ranks everyone-free slots first (soonest), then all-but-N', () => {
    const slots = rankSlots(days, { minDuration: 60, window: [h(8), h(15)], maxMissing: 1 });
    expect(slots.map((s) => [s.date, s.start / 60, s.end / 60, s.missing.join()])).toEqual([
      ['2026-09-30', 12, 13, ''],
      ['2026-09-30', 14, 15, ''],
      ['2026-10-01', 8, 15, ''],
      ['2026-09-30', 8, 9, 'c'],
      ['2026-09-30', 10, 12, 'a'],
      ['2026-09-30', 13, 14, 'b'],
    ]);
  });

  it('respects the minimum duration and skips time that has passed', () => {
    const slots = rankSlots(days, {
      minDuration: 120,
      window: [h(8), h(15)],
      maxMissing: 2,
      notBefore: { date: '2026-09-30', minute: h(14) + 10 },
    });
    expect(slots.map((s) => [s.date, s.start / 60, s.end / 60])).toEqual([['2026-10-01', 8, 15]]);
  });
});
