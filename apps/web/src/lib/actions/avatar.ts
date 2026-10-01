'use server';

// Profile photo (FR-AUTH-2, WF-040): replace the photo taken from Google, add one after email
// sign-up, or remove it. The photo is checked and re-encoded here (lib/avatars/image.ts: type by
// magic bytes, a small square WebP, no EXIF/GPS, D35), stored by the server in the avatars bucket
// (lib/avatars/store.ts), and users.avatar_url is updated as the signed-in user under RLS. Other
// people only ever get the URL through the block-aware database functions (D41, D43).
//
// Logging (NFR-SEC-11): codes only, never file names, URLs or ids.

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { AVATAR_UPLOAD_MAX_BYTES } from '@whosfree/shared';
import { AvatarImageError, processAvatar, sniffImageType } from '@/lib/avatars/image';
import { createAvatarStore, type AvatarStore } from '@/lib/avatars/store';
import { TRY_AGAIN } from '@/lib/db-errors';
import { createServerSupabase, type ServerSupabase } from '@/lib/supabase/server';
import { fail, type ActionResult } from './result';

const NOT_SET_UP = 'Photo uploads aren’t available right now. Try again later.';

/** The signed-in user's users.id, as Postgres resolves it from their token. */
async function myUserId(supabase: ServerSupabase): Promise<string | null> {
  const { data, error } = await supabase.rpc('current_user_id');
  if (error) {
    console.error('current_user_id failed', error.code);
    return null;
  }
  return typeof data === 'string' ? data : null;
}

function avatarStore(): AvatarStore | null {
  const created = createAvatarStore();
  if (created.ok) return created.store;
  console.warn(`Avatar uploads are not configured: ${created.problems.join('; ')}`);
  return null;
}

/** Sets (or clears) the caller's own users.avatar_url; RLS limits the update to their row. */
async function saveAvatarUrl(
  supabase: ServerSupabase,
  clerkId: string,
  url: string | null,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('users')
    .update({ avatar_url: url })
    .eq('clerk_id', clerkId)
    .select('id');
  if (error || data.length !== 1) {
    console.error('Saving the avatar failed', error?.code ?? 'no row updated');
    return false;
  }
  return true;
}

/** Deletes the user's other stored photos after the response. Best effort. */
function cleanUpLater(store: AvatarStore, userId: string, keepPath: string | null) {
  after(async () => {
    try {
      await store.removeAllExcept(userId, keepPath);
    } catch (error) {
      console.error('Removing old avatars failed', (error as Error).message);
    }
  });
}

/**
 * Replaces the signed-in user's photo with the image in `formData` (field `photo`): a JPEG, PNG
 * or WebP of at most AVATAR_UPLOAD_MAX_BYTES (the browser shrinks bigger photos first).
 */
export async function uploadAvatar(formData: FormData): Promise<ActionResult<{ url: string }>> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return fail('Sign in again to change your photo.');

  const file = formData.get('photo');
  if (!(file instanceof File) || file.size === 0) return fail('Pick a photo first.');
  if (file.size > AVATAR_UPLOAD_MAX_BYTES) return fail('That photo is too big. Try a smaller one.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!sniffImageType(bytes)) return fail('Use a JPEG, PNG or WebP photo.');

  let webp: Buffer;
  try {
    webp = await processAvatar(bytes);
  } catch (error) {
    if (error instanceof AvatarImageError) {
      return fail('We couldn’t read that photo. Try another one.');
    }
    throw error;
  }

  const store = avatarStore();
  if (!store) return fail(NOT_SET_UP);
  const supabase = await createServerSupabase();
  const me = await myUserId(supabase);
  if (!me) return fail('Finish signing up first, then try again.');

  let stored: { path: string; url: string };
  try {
    stored = await store.put(me, webp);
  } catch (error) {
    console.error('Uploading the avatar failed', (error as Error).message);
    return fail(TRY_AGAIN);
  }
  if (!(await saveAvatarUrl(supabase, clerkId, stored.url))) {
    // The old photo stays; only the one just uploaded goes.
    await store.remove(stored.path).catch((error: unknown) => {
      console.error('Removing the unused avatar failed', (error as Error).message);
    });
    return fail(TRY_AGAIN);
  }
  cleanUpLater(store, me, stored.path);

  // The photo shows in the app shell and on Now, friends and groups.
  revalidatePath('/', 'layout');
  return { ok: true, data: { url: stored.url } };
}

/** Removes the signed-in user's photo (theirs or Google's); initials show instead. */
export async function removeAvatar(): Promise<ActionResult> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return fail('Sign in again to change your photo.');
  const supabase = await createServerSupabase();
  if (!(await saveAvatarUrl(supabase, clerkId, null))) return fail(TRY_AGAIN);

  const me = await myUserId(supabase);
  const store = me ? avatarStore() : null;
  if (me && store) cleanUpLater(store, me, null);

  revalidatePath('/', 'layout');
  return { ok: true };
}
