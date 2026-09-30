// SPIKE (WF-024): throwaway prototype, not production code. It answers one question: can a
// Vercel Node function turn schedule uploads into vision-model-ready JPEGs without the Railway
// worker (PRD §8.1, D6, R8)? See docs/spikes/WF-024-vercel-vs-worker.md.
//
// Engines chosen for Vercel suitability (no custom binaries):
// - PDF → bitmap: PDFium compiled to WASM (`@hyzyla/pdfium`, MIT). Its Node entry loads
//   pdfium.wasm via `new URL(…, import.meta.url)`, which Turbopack emits as a traced asset. (The
//   `/browser/base64` entry is a web-only Emscripten build and fails in Node.)
// - HEIC → bitmap: libheif compiled to WASM (`heic-decode` → `libheif-js/wasm-bundle`, LGPL-3.0,
//   .wasm embedded in JS). sharp's prebuilt libvips can't decode HEVC-coded HEIC (patents).
// - Resize + JPEG encode: sharp (prebuilt libvips, a Next.js default server-external package).
//
// This file must stay free of relative imports and non-erasable TS syntax: the bench script runs
// it directly with Node's type stripping (apps/web/scripts/spike-wf-024/bench.ts).
import type { PDFiumLibrary } from '@hyzyla/pdfium';
import type heicDecode from 'heic-decode';
import sharp from 'sharp';

/** FR-IMP-1: PDFs may have at most 5 pages. */
export const MAX_PDF_PAGES = 5;
/** Long-edge cap for images sent to the vision model (NFR-PERF-6 uses the same 2000 px). */
export const MAX_EDGE_PX = 2000;
/** FR-IMP-1: uploads are at most 10 MB. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const JPEG_QUALITY = 85;

export type InputKind = 'pdf' | 'heic' | 'jpeg' | 'png' | 'webp';

export interface OutputImage {
  width: number;
  height: number;
  bytes: Uint8Array;
  /** Time spent producing this image, in ms (decode/render + resize + encode). */
  ms: number;
}

export interface ConvertResult {
  kind: InputKind;
  /** Page count for PDFs, 1 otherwise. */
  sourcePages: number;
  /** One-off engine initialisation (WASM compile/instantiate) paid by this call, in ms. */
  initMs: number;
  images: OutputImage[];
}

export class SpikeInputError extends Error {}

const ascii = (b: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...b.subarray(start, end));

/** Identifies the file by its magic bytes, never by extension or declared MIME (NFR-SEC-6). */
export function sniffKind(b: Uint8Array): InputKind | null {
  if (b.length < 12) return null;
  if (ascii(b, 0, 5) === '%PDF-') return 'pdf';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') return 'png';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12);
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return 'heic';
  }
  return null;
}

// The WASM engines are imported lazily and cached per function instance, so only the first call
// on a cold instance pays for loading and instantiating them (reported as `initMs`).
let pdfium: Promise<PDFiumLibrary> | null = null;

async function getPdfium(): Promise<{ lib: PDFiumLibrary; initMs: number }> {
  const t0 = performance.now();
  const cold = pdfium === null;
  pdfium ??= import('@hyzyla/pdfium').then(({ PDFiumLibrary }) => PDFiumLibrary.init());
  const lib = await pdfium;
  return { lib, initMs: cold ? performance.now() - t0 : 0 };
}

type HeicDecode = typeof heicDecode;
let heic: Promise<HeicDecode> | null = null;

async function getHeicDecoder(): Promise<{ decode: HeicDecode; initMs: number }> {
  const t0 = performance.now();
  const cold = heic === null;
  // libheif-js instantiates its embedded WASM when the module is first evaluated.
  heic ??= import('heic-decode').then((m) => m.default);
  const decode = await heic;
  return { decode, initMs: cold ? performance.now() - t0 : 0 };
}

/** The scale (1 = 72 dpi) that puts the page's long edge at MAX_EDGE_PX. */
export function pdfScaleFor(widthPt: number, heightPt: number, maxEdge = MAX_EDGE_PX): number {
  return maxEdge / Math.max(widthPt, heightPt);
}

