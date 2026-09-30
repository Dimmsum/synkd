// SPIKE (WF-024): proves the chosen WASM engines load and convert in plain Node. Timing and memory
// are measured by scripts/spike-wf-024/bench.ts, not here.
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { MAX_EDGE_PX, SpikeInputError, convertUpload, pdfScaleFor, sniffKind } from './convert';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

describe('sniffKind', () => {
  it('identifies files by magic bytes', () => {
    expect(sniffKind(fixture('tiny.pdf'))).toBe('pdf');
    expect(sniffKind(fixture('tiny.heic'))).toBe('heic');
    expect(sniffKind(new TextEncoder().encode('<html>not a schedule</html>'))).toBeNull();
  });
});

describe('pdfScaleFor', () => {
  it('puts the long edge of an A4 page at 2000 px', () => {
    expect(595.28 * pdfScaleFor(595.28, 841.89)).toBeLessThan(MAX_EDGE_PX);
    expect(841.89 * pdfScaleFor(595.28, 841.89)).toBeCloseTo(MAX_EDGE_PX);
  });
});

describe('convertUpload', () => {
  it('rasterises a PDF page to a JPEG no larger than 2000 px', async () => {
    const result = await convertUpload(fixture('tiny.pdf'));
    expect(result.kind).toBe('pdf');
    expect(result.images).toHaveLength(1);
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

  it('rejects PDFs over 5 pages (FR-IMP-1)', async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 6; i++) doc.addPage();
    await expect(convertUpload(await doc.save())).rejects.toBeInstanceOf(SpikeInputError);
  }, 30_000);

  it('rejects unknown file types', async () => {
    await expect(convertUpload(new Uint8Array(64))).rejects.toBeInstanceOf(SpikeInputError);
  });
});
