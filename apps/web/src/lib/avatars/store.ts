// Writing profile photos to Supabase Storage (WF-040, D41).
//
// The avatars bucket gives clients no write access at all (backend migration
// 20261003200200_avatars_bucket.sql): a browser uploading directly could skip the magic-byte
// check and the re-encode that strips EXIF/GPS (D35). So the server writes with the secret key,
// and this store is deliberately narrow: put one processed photo into a user's own folder, and
// delete that user's other photos. The folder is always the users.id the database returned for
// the signed-in user (`current_user_id()`), never an id from the request.
//
// Logging (NFR-SEC-11): Storage error codes only, never paths, URLs or user ids.

import 'server-only';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AVATAR_BUCKET } from '@synkd/shared';
import { avatarObjectPath } from './paths';

/** A year: every upload has a new name, so a stored photo never changes. */
const CACHE_SECONDS = String(365 * 24 * 60 * 60);

export interface AvatarStore {
  /** Stores a processed WebP as a new object in `userId`'s folder; returns its public URL. */
  put(userId: string, webp: Buffer): Promise<{ path: string; url: string }>;
  /** Deletes one object that `put` returned. */
  remove(path: string): Promise<void>;
  /** Deletes every object in `userId`'s folder except `keepPath` (all of them when null). */
  removeAllExcept(userId: string, keepPath: string | null): Promise<void>;
}

type Env = Record<string, string | undefined>;

function failure(op: string, error: { message?: string; statusCode?: string } | null): Error {
  // supabase-js StorageError messages are generic ("Bucket not found", "The resource already
  // exists"); the status code is enough to debug and holds nothing personal.
  return new Error(`avatars ${op} failed (${error?.statusCode ?? 'no status'})`);
}

/** Wraps a secret-key client. Exported for tests; use createAvatarStore(). */
export function avatarStoreFrom(client: SupabaseClient): AvatarStore {
  const bucket = () => client.storage.from(AVATAR_BUCKET);
  return {
    async put(userId, webp) {
      const path = avatarObjectPath(userId, randomBytes(16));
      const { error } = await bucket().upload(path, webp, {
        contentType: 'image/webp',
        cacheControl: CACHE_SECONDS,
        upsert: false,
      });
      if (error) throw failure('upload', error as { statusCode?: string });
      return { path, url: bucket().getPublicUrl(path).data.publicUrl };
    },
    async remove(path) {
      const { error } = await bucket().remove([path]);
      if (error) throw failure('remove', error as { statusCode?: string });
    },
    async removeAllExcept(userId, keepPath) {
      const { data, error } = await bucket().list(userId, { limit: 100 });
      if (error) throw failure('list', error as { statusCode?: string });
      const stale = data.map((o) => `${userId}/${o.name}`).filter((p) => p !== keepPath);
      if (stale.length === 0) return;
      const { error: removeError } = await bucket().remove(stale);
      if (removeError) throw failure('remove', removeError as { statusCode?: string });
    },
  };
}

/**
 * The store, or the names of the missing variables (never their values) when the Supabase URL
 * or secret key isn't set.
 */
export function createAvatarStore(
  env: Env = process.env,
): { ok: true; store: AvatarStore } | { ok: false; problems: string[] } {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = env.SUPABASE_SECRET_KEY;
  const problems: string[] = [];
  if (!url) problems.push('NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!secretKey) problems.push('SUPABASE_SECRET_KEY is not set');
  if (!url || !secretKey) return { ok: false, problems };
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { ok: true, store: avatarStoreFrom(client) };
}
