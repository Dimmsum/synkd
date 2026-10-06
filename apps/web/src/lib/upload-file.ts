// Getting a schedule file ready on the device before upload (FR-IMP-1, NFR-PERF-6, D35, D38).
//
// Photos and screenshots are redrawn at most SCHEDULE_IMAGE_MAX_EDGE_PX (2000 px) on the long
// edge and re-encoded as JPEG: smaller uploads, and the redraw drops the photo's metadata (EXIF,
// including GPS position, D35) before anything leaves the phone. PDFs go as they are. A HEIC
// the browser can't decode (Chrome, Android) goes as it is too; the server converts it.
//
// The pure helpers are unit-tested; prepareForUpload and sha256Hex need a browser.

import {
  SCHEDULE_FILE_MAX_BYTES,
  SCHEDULE_IMAGE_MAX_EDGE_PX,
  type ScheduleFileMimeType,
} from '@synkd/shared';

const EXTENSION_TYPES: Record<string, ScheduleFileMimeType> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

/** The schedule media type of a picked file, from its declared type or else its extension. */
export function scheduleFileType(file: {
  name: string;
  type: string;
}): ScheduleFileMimeType | null {
  const declared = file.type.toLowerCase();
  const fromType = Object.values(EXTENSION_TYPES).find((t) => t === declared);
  if (fromType) return fromType;
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  return ext ? (EXTENSION_TYPES[ext] ?? null) : null;
}

/** Client-side check only; the server re-checks by magic bytes (NFR-SEC-6). */
export function checkFile(file: { name: string; size: number; type: string }): string | undefined {
  if (!scheduleFileType(file))
    return 'That file type won’t work. Use a PDF, PNG, JPG, HEIC or WebP.';
  if (file.size > SCHEDULE_FILE_MAX_BYTES) {
    return 'That file is over 10 MB. Try a smaller photo or a PDF.';
  }
  if (file.size === 0) return 'That file is empty.';
  return undefined;
}

/** The size to draw an image at so its long edge is at most `maxEdge` (never enlarged). */
export function scaledSize(
  width: number,
  height: number,
  maxEdge = SCHEDULE_IMAGE_MAX_EDGE_PX,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** `photo.HEIC` → `photo.jpg`. */
export function jpegName(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, '');
  return `${base || 'schedule'}.jpg`;
}

export interface PreparedFile {
  blob: Blob;
  name: string;
  type: ScheduleFileMimeType;
}

/** JPEG quality for redrawn photos: keeps small print legible for the model. */
const JPEG_QUALITY = 0.9;

async function drawToJpeg(source: ImageBitmap): Promise<Blob | null> {
  const { width, height } = scaledSize(source.width, source.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  // White under transparent screenshots, so they don't turn black as JPEG.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
}

/** Compresses an image on the device (NFR-PERF-6); anything it can't redraw goes as it is. */
export async function prepareForUpload(file: File): Promise<PreparedFile | null> {
  const type = scheduleFileType(file);
  if (!type) return null;
  if (type === 'application/pdf') return { blob: file, name: file.name, type };
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const jpeg = await drawToJpeg(bitmap);
    if (jpeg && jpeg.size > 0 && jpeg.size <= SCHEDULE_FILE_MAX_BYTES) {
      return { blob: jpeg, name: jpegName(file.name), type: 'image/jpeg' };
    }
  } catch {
    // Not decodable here (e.g. HEIC outside Safari): the server converts it.
  } finally {
    bitmap?.close();
  }
  return { blob: file, name: file.name, type };
}

/** Lowercase hex SHA-256 of the bytes that will be uploaded (WF-035 reuses identical files). */
export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
