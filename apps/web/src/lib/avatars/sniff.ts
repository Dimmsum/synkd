// What kind of image a file really is, from its first bytes ("magic numbers"), for profile
// photos (WF-040). Pure, with no dependencies, so the browser can check a file before sending it
// and the server can check it again (the server's check is the one that counts).

import type { AvatarUploadType } from '@whosfree/shared';

const startsWith = (bytes: Uint8Array, sig: readonly number[], at = 0) =>
  bytes.length >= at + sig.length && sig.every((b, i) => bytes[at + i] === b);

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = ascii('RIFF');
const WEBP = ascii('WEBP');

/** The accepted image type `bytes` starts with, or null for anything else (HEIC, GIF, SVG, …). */
export function sniffImageType(bytes: Uint8Array): AvatarUploadType | null {
  if (startsWith(bytes, JPEG)) return 'image/jpeg';
  if (startsWith(bytes, PNG)) return 'image/png';
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return 'image/webp';
  return null;
}
