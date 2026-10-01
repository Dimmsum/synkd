// Internal: run one parse job (WF-027, PRD §8.5, D46, WF-024 §7). Called by dispatchParseJob
// (after a user starts a parse) and by the sweep, with `Authorization: Bearer <CRON_SECRET>`.
// Body: `{ "jobId": "<uuid>" }`.
//
// It claims the job (idempotent: a job that isn't due or is already running answers
// `claimed: false`), answers 202 straight away, and does the work in `after()`: download from
// Storage, sniff and convert in memory, one model call, store the draft or the failure. A
// dedicated route so the run gets its own maxDuration and, on serverless hosts, its own
// function, away from page rendering (spike §7).

import { after } from 'next/server';
import { requireParseAdmin } from '@/lib/parse/admin';
import { isInternalRequest } from '@/lib/parse/internal';
import { PARSE_LEASE_SECONDS, processClaimedRun } from '@/lib/parse/runner';
import { isUuid } from '@/lib/social/mappers';

export const runtime = 'nodejs';
// Conversion (≤ ~10 s) + one vision call (typically 10–60 s), with room to spare. The claim's
// lease (PARSE_LEASE_SECONDS) is a little longer, so the sweep never retries a live run.
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  if (!isInternalRequest(request)) return new Response(null, { status: 401 });

  let jobId: unknown;
  try {
    ({ jobId } = (await request.json()) as { jobId?: unknown });
  } catch {
    jobId = undefined;
  }
  if (typeof jobId !== 'string' || !isUuid(jobId)) {
    return Response.json({ error: 'jobId must be a uuid' }, { status: 400 });
  }

  const admin = requireParseAdmin();
  const run = await admin.claim(jobId, PARSE_LEASE_SECONDS);
  if (!run) return Response.json({ claimed: false });

  after(() => processClaimedRun(run, admin));
  return Response.json({ claimed: true }, { status: 202 });
}