async function rasterisePdf(bytes: Uint8Array, maxEdge: number): Promise<ConvertResult> {
  const { lib, initMs } = await getPdfium();
  const doc = await lib.loadDocument(bytes);
  try {
    const pageCount = doc.getPageCount();
    if (pageCount > MAX_PDF_PAGES) {
      throw new SpikeInputError(`PDF has ${pageCount} pages; the limit is ${MAX_PDF_PAGES}`);
    }
    const images: OutputImage[] = [];
    for (const page of doc.pages()) {
      const t0 = performance.now();
      const { originalWidth, originalHeight } = page.getOriginalSize();
      // `bitmap` returns raw BGRA pixels; sharp does the channel swap and encode in libvips.
      const raw = await page.render({
        render: 'bitmap',
        scale: pdfScaleFor(originalWidth, originalHeight, maxEdge),
      });
      const { data, info } = await sharp(raw.data, {
        raw: { width: raw.width, height: raw.height, channels: 4 },
      })
        .removeAlpha()
        .recomb([
          [0, 0, 1],
          [0, 1, 0],
          [1, 0, 0],
        ])
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: false })
        .toBuffer({ resolveWithObject: true });
      images.push({
        width: info.width,
        height: info.height,
        bytes: data,
        ms: performance.now() - t0,
      });
    }
    return { kind: 'pdf', sourcePages: pageCount, initMs, images };
  } finally {
    doc.destroy();
  }
}

async function heicToJpeg(bytes: Uint8Array, maxEdge: number): Promise<ConvertResult> {
  const { decode, initMs } = await getHeicDecoder();
  const t0 = performance.now();
  // heic-decode decodes the primary image at full resolution to RGBA (12 MP ≈ 48 MB).
  const decoded = await decode({ buffer: bytes });
  const { data, info } = await sharp(new Uint8Array(decoded.data.buffer), {
    raw: { width: decoded.width, height: decoded.height, channels: 4 },
  })
    .removeAlpha()
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer({ resolveWithObject: true });
  return {
    kind: 'heic',
    sourcePages: 1,
    initMs,
    images: [{ width: info.width, height: info.height, bytes: data, ms: performance.now() - t0 }],
  };
}

/** JPEG/PNG/WebP: server-side fallback for when on-device compression didn't happen. */
async function normaliseImage(
  bytes: Uint8Array,
  kind: InputKind,
  maxEdge: number,
): Promise<ConvertResult> {
  const t0 = performance.now();
  const { data, info } = await sharp(bytes)
    .rotate() // apply EXIF orientation
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer({ resolveWithObject: true });
  return {
    kind,
    sourcePages: 1,
    initMs: 0,
    images: [{ width: info.width, height: info.height, bytes: data, ms: performance.now() - t0 }],
  };
}

/** Converts one upload into ≤ 5 JPEGs with a long edge of at most `maxEdge` px. */
export async function convertUpload(
  bytes: Uint8Array,
  maxEdge = MAX_EDGE_PX,
): Promise<ConvertResult> {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new SpikeInputError(`File is ${bytes.byteLength} bytes; the limit is 10 MB`);
  }
  const kind = sniffKind(bytes);
  switch (kind) {
    case 'pdf':
      return rasterisePdf(bytes, maxEdge);
    case 'heic':
      return heicToJpeg(bytes, maxEdge);
    case 'jpeg':
    case 'png':
    case 'webp':
      return normaliseImage(bytes, kind, maxEdge);
    case null:
      throw new SpikeInputError('Unsupported file type');
  }
}

/** Process-wide memory snapshot in MB. `maxRssMb` is the high-water mark of this process. */
export function memorySnapshot() {
  const m = process.memoryUsage();
  const mb = (n: number) => Math.round((n / 1024 / 1024) * 10) / 10;
  return {
    rssMb: mb(m.rss),
    heapUsedMb: mb(m.heapUsed),
    externalMb: mb(m.external),
    arrayBuffersMb: mb(m.arrayBuffers),
    // resourceUsage().maxRSS is in kilobytes.
    maxRssMb: mb(process.resourceUsage().maxRSS * 1024),
  };
}
