// The original of one of the viewer's pending uploads (FR-IMP-10, FR-IMP-16, NFR-SEC-6): a
// redirect to a signed Storage URL that works for 60 seconds. The file is looked up as the
// viewer under RLS first (owner-only), so nobody else's file can be reached, and the bucket
// itself is private. Used by the review screen (next to the grid) and Pending uploads ("View").

import type { NextRequest } from 'next/server';
import { requireParseAdmin } from '@/lib/parse/admin';
import { isUuid } from '@/lib/social/mappers';
import { createServerSupabase } from '@/lib/supabase/server';

/** How long the signed URL works. Long enough to load the image or PDF, no longer. */
const SIGNED_URL_SECONDS = 60;

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<'/uploads/[fileId]/original'>,
): Promise<Response> {
  const { fileId } = await ctx.params;
  if (!isUuid(fileId)) return new Response(null, { status: 404 });

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('schedule_files')
    .select('storage_path')
    .eq('id', fileId)
    .maybeSingle();
  if (error) {
    console.error('Reading an upload failed', error.code);
    return new Response(null, { status: 500 });
  }
  if (!data) return new Response(null, { status: 404 });

  const url = await requireParseAdmin().signRead(data.storage_path, SIGNED_URL_SECONDS);
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
