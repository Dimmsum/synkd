/**
 * A stable avatar hue (0–359) for a user id, so someone keeps the same colour everywhere
 * without storing one. Not an identifier: many ids share a hue.
 */
export function hueFor(id: string): number {
  // FNV-1a, 32-bit.
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 360;
}
