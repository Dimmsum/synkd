'use client';

// Keeping the Now screen current without polling (PRD §8.5 steps 3–4, FR-VIEW-3, NFR-PERF-3,
// WF-064):
// - Realtime: a database trigger sends an empty `now_changed` Broadcast on the viewer's private
//   channel when something they see changes; the client then re-fetches through the server,
//   which reads the redacting `now_for_viewer`. No data travels over Realtime (D41).
// - A local timer: each person's status comes with the changes ahead, so "until X" passing
//   moves them between sections on the client.

import { useEffect, useEffectEvent, useState } from 'react';
import { NOW_CHANGED_EVENT } from '@whosfree/shared';
import { nextChangeAt, needsRefetch, type Timed } from '@/lib/presence/clock';
import { useUserSignals } from '@/components/realtime/use-user-signals';

export { useRefetch } from '@/components/realtime/use-user-signals';

/**
 * Calls `onChange` for every `now_changed` signal on the viewer's private channel, and once
 * after a reconnect (see useUserSignals).
 */
export function useNowSignals(viewerId: string, onChange: () => void): void {
  useUserSignals(viewerId, NOW_CHANGED_EVENT, onChange, 'Now');
}

/**
 * The time the Now screen shows statuses at, UTC epoch ms. Starts at the server's `now` (so the
 * first render matches the server's) and moves on with a local timer, waking at the next status
 * change, "Free soon" boundary or minute, never polling the server. When the changes the server
 * sent run out, calls `onStale` to re-fetch. Corrects for a client clock that is off.
 */
export function usePresenceClock(
  serverNow: string,
  connections: readonly Timed[],
  onStale: () => void,
): number {
  const serverMs = Date.parse(serverNow);
  const [tick, setTick] = useState(serverMs);
  const stale = useEffectEvent(onStale);

  useEffect(() => {
    // How far the client clock is behind the server's, as of this render's data.
    const skew = serverMs - Date.now();
    const clock = () => Date.now() + skew;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const update = () => {
      const t = clock();
      setTick(t);
      if (needsRefetch(connections, t)) stale();
    };
    const schedule = () => {
      const t = clock();
      const nextMinute = (Math.floor(t / 60_000) + 1) * 60_000;
      const wake = Math.min(nextChangeAt(connections, t) ?? Infinity, nextMinute);
      timer = setTimeout(
        () => {
          update();
          schedule();
        },
        // A little after the boundary, so `t` is past it when it fires.
        Math.max(0, wake - t) + 25,
      );
    };
    // Timers are throttled in background tabs: catch up as soon as the screen is seen again.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      clearTimeout(timer);
      update();
      schedule();
    };

    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [serverMs, connections]);

  // After a re-fetch the server's `now` can be ahead of the last tick.
  return Math.max(tick, serverMs);
}
