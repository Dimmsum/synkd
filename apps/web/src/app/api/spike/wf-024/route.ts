// SPIKE (WF-024): throwaway route that measures PDF/HEIC conversion inside a Vercel Node
// function. Delete it once the PRD records the decision (see docs/spikes/WF-024-vercel-vs-worker.md).
//
// Gate: 404 unless running outside production (`next dev`), or SPIKE_WF024_TOKEN is set and the
// request sends it as `x-spike-token`. A production deployment without the variable exposes nothing.
//
// POST  body = the file (≤ 4.5 MB on Vercel)                 → JSON metrics
// GET   ?src=<https URL of the file> (up to 10 MB, e.g. a Supabase signed URL) → JSON metrics
// Add `&page=N` (1-based) to either to get that page's JPEG instead of JSON.
import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import {
  MAX_UPLOAD_BYTES,
  SpikeInputError,
  convertUpload,
  memorySnapshot,
} from '@/spike/wf-024/convert';

export const runtime = 'nodejs';
// Generous on purpose: the spike measures how long conversion takes; it must not be the limit.
export const maxDuration = 60;

function allowed(request: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  const expected = process.env.SPIKE_WF024_TOKEN;
  const given = request.headers.get('x-spike-token');
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

const notFound = () => new Response('Not Found', { status: 404 });

async function readSrc(src: string): Promise<Uint8Array> {
  if (!URL.canParse(src)) throw new SpikeInputError('src is not a URL');
  const url = new URL(src);
  if (url.protocol !== 'https:') throw new SpikeInputError('src must be an https URL');
  const res = await fetch(url, { redirect: 'error' });
  if (!res.ok) throw new SpikeInputError(`src returned ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new SpikeInputError('src is over 10 MB');
  return bytes;
}

async function handle(request: NextRequest, load: () => Promise<Uint8Array>): Promise<Response> {
  if (!allowed(request)) return notFound();
  const before = memorySnapshot();
  const t0 = performance.now();
  let bytes: Uint8Array;
  let result: Awaited<ReturnType<typeof convertUpload>>;
  try {
    bytes = await load();
    const tRead = performance.now();
    result = await convertUpload(bytes);
    const totalMs = performance.now() - t0;

    const pageParam = request.nextUrl.searchParams.get('page');
    if (pageParam) {
      const image = result.images[Number(pageParam) - 1];
      if (!image) return Response.json({ error: 'no such page' }, { status: 400 });
      return new Response(Buffer.from(image.bytes), {
        headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' },
      });
    }

    return Response.json(
      {
        kind: result.kind,
        inputBytes: bytes.byteLength,
        sourcePages: result.sourcePages,
        readMs: Math.round(tRead - t0),
        initMs: Math.round(result.initMs),
        totalMs: Math.round(totalMs),
        images: result.images.map((i) => ({
          width: i.width,
          height: i.height,
          bytes: i.bytes.byteLength,
          ms: Math.round(i.ms),
        })),
        memory: { before, after: memorySnapshot() },
        runtime: {
          node: process.version,
          arch: process.arch,
          platform: process.platform,
          region: process.env.VERCEL_REGION ?? null,
        },
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof SpikeInputError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    // No file contents or names are logged (NFR-SEC-11).
    console.error('spike wf-024 conversion failed', error instanceof Error ? error.name : error);
    return Response.json({ error: 'conversion failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, async () => new Uint8Array(await request.arrayBuffer()));
}

export async function GET(request: NextRequest): Promise<Response> {
  const src = request.nextUrl.searchParams.get('src');
  if (!src)
    return allowed(request) ? Response.json({ error: 'missing src' }, { status: 400 }) : notFound();
  return handle(request, () => readSrc(src));
}
