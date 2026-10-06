// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- heic-decode ships no types; consumers that compile this file (apps/web) need the declaration too.
/// <reference path="./heic-decode.d.ts" />
// Turns an uploaded schedule file into images a vision model can read (FR-IMP-1, NFR-SEC-6,
// D38, D46). Node only: it uses sharp (native libvips) and two WASM engines, so it is exported
// from `@synkd/parser/node` and must never reach a browser bundle.
//
// Moved from the WF-024 spike (docs/spikes/WF-024-vercel-vs-worker.md):
// - PDF → bitmap: PDFium compiled to WASM (`@hyzyla/pdfium`, MIT). Its Node entry loads
//   pdfium.wasm with `new URL(…, import.meta.url)`, which Turbopack emits as a traced asset.
// - HEIC → bitmap: libheif compiled to WASM (`heic-decode` → `libheif-js/wasm-bundle`,
//   LGPL-3.0, used unmodified on the server). sharp's prebuilt libvips can't decode HEIC.
// - Resize + JPEG encode: sharp (a Next.js default server-external package).
//
// Guards against hostile input (spike §8), all applied before anything is decoded:
// - the type comes from the magic bytes only, never the name or declared type (NFR-SEC-6);
// - at most SCHEDULE_FILE_MAX_BYTES and SCHEDULE_FILE_MAX_PDF_PAGES;
// - a HEIC's declared size (`ispe`) is checked against MAX_DECODE_PIXELS (48 MP passes);
// - a PDF page must have a sane size, and is always rendered to at most MAX_EDGE px;
// - sharp refuses inputs over MAX_DECODE_PIXELS (`limitInputPixels`);
// - one conversion at a time per process (a module-level queue), so concurrent hostile files
//   can't add up their memory.
// Output images live in memory only and are never stored (D38). Nothing about the file's
// content is logged (NFR-SEC-11).
import type { PDFiumLibrary } from '@hyzyla/pdfium';
import type heicDecode from 'heic-decode';
import sharp, { type Sharp } from 'sharp';
import {
  SCHEDULE_FILE_MAX_BYTES,
  SCHEDULE_FILE_MAX_PDF_PAGES,
  SCHEDULE_IMAGE_MAX_EDGE_PX,
  type ParseErrorCode,
} from '@synkd/shared';

/** Long-edge cap for images sent to the vision model (NFR-PERF-6 uses the same 2000 px). */
export const MAX_EDGE_PX = SCHEDULE_IMAGE_MAX_EDGE_PX;

/**
 * Largest image we decode, in pixels: a 48 MP iPhone photo (8064 × 6048) must pass, a
 * decompression bomb must not. Decoded RGBA at this size is about 200 MB.
 */
export const MAX_DECODE_PIXELS = 50_000_000;

/** PDF page edges outside this range (in points, 1/72 in) are refused: 200 in is PDF's own cap. */
export const PDF_PAGE_MIN_PT = 1;
export const PDF_PAGE_MAX_PT = 14_400;

const JPEG_QUALITY = 85;

export type InputKind = 'pdf' | 'heic' | 'jpeg' | 'png' | 'webp';

export interface OutputImage {
  width: number;
  height: number;
  /** JPEG bytes. */
  bytes: Uint8Array;
}

export interface ConvertResult {
  kind: InputKind;
  /** Page count for PDFs, 1 otherwise. */
  pages: number;
  images: OutputImage[];
}

export type ConvertErrorCode = Extract<
  ParseErrorCode,
  'unsupported_file' | 'file_too_large' | 'too_many_pages' | 'image_too_large' | 'unreadable_file'
>;

/** The file can't be converted. Not worth retrying: the same file fails the same way. */
export class ConvertError extends Error {
  constructor(
    readonly code: ConvertErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ConvertError';
  }
}

const ascii = (b: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...b.subarray(start, end));

