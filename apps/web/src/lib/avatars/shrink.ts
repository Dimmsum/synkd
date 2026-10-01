// Shrinking a profile photo in the browser before upload (WF-040, NFR-PERF-6). Phone photos are
// several megabytes, more than a Server Action accepts; a centre square of SHRUNK_EDGE_PX is
// plenty for a 256 px avatar. Redrawing on a canvas also leaves the camera's EXIF (and GPS)
// behind on the device. The server still checks and re-encodes whatever arrives
// (lib/avatars/image.ts): this step is a convenience, not a safeguard.

/** Edge of the square sent to the server. */
const SHRUNK_EDGE_PX = 768;

/** The centre square of a `width` × `height` image: [sx, sy, side]. Pure, for tests. */
export function centreSquare(width: number, height: number): [number, number, number] {
  const side = Math.min(width, height);
  return [Math.round((width - side) / 2), Math.round((height - side) / 2), side];
}

/**
 * `file` as a JPEG of the centre square, at most SHRUNK_EDGE_PX wide, or the file itself when
 * the browser can't decode it (the server then decides).
 */
export async function shrinkForUpload(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const [sx, sy, side] = centreSquare(bitmap.width, bitmap.height);
    const edge = Math.min(side, SHRUNK_EDGE_PX);
    const canvas = document.createElement('canvas');
    canvas.width = edge;
    canvas.height = edge;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, edge, edge);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}
