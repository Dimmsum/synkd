// Internal: the parse and file-retention sweep (WF-027 NFR-REL-4, WF-037 files, FR-ADM-4, D38).
// A cron calls it every minute with `Authorization: Bearer <CRON_SECRET>`: Supabase Cron with
// pg_net (POST), Railway's cron, or Vercel Cron (GET). See lib/parse/sweep.ts for what it does.
// Answers the counts, so the cron's own log records each run.

import { requireParseAdmin } from '@/lib/parse/admin';
import { isInternalRequest } from '@/lib/parse/internal';
import { dispatchParseJob } from '@/lib/parse/runner';
import { sweep } from '@/lib/parse/sweep';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function handle(request: Request): Promise<Response> {
  if (!isInternalRequest(request)) return new Response(null, { status: 401 });
  const result = await sweep({ admin: requireParseAdmin(), dispatch: dispatchParseJob });
  return Response.json(result);
}

export const POST = handle;
export const GET = handle;
