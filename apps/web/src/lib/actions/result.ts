/** What every mutation stub returns. Kept tiny so client components can show errors. */
export type ActionResult = { ok: true } | { ok: false; error: string };

export const ok: ActionResult = { ok: true };
export const fail = (error: string): ActionResult => ({ ok: false, error });

/** Fakes network latency in the mock so pending states are visible. */
export const mockDelay = (ms = 350) => new Promise((r) => setTimeout(r, ms));
