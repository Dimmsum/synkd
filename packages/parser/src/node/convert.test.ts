// The converter (WF-024 → WF-027): both WASM engines load and convert in plain Node, and the
// guards refuse hostile files before decoding them (spike §8, NFR-SEC-6).
import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  ConvertError,
  MAX_EDGE_PX,
  convertUpload,
  heicDeclaredPixels,
  pdfScaleFor,
  sniffKind,
} from './convert';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ok';
  } catch (err) {
    if (err instanceof ConvertError) return err.code;
    throw err;
  }
}

/** tiny.heic with every `ispe` box claiming `width × height`. */
function heicClaiming(width: number, height: number): Uint8Array {
  const bytes = fixture('tiny.heic').slice();
  const view = new DataView(bytes.buffer);
  for (let i = 4; i + 16 <= bytes.length; i++) {
    if (String.fromCharCode(...bytes.subarray(i, i + 4)) !== 'ispe') continue;
    view.setUint32(i + 8, width);
    view.setUint32(i + 12, height);
  }
  return bytes;
}

/** A PNG header that declares `width × height` (with valid CRCs) and no real pixel data. */
function pngClaiming(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const body = new Uint8Array([...new TextEncoder().encode(type), ...data]);
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(body, 4);
    view.setUint32(8 + data.length, crc32(body));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', ihdr),
    ...chunk('IDAT', new Uint8Array([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])),
    ...chunk('IEND', new Uint8Array()),
  ]);
}

describe('sniffKind (NFR-SEC-6)', () => {
  it('identifies files by magic bytes, never by name', async () => {
    expect(sniffKind(fixture('tiny.pdf'))).toBe('pdf');
    expect(sniffKind(fixture('tiny.heic'))).toBe('heic');
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    expect(sniffKind(new Uint8Array(png))).toBe('png');
    const webp = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#fff' },
    })
      .webp()
      .toBuffer();
    expect(sniffKind(new Uint8Array(webp))).toBe('webp');
    expect(sniffKind(new TextEncoder().encode('<html>not a schedule</html>'))).toBeNull();
    expect(
      sniffKind(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">')),
    ).toBeNull();
    expect(sniffKind(new Uint8Array(4))).toBeNull();
  });
});

describe('pdfScaleFor', () => {
  it('puts the long edge of an A4 page at 2000 px', () => {
    expect(595.28 * pdfScaleFor(595.28, 841.89)).toBeLessThan(MAX_EDGE_PX);
    expect(841.89 * pdfScaleFor(595.28, 841.89)).toBeCloseTo(MAX_EDGE_PX);
  });
});

describe('heicDeclaredPixels', () => {
  it('reads the declared size without decoding', () => {
    expect(heicDeclaredPixels(fixture('tiny.heic'))).toBe(480 * 360);
    expect(heicDeclaredPixels(new Uint8Array(64))).toBeNull();
  });
});

describe('convertUpload', () => {
  it('rasterises a PDF page to a JPEG no larger than 2000 px', async () => {
    const result = await convertUpload(fixture('tiny.pdf'));
    expect(result).toMatchObject({ kind: 'pdf', pages: 1 });
    const [page] = result.images;
    expect(page && isJpeg(page.bytes)).toBe(true);
    expect(Math.max(page?.width ?? 0, page?.height ?? 0)).toBeLessThanOrEqual(MAX_EDGE_PX);
    expect(Math.max(page?.width ?? 0, page?.height ?? 0)).toBeGreaterThan(1900);
  }, 30_000);

  it('converts HEIC to JPEG without enlarging it', async () => {
    const result = await convertUpload(fixture('tiny.heic'));
    expect(result.kind).toBe('heic');
    const [image] = result.images;
    expect(image && isJpeg(image.bytes)).toBe(true);
    expect([image?.width, image?.height]).toEqual([480, 360]);
  }, 30_000);

  it('resizes a large JPEG and drops its metadata (D35: no GPS)', async () => {
    const big = await sharp({
      create: { width: 3000, height: 1500, channels: 3, background: '#88aaff' },
    })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'someone' } } })
      .toBuffer();
    const result = await convertUpload(new Uint8Array(big));
    const [image] = result.images;
    expect([image?.width, image?.height]).toEqual([2000, 1000]);
    const meta = await sharp(image?.bytes).metadata();
    expect(meta.exif).toBeUndefined();
  }, 30_000);

  it('lets a 48 MP iPhone-size HEIC through the size check', async () => {
    // The patched header no longer matches the pixels, so libheif refuses the decode itself;
    // what matters is that the size guard let it through.
    expect(await codeOf(convertUpload(heicClaiming(8064, 6048)))).toBe('unreadable_file');
  }, 30_000);

  it('refuses a HEIC that declares more than 50 MP, before decoding it', async () => {
    expect(await codeOf(convertUpload(heicClaiming(10_000, 10_000)))).toBe('image_too_large');
  });

  it('refuses an image over the pixel limit (sharp limitInputPixels)', async () => {
    expect(await codeOf(convertUpload(pngClaiming(20_000, 20_000)))).toBe('image_too_large');
  });

  it('refuses PDFs over 5 pages (FR-IMP-1)', async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 6; i++) doc.addPage();
    expect(await codeOf(convertUpload(await doc.save()))).toBe('too_many_pages');
  }, 30_000);

  it('refuses a PDF page with an absurd size', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([20_000, 20_000]);
    expect(await codeOf(convertUpload(await doc.save()))).toBe('image_too_large');
  }, 30_000);

  it('refuses damaged files', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\nthis is not really a pdf at all\n');
    expect(await codeOf(convertUpload(bytes))).toBe('unreadable_file');
  }, 30_000);

  it('refuses unknown types and files over 10 MB', async () => {
    expect(await codeOf(convertUpload(new Uint8Array(64)))).toBe('unsupported_file');
    expect(await codeOf(convertUpload(new Uint8Array(10 * 1024 * 1024 + 1)))).toBe(
      'file_too_large',
    );
  });

  it('runs conversions one at a time but completes all of them', async () => {
    const results = await Promise.all([
      convertUpload(fixture('tiny.heic')),
      convertUpload(fixture('tiny.pdf')),
      convertUpload(new Uint8Array(64)).catch((e: unknown) => e),
    ]);
    expect(results[0]).toMatchObject({ kind: 'heic' });
    expect(results[1]).toMatchObject({ kind: 'pdf' });
    expect(results[2]).toBeInstanceOf(ConvertError);
  }, 30_000);
});