/** HEIF brands of still images (iPhone photos use `heic`; `mif1` is the generic one). */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/** Identifies the file by its magic bytes, never by extension or declared type (NFR-SEC-6). */
export function sniffKind(b: Uint8Array): InputKind | null {
  if (b.length < 12) return null;
  if (ascii(b, 0, 5) === '%PDF-') return 'pdf';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && ascii(b, 1, 8) === 'PNG\r\n\x1a\n') return 'png';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (ascii(b, 4, 8) === 'ftyp' && HEIF_BRANDS.has(ascii(b, 8, 12))) return 'heic';
  return null;
}

/** The media type to store or serve for a sniffed kind. */
export const KIND_MEDIA_TYPES = {
  pdf: 'application/pdf',
  heic: 'image/heic',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const satisfies Record<InputKind, string>;

/**
 * The largest image size a HEIF file declares, in pixels, read from its `ispe` (image spatial
 * extent) properties without decoding anything; `null` if it declares none. A gridded iPhone
 * photo lists its tiles and the full image, so the largest is the one that matters.
 */
export function heicDeclaredPixels(b: Uint8Array): number | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let largest: number | null = null;
  // Box layout: size(4) 'ispe'(4) version+flags(4) width(4) height(4).
  for (let i = 4; i + 16 <= b.length; i++) {
    if (b[i] !== 0x69 || b[i + 1] !== 0x73 || b[i + 2] !== 0x70 || b[i + 3] !== 0x65) continue;
    const width = view.getUint32(i + 8);
    const height = view.getUint32(i + 12);
    const pixels = width * height;
    if (largest === null || pixels > largest) largest = pixels;
  }
  return largest;
}

// One conversion at a time per process (spike §8): a hostile file can use hundreds of MB, and
// two at once on a shared instance could take down everything else running on it.
let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

// The WASM engines load lazily and are cached per process, so only the first conversion on a
// cold instance pays for compiling them (about 20–160 ms, spike §4.1).
let pdfium: Promise<PDFiumLibrary> | null = null;
function getPdfium(): Promise<PDFiumLibrary> {
  pdfium ??= import('@hyzyla/pdfium').then(({ PDFiumLibrary }) => PDFiumLibrary.init());
  // A failed load is retried next time instead of being cached.
  pdfium.catch(() => {
    pdfium = null;
  });
  return pdfium;
}

type HeicDecode = typeof heicDecode;
let heic: Promise<HeicDecode> | null = null;
function getHeicDecoder(): Promise<HeicDecode> {
  // libheif-js instantiates its embedded WASM when the module is first evaluated.
  heic ??= import('heic-decode').then((m) => m.default);
  heic.catch(() => {
    heic = null;
  });
  return heic;
}

/** The scale (1 = 72 dpi) that puts a page's long edge at `maxEdge` px. */
export function pdfScaleFor(widthPt: number, heightPt: number, maxEdge = MAX_EDGE_PX): number {
  return maxEdge / Math.max(widthPt, heightPt);
}

async function toJpeg(pipeline: Sharp): Promise<OutputImage> {
  const { data, info } = await pipeline
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, bytes: new Uint8Array(data) };
}

