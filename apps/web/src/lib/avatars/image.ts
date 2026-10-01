// Profile photo processing on the server (WF-040; FR-AUTH-2, D35, NFR-SEC-1).
//
// Never trust the browser: the file's type comes from its first bytes (not its name or the
// Content-Type the browser sent), and every photo is decoded and re-encoded with sharp into a
// small square WebP. sharp writes no metadata unless asked to (`keepMetadata`/`withMetadata`,
// never used here), so EXIF, GPS position, XMP, IPTC and colour profiles from the camera are all
// dropped (D35: no location data anywhere). The orientation EXIF tag is applied to the pixels
// first (`rotate()`), so photos still come out upright.

import 'server-only';
import sharp from 'sharp';
import { AVATAR_SIZE_PX, AVATAR_STORED_MAX_BYTES, type AvatarUploadType } from '@whosfree/shared';

export { sniffImageType } from './sniff';
export type { AvatarUploadType };

/**
 * Decoding limit: about a 50-megapixel photo. A small file can still claim a huge size
 * ("decompression bomb"); sharp refuses to decode anything bigger.
 */
const MAX_INPUT_PIXELS = 50_000_000;

/** WebP quality; a 256 px face comes out at roughly 10–30 KB. */
const WEBP_QUALITY = 80;

export class AvatarImageError extends Error {}

/**
 * `bytes` (an already-sniffed JPEG, PNG or WebP) as the stored avatar: a centre-cropped
 * AVATAR_SIZE_PX square WebP with no metadata. Throws AvatarImageError when the image can't be
 * decoded or the result is too big for the bucket.
 */
export async function processAvatar(bytes: Uint8Array): Promise<Buffer> {
  let out: Buffer;
  try {
    out = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', pages: 1 })
      .rotate()
      .resize(AVATAR_SIZE_PX, AVATAR_SIZE_PX, { fit: 'cover', position: 'centre' })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch {
    // sharp's message can include details of the input; it is not logged or shown.
    throw new AvatarImageError('Could not read the image');
  }
  if (out.byteLength > AVATAR_STORED_MAX_BYTES) throw new AvatarImageError('Image too large');
  return out;
}
