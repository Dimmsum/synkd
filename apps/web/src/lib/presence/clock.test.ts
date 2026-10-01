import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '@/lib/types';
import { groupIntoNowSections } from '@/lib/now-sections';
import { nextChangeAt, needsRefetch, presenceAt } from './clock';
import { debounce } from './debounce';

const now = Date.parse('2026-09-30T19:30:00Z');
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const inMin = (m: number) => iso(now + m * MIN);

function person(over: Partial<Connection> = {}): Connection {
  return {
    id: 'p',
    name: 'P',
    handle: 'p',
    hue: 0,
    isFriend: true,
    tier: 2,
    status: 'busy',
    until: inMin(90),
    nextFreeAt: inMin(90),
    activity: { category: 'class' },
    stale: false,
    groupIds: [],
    upcoming: [
      { at: inMin(90), status: 'free', until: inMin(300), nextFreeAt: null },
      { at: inMin(300), status: 'away', until: inMin(900), nextFreeAt: inMin(900) },
    ],
    refreshAt: inMin(900),
    ...over,
  };
}

describe('presenceAt (PRD §8.5 step 4: the client timer)', () => {
  it('is the server state until the first change', () => {
    expect(presenceAt(person(), now + 89 * MIN)).toEqual(person());
  });

  it('applies the latest change that has started, and drops the old reason', () => {
    const c = presenceAt(person(), now + 90 * MIN);
    expect(c).toMatchObject({ status: 'free', until: inMin(300), nextFreeAt: null });
    expect(c.activity).toBeUndefined();
    expect(presenceAt(person(), now + 600 * MIN).status).toBe('away');
  });

  it('keeps who they are', () => {
    expect(presenceAt(person(), now + 90 * MIN)).toMatchObject({
      id: 'p',
      tier: 2,
      isFriend: true,
    });
  });

  it('moves people between sections as "until X" passes, without the server', () => {
    const people = [person()];
    const at = (m: number) => {
      const t = now + m * MIN;
      const s = groupIntoNowSections(
        people.map((c) => presenceAt(c, t)),
        new Date(t),
      );
      return Object.entries(s).find(([, list]) => list.length)?.[0];
    };
    expect(at(0)).toBe('busyAway');
    expect(at(30)).toBe('freeSoon'); // within 60 minutes of 90
    expect(at(90)).toBe('freeNow');
    expect(at(300)).toBe('busyAway');
  });
});

describe('nextChangeAt', () => {
  it('wakes for the "Free soon" window, then each change, then the re-fetch', () => {
    const c = [person()];
    expect(nextChangeAt(c, now)).toBe(now + 30 * MIN);
    expect(nextChangeAt(c, now + 30 * MIN)).toBe(now + 90 * MIN);
    expect(nextChangeAt(c, now + 90 * MIN)).toBe(now + 300 * MIN);
    expect(nextChangeAt(c, now + 300 * MIN)).toBe(now + 840 * MIN);
    expect(nextChangeAt(c, now + 840 * MIN)).toBe(now + 900 * MIN);
    expect(nextChangeAt(c, now + 900 * MIN)).toBeNull();
  });

  it('takes the soonest across people', () => {
    const other = person({ id: 'q', nextFreeAt: inMin(70), upcoming: [], refreshAt: null });
    expect(nextChangeAt([person(), other], now)).toBe(now + 10 * MIN);
  });

  it('is null when nothing is ahead', () => {
    expect(
      nextChangeAt(
        [
          person({
            status: 'paused',
            until: null,
            nextFreeAt: null,
            upcoming: [],
            refreshAt: null,
          }),
        ],
        now,
      ),
    ).toBeNull();
  });
});

describe('needsRefetch', () => {
  it('once the changes sent run out', () => {
    expect(needsRefetch([person()], now + 899 * MIN)).toBe(false);
    expect(needsRefetch([person()], now + 900 * MIN)).toBe(true);
    expect(needsRefetch([person({ refreshAt: null })], now + 10_000 * MIN)).toBe(false);
  });
});

describe('debounce (FR-VIEW-3, NFR-PERF-3)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a burst of signals causes one re-fetch', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 400, 2_000);
    d();
    vi.advanceTimersByTime(100);
    d();
    vi.advanceTimersByTime(100);
    d();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a steady stream still re-fetches within the maximum wait', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 400, 2_000);
    for (let i = 0; i < 10; i++) {
      d();
      vi.advanceTimersByTime(300);
    }
    // 3 s of signals 300 ms apart: one run at the 2 s cap, then the rest coalesce again.
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(400);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('cancel drops a pending run (unmount)', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn);
    d();
    d.cancel();
    vi.advanceTimersByTime(10_000);
    expect(fn).not.toHaveBeenCalled();
  });
});
