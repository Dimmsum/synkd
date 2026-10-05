// The real wiring of a parse run and of dispatch (WF-027, D46). Server only: it imports the
// converter (sharp, PDFium and libheif WASM) through `@synkd/parser/node`.
//
// dispatchParseJob is the single seam between "a job is queued" and "a run happens" (spike §7):
// it POSTs to the internal run route, which claims the job and works in `after()` within its
// own maxDuration. Without CRON_SECRET, or when that request fails, it runs the job in this
// process instead (dispatch.ts), so a job is never left queued by a missing or wrong setting
// (WF-131).

import 'server-only';
import { ConvertError, convertUpload, parseScheduleImages } from '@synkd/parser/node';
import { DEFAULT_TIMEZONE } from '@synkd/shared';
import { dateKey } from '@synkd/ui/lib/time';
import { requireParseAdmin, type ParseAdmin } from './admin';
import { dispatch, isStalled } from './dispatch';
import { internalBaseUrl, internalSecret, PARSE_RUN_PATH } from './internal';
import { processRun, type ConvertOutcome, type RunResult } from './run';

/** How long a claimed run may take before the sweep may retry it: the route's 300 s + margin. */
export const PARSE_LEASE_SECONDS = 330;

async function convert(bytes: Uint8Array): Promise<ConvertOutcome> {
  try {
    const result = await convertUpload(bytes);
    return { ok: true, pages: result.pages, images: result.images };
  } catch (err) {
    if (err instanceof ConvertError) return { ok: false, code: err.code };
    throw err;
  }
}

/** Runs an already-claimed job with the real dependencies. Never throws. */
export function processClaimedRun(
  run: Parameters<typeof processRun>[0],
  admin: ParseAdmin,
): Promise<RunResult> {
  return processRun(run, {
    admin,
    convert,
    parse: parseScheduleImages,
    apiKey: process.env.OPENROUTER_API_KEY?.trim() || null,
    // The upload's owner's timezone isn't loaded here; Jamaica's date is off by a day at most.
    today: () => dateKey(new Date(), DEFAULT_TIMEZONE),
  });
}

/** Claims and runs a job in this process (no CRON_SECRET, or the run route couldn't be reached). */
async function runHere(jobId: string): Promise<void> {
  try {
    const admin = requireParseAdmin();
    const run = await admin.claim(jobId, PARSE_LEASE_SECONDS);
    if (run) await processClaimedRun(run, admin);
  } catch (err) {
    console.error('Parse run failed', (err as Error).message);
  }
}

let warnedNoSecret = false;

/**
 * Starts a run of `jobId`. Never throws. If this run is lost anyway (the server restarts mid-run),
 * the sweep (NFR-REL-4) or the next look at the job ({@link isStalled}) dispatches it again.
 */
export async function dispatchParseJob(jobId: string): Promise<void> {
  const secret = internalSecret();
  const base = internalBaseUrl();
  if ((!secret || !base) && process.env.NODE_ENV === 'production' && !warnedNoSecret) {
    warnedNoSecret = true;
    console.warn('CRON_SECRET or NEXT_PUBLIC_APP_URL is not set: parse jobs run in-process');
  }
  await dispatch(jobId, PARSE_RUN_PATH, {
    secret,
    base,
    async post(url, bearer, id) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: id }),
        signal: AbortSignal.timeout(15_000),
        cache: 'no-store',
      });
      if (!res.ok) console.warn('Parse dispatch failed; running it here', res.status);
      return res.ok;
    },
    runHere,
  });
}

/** Whether a job the viewer is looking at should be dispatched again (see dispatch.ts). */
export const isStalledJob = (job: Parameters<typeof isStalled>[0], now: Date): boolean =>
  isStalled(job, now, PARSE_LEASE_SECONDS);
