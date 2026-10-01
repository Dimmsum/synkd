// Where profile photos live in Storage (WF-040). Pure.
//
// Each upload gets a new object, `<users.id>/<128-bit random code>.webp` in the public
// AVATAR_BUCKET: the name can't be guessed, so a photo's URL is only known to whoever the
// database hands users.avatar_url to (block-aware functions, D43). See backend migration
// 20261003200200_avatars_bucket.sql.

import { AVATAR_BUCKET } from '@whosfree/shared';

const NAME = /^[A-Za-z0-9_-]{22}\.webp$/;

/** A new object path for `userId`'s photo. `random` is 16 random bytes. */
export function avatarObjectPath(userId: string, random: Uint8Array): string {
  if (random.length !== 16) throw new Error('avatarObjectPath needs 16 random bytes');
  return `${userId}/${Buffer.from(random).toString('base64url')}.webp`;
}

/** True for a well-formed object name inside a user's folder (`<code>.webp`). */
export function isAvatarObjectName(name: string): boolean {
  return NAME.test(name);
}

/**
 * True when `url` is a photo stored in our bucket (rather than one from Google), given the
 * Supabase project URL.
 */
export function isStoredAvatarUrl(url: string | null, supabaseUrl: string | undefined): boolean {
  if (!url || !supabaseUrl) return false;
  const prefix = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${AVATAR_BUCKET}/`;
  return url.startsWith(prefix);
}
