// Coalesces bursts of Realtime "changed" signals into one re-fetch (FR-VIEW-3, NFR-PERF-3,
// WF-064). One transaction sends at most one signal per viewer, but several friends changing at
// once (or a group edit) can still send a burst.

/** Quiet time after the last signal before re-fetching. */
export const REFETCH_DEBOUNCE_MS = 400;
/**
 * The longest a re-fetch waits during a steady stream of signals, so a change still reaches the
 * screen within NFR-PERF-3's 5 seconds.
 */
export const REFETCH_MAX_WAIT_MS = 2_000;

export interface Debounced {
  /** Ask for a run. Runs once, `waitMs` after the last call, or `maxWaitMs` after the first. */
  (): void;
  /** Drop a pending run (on unmount). */
  cancel(): void;
}

/** A trailing debounce with a maximum wait. */
export function debounce(
  fn: () => void,
  waitMs = REFETCH_DEBOUNCE_MS,
  maxWaitMs = REFETCH_MAX_WAIT_MS,
): Debounced {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstCallAt: number | null = null;

  const run = () => {
    timer = undefined;
    firstCallAt = null;
    fn();
  };

  const debounced = () => {
    const now = Date.now();
    firstCallAt ??= now;
    if (timer !== undefined) clearTimeout(timer);
    const delay = Math.max(0, Math.min(waitMs, firstCallAt + maxWaitMs - now));
    timer = setTimeout(run, delay);
  };
  debounced.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    firstCallAt = null;
  };
  return debounced;
}