async function rasterisePdf(bytes: Uint8Array, maxEdge: number): Promise<ConvertResult> {
  const lib = await getPdfium();
  let doc: Awaited<ReturnType<PDFiumLibrary['loadDocument']>>;
  try {
    doc = await lib.loadDocument(bytes);
  } catch {
    // Damaged, or protected with a password.
    throw new ConvertError('unreadable_file', 'The PDF could not be opened');
  }
  try {
    const pages = doc.getPageCount();
    if (pages < 1) throw new ConvertError('unreadable_file', 'The PDF has no pages');
    if (pages > SCHEDULE_FILE_MAX_PDF_PAGES) {
      throw new ConvertError(
        'too_many_pages',
        `The PDF has ${pages} pages; the limit is ${SCHEDULE_FILE_MAX_PDF_PAGES}`,
      );
    }
    const images: OutputImage[] = [];
    for (const page of doc.pages()) {
      const { originalWidth: w, originalHeight: h } = page.getOriginalSize();
      if (
        !Number.isFinite(w) ||
        !Number.isFinite(h) ||
        Math.min(w, h) < PDF_PAGE_MIN_PT ||
        Math.max(w, h) > PDF_PAGE_MAX_PT
      ) {
        throw new ConvertError('image_too_large', 'A PDF page has an unusable size');
      }
      // Always rendered to at most maxEdge × maxEdge, whatever the page declares. `bitmap`
      // returns raw BGRA pixels; sharp swaps the channels and encodes in libvips.
      const raw = await page.render({ render: 'bitmap', scale: pdfScaleFor(w, h, maxEdge) });
      images.push(
        await toJpeg(
          sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
            .removeAlpha()
            .recomb([
              [0, 0, 1],
              [0, 1, 0],
              [1, 0, 0],
            ]),
        ),
      );
    }
    return { kind: 'pdf', pages, images };
  } finally {
    doc.destroy();
  }
}

async function heicToJpeg(bytes: Uint8Array, maxEdge: number): Promise<ConvertResult> {
  const declared = heicDeclaredPixels(bytes);
  if (declared === null) throw new ConvertError('unreadable_file', 'The image has no size');
  if (declared > MAX_DECODE_PIXELS) {
    throw new ConvertError('image_too_large', 'The image is too large to read');
  }
  const decode = await getHeicDecoder();
  let decoded: Awaited<ReturnType<HeicDecode>>;
  try {
    decoded = await decode({ buffer: bytes });
  } catch {
    throw new ConvertError('unreadable_file', 'The image could not be read');
  }
  // The decoder reports the real size; check it too in case the header lied.
  if (decoded.width * decoded.height > MAX_DECODE_PIXELS) {
    throw new ConvertError('image_too_large', 'The image is too large to read');
  }
  const image = await toJpeg(
    sharp(new Uint8Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength), {
      raw: { width: decoded.width, height: decoded.height, channels: 4 },
    })
      .removeAlpha()
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true }),
  );
  return { kind: 'heic', pages: 1, images: [image] };
}

/** JPEG/PNG/WebP: the server-side fallback when on-device compression didn't happen. */
async function normaliseImage(
  bytes: Uint8Array,
  kind: InputKind,
  maxEdge: number,
): Promise<ConvertResult> {
  try {
    const image = await toJpeg(
      sharp(bytes, { limitInputPixels: MAX_DECODE_PIXELS, failOn: 'error' })
        .rotate() // apply EXIF orientation; the output carries no metadata (no GPS, D35)
        .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }),
    );
    return { kind, pages: 1, images: [image] };
  } catch (err) {
    if (err instanceof Error && /pixel limit/i.test(err.message)) {
      throw new ConvertError('image_too_large', 'The image is too large to read');
    }
    throw new ConvertError('unreadable_file', 'The image could not be read');
  }
}

/**
 * Converts one upload into at most SCHEDULE_FILE_MAX_PDF_PAGES JPEGs with a long edge of at
 * most `maxEdge` px. Throws {@link ConvertError} when the file can't be used; anything else
 * thrown is an internal failure (worth retrying).
 */
export function convertUpload(bytes: Uint8Array, maxEdge = MAX_EDGE_PX): Promise<ConvertResult> {
  if (bytes.byteLength > SCHEDULE_FILE_MAX_BYTES) {
    return Promise.reject(new ConvertError('file_too_large', 'The file is over 10 MB'));
  }
  const kind = sniffKind(bytes);
  if (kind === null) {
    return Promise.reject(new ConvertError('unsupported_file', 'Unsupported file type'));
  }
  return oneAtATime(() => {
    switch (kind) {
      case 'pdf':
        return rasterisePdf(bytes, maxEdge);
      case 'heic':
        return heicToJpeg(bytes, maxEdge);
      case 'jpeg':
      case 'png':
      case 'webp':
        return normaliseImage(bytes, kind, maxEdge);
    }
  });
}
