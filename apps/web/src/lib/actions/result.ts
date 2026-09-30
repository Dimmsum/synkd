/**
 * What every mutation returns. Kept tiny so client components can show errors. Actions that
 * hand something back (e.g. a new group's id) put it in `data`.
 */
export type ActionResult<T = void> =
  (T extends void ? { ok: true } : { ok: true; data: T }) | { ok: false; error: string };

export const ok = { ok: true } as const;
export const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Fakes network latency in the mock so pending states are visible. */
export const mockDelay = (ms = 350) => new Promise((r) => setTimeout(r, ms));
