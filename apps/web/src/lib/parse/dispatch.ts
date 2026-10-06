// How a queued parse job gets run (WF-027, D46, NFR-REL-4, WF-131), as pure logic over injected
// I/O so every branch is unit-tested; runner.ts wires in the real POST and in-process run.
//
// A job must never be left queued just because one way of starting it didn't work. `claim_parse_job`
// is idempotent (a job that isn't due, or that another run holds, isn't claimed again), so running
// it here after a failed POST, or nudging it again while someone is watching, never runs it twice.

import type { ParseJobStatus } from '@synkd/shared';

export interface DispatchDeps {
  /** CRON_SECRET, or null when it isn't set. */
  secret: string | null;
  /** Where the server reaches its own internal routes, or null. */
  base: string | null;
  /** POSTs the job to the internal run route; resolves to whether the route accepted it. */
  post(url: string, secret: string, jobId: string): Promise<boolean>;
  /** Claims and runs the job in this process. Never throws. */
  runHere(jobId: string): Promise<void>;
}

/**
 * Starts a run of `jobId`: through the internal run route when CRON_SECRET and the app URL are
 * set (its own function and maxDuration on serverless hosts), else, or when that request fails
 * (wrong URL, secret mismatch, server not reachable), in this process.
 */
export async function dispatch(
  jobId: string,
  path: string,
  deps: DispatchDeps,
): Promise<'route' | 'here'> {
  if (deps.secret && deps.base) {
    let accepted = false;
    try {
      accepted = await deps.post(`${deps.base}${path}`, deps.secret, jobId);
    } catch (err) {
      console.warn('Parse dispatch failed; running it here', (err as Error).name);
    }
    if (accepted) return 'route';
  }
  await deps.runHere(jobId);
  return 'here';
}

/** A queued job that hasn't been picked up this long after its last change is nudged again. */
export const QUEUED_STALL_SECONDS = 20;

/**
 * Whether a job someone is looking at should be dispatched again: queued for a while (its
 * dispatch was lost, or a retry's backoff may have passed), or processing for longer than a run's
 * lease (`leaseSeconds`, the run crashed or the server restarted). The claim decides for certain.
 */
export function isStalled(
  job: { status: ParseJobStatus; updatedAt: string },
  now: Date,
  leaseSeconds: number,
): boolean {
  const idle = (now.getTime() - new Date(job.updatedAt).getTime()) / 1000;
  if (job.status === 'queued') return idle >= QUEUED_STALL_SECONDS;
  if (job.status === 'processing') return idle >= leaseSeconds;
  return false;
}
