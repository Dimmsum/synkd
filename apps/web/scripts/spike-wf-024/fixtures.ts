// SPIKE (WF-024): generates synthetic schedule files for the benchmark. Nothing here is personal
// data: every "timetable" is drawn from made-up course codes.
//
// Run from apps/web with Node ≥ 22.18 (type stripping):
//   node scripts/spike-wf-024/fixtures.ts [outDir]
// Default outDir is $TMPDIR/whosfree-wf024. HEIC files need macOS `sips` (skipped elsewhere).
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';

const out = process.argv[2] ?? join(tmpdir(), 'whosfree-wf024');
mkdirSync(out, { recursive: true });
const say = (s: string) => process.stdout.write(`${s}\n`);

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

/** An SVG timetable at the given size, roughly what a phone photo of a printed schedule shows. */
function timetableSvg(w: number, h: number): string {
  const colW = (w - 300) / 5;
  const rowH = (h - 300) / 12;
  const f = h / 3024; // font scale
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#f4f1ea"/>`;
  DAYS.forEach((d, i) => {
    s += `<text x="${320 + i * colW}" y="${200 * f}" font-size="${90 * f}" font-family="Helvetica">${d}</text>`;
  });
  for (let r = 0; r < 12; r++) {
    const y = 280 * f + r * rowH;
    s += `<text x="40" y="${y + 80 * f}" font-size="${70 * f}" font-family="Helvetica">${8 + r}:00</text>`;
    s += `<line x1="280" x2="${w - 40}" y1="${y}" y2="${y}" stroke="#999" stroke-width="${4 * f}"/>`;
  }
  for (let i = 0; i < 22; i++) {
    const d = i % 5;
    const r = (i * 7) % 11;
    const x = 300 + d * colW;
    const y = 290 * f + r * rowH;
    s += `<rect x="${x}" y="${y}" width="${colW - 20}" height="${rowH * (1 + (i % 2)) - 10}" fill="hsl(${i * 37},60%,80%)" stroke="#333" stroke-width="${3 * f}"/>`;
    s += `<text x="${x + 20}" y="${y + 90 * f}" font-size="${60 * f}" font-family="Helvetica">COMP ${1100 + i * 7}</text>`;
    s += `<text x="${x + 20}" y="${y + 160 * f}" font-size="${48 * f}" font-family="Helvetica">Lecture ${i}</text>`;
  }
  return `${s}</svg>`;
}

/** Renders the SVG and adds sensor-like noise so JPEG/HEIC sizes resemble real photos. */
async function photoPixels(w: number, h: number, seed0: number) {
  const { data, info } = await sharp(Buffer.from(timetableSvg(w, h)))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let seed = seed0;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = Math.max(0, Math.min(255, (data[i] ?? 0) + (seed % 25) - 12));
  }
  return { data, raw: { width: info.width, height: info.height, channels: 3 as const } };
}

async function photoJpeg(w: number, h: number, quality: number, seed = 42): Promise<Buffer> {
  const { data, raw } = await photoPixels(w, h, seed);
  return sharp(data, { raw }).jpeg({ quality }).toBuffer();
}

/** A vector (text + shapes) PDF like a timetable exported from a university portal. */
async function vectorPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([595.28, 841.89]); // A4 portrait
    page.drawText(`Semester timetable, week block ${p + 1}`, { x: 40, y: 800, size: 16, font });
    DAYS.forEach((d, i) => page.drawText(d, { x: 90 + i * 98, y: 770, size: 11, font }));
    for (let r = 0; r < 13; r++) {
      const y = 750 - r * 55;
      page.drawText(`${8 + r}:00`, { x: 40, y: y - 12, size: 9, font });
      page.drawLine({ start: { x: 80, y }, end: { x: 575, y }, thickness: 0.5 });
    }
    for (let i = 0; i < 18; i++) {
      const d = (i + p) % 5;
      const r = (i * 5 + p) % 12;
      page.drawRectangle({
        x: 84 + d * 98,
        y: 700 - r * 55,
        width: 92,
        height: 50,
        color: rgb(0.7 + (i % 3) * 0.1, 0.8, 0.9 - (i % 4) * 0.1),
        borderColor: rgb(0.2, 0.2, 0.2),
        borderWidth: 0.5,
      });
      page.drawText(`COMP ${1100 + i * 7}`, { x: 88 + d * 98, y: 735 - r * 55, size: 8, font });
      page.drawText('Lecture', { x: 88 + d * 98, y: 722 - r * 55, size: 7, font });
    }
  }
  return doc.save();
}

/** A PDF whose pages are phone photos (a "scanned" timetable): the heaviest realistic PDF. */
async function scannedPdf(pages: number, quality: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let p = 0; p < pages; p++) {
    // A distinct image per page, so the renderer can't reuse a decoded bitmap across pages.
    const jpg = await doc.embedJpg(await photoJpeg(3024, 4032, quality, p + 1));
    const page = doc.addPage([595.28, 841.89]);
    page.drawImage(jpg, { x: 0, y: 0, width: 595.28, height: 841.89 });
  }
  return doc.save();
}

function write(name: string, bytes: Uint8Array | Buffer) {
  const path = join(out, name);
  writeFileSync(path, bytes);
  say(`${name.padEnd(22)} ${(statSync(path).size / 1024 / 1024).toFixed(2)} MB`);
}

function heicFrom(jpgName: string, heicName: string) {
  try {
    execFileSync(
      'sips',
      ['-s', 'format', 'heic', join(out, jpgName), '--out', join(out, heicName)],
      {
        stdio: 'ignore',
      },
    );
    say(
      `${heicName.padEnd(22)} ${(statSync(join(out, heicName)).size / 1024 / 1024).toFixed(2)} MB`,
    );
  } catch {
    say(`${heicName.padEnd(22)} skipped (needs macOS sips)`);
  }
}

write('vector-1p.pdf', await vectorPdf(1));
write('vector-5p.pdf', await vectorPdf(5));
write('vector-6p.pdf', await vectorPdf(6));
// Five distinct 12 MP photos, kept just under the 10 MB upload limit.
write('scan-5p.pdf', await scannedPdf(5, 75));
write('photo-12mp.jpg', await photoJpeg(4032, 3024, 92));
write('photo-48mp.jpg', await photoJpeg(8064, 6048, 85));
heicFrom('photo-12mp.jpg', 'photo-12mp.heic');
heicFrom('photo-48mp.jpg', 'photo-48mp.heic');
say(`\nfixtures in ${out}`);
