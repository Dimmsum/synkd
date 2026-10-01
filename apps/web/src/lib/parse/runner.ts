// The real wiring of a parse run and of dispatch (WF-027, D46). Server only: it imports the
// converter (sharp, PDFium and libheif WASM) through `@whosfree/parser/node`.
//
// dispatchParseJob is the single seam between "a job is queued" and "a run happens" (spike §7):
// it POSTs to the internal run route, which claims the job and works in `after()` within its
// own maxDuration. Without CRON_SECRET (local development) it runs the job in this process
// instead; in production it only warns, and the job waits for the secret to be set.

import 'server-only';
import { ConvertError, convertUpload, parseScheduleImages } from '@whosfree/parser/node';
import { DEFAULT_TIMEZONE } from '@whosfree/shared';
import { dateKey } from '@whosfree/ui/lib/time';
import { requireParseAdmin, type ParseAdmin } from './admin';
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

/** Claims and runs a job in this process (local development without CRON_SECRET). */
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
 * Starts a run of `jobId` without waiting for the parse. Never throws: if dispatch fails, the
 * sweep picks the queued job up (NFR-REL-4).
 */
export async function dispatchParseJob(jobId: string): Promise<void> {
  const secret = internalSecret();
  const base = internalBaseUrl();
  if (!secret || !base) {
    if (process.env.NODE_ENV !== 'production') return runHere(jobId);
    if (!warnedNoSecret) {
      warnedNoSecret = true;
      console.error('Parse dispatch is off: CRON_SECRET or NEXT_PUBLIC_APP_URL is not set');
    }
    return;
  }
  try {
    const res = await fetch(`${base}${PARSE_RUN_PATH}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jobId }),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    if (!res.ok) console.warn('Parse dispatch failed', res.status);
  } catch (err) {
    console.warn('Parse dispatch failed', (err as Error).name);
  }
}
