'use server';

// Offline friends (D44, FR-SOC-14, FR-SOC-16, FR-SOC-18, FR-SOC-19, WF-127). Each action calls
// one database function as the signed-in user; the database takes the owner from the token,
// requires the permission tick, enforces the cap of 20 and rate-limits adding (NFR-SEC-9, R14).
// The checks here only catch obvious input mistakes early. Nicknames are never logged: only
// SQLSTATEs (NFR-SEC-11).

import { revalidatePath } from 'next/cache';
import { OfflineFriendNickname } from '@whosfree/shared';
import { offlineFriendErrorMessage } from '@/lib/offline-friends';
import { isUuid } from '@/lib/social/mappers';
import { createServerSupabase } from '@/lib/supabase/server';
import { fail, ok, type ActionResult } from './result';

const TRY_AGAIN = 'Something went wrong on our side. Try again.';
const NOT_FOUND = 'We couldn’t find them. They may have been deleted already.';

function failFrom(fn: string, error: { code?: string | null; message?: string | null }) {
  const known = offlineFriendErrorMessage(error);
  if (!known) console.error(`${fn} failed`, error.code ?? 'no code');
  return fail(known ?? TRY_AGAIN);
}

/** Checks the nickname like the database does; returns it trimmed, or an error message. */
function cleanNickname(
  nickname: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const parsed = OfflineFriendNickname.safeParse(nickname);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: 'Give them a nickname of 1 to 40 characters.' };
}

/** An empty emoji means none. */
const cleanEmoji = (emoji: string | null) => emoji?.trim() || null;

/** Offline friends show on Now, Friends and their own page: re-render them all. */
function refresh() {
  revalidatePath('/', 'layout');
}

/**
 * Adds someone who isn't on whosfree (FR-SOC-14), known only by a nickname and an optional
 * emoji. Refused unless the viewer confirms they have that person's permission to add their
 * schedule (FR-SOC-16); the database records when. At most 20 per user (FR-SOC-18).
 */
export async function createOfflineFriend(input: {
  nickname: string;
  emoji: string | null;
  permissionConfirmed: boolean;
}): Promise<ActionResult<{ id: string }>> {
  const nickname = cleanNickname(input.nickname);
  if (!nickname.ok) return fail(nickname.error);
  if (input.permissionConfirmed !== true) {
    return fail('Tick the box to confirm you have their permission.');
  }
  const supabase = await createServerSupabase();
  const emoji = cleanEmoji(input.emoji);
  const { data, error } = await supabase.rpc('create_offline_friend', {
    nickname: nickname.value,
    ...(emoji ? { emoji } : {}),
    permission_confirmed: true,
  });
  if (error) return failFrom('create_offline_friend', error);
  refresh();
  return { ok: true, data: { id: data } };
}

/** Renames an offline friend and sets their emoji (null for none) (FR-SOC-18). */
export async function updateOfflineFriend(
  id: string,
  input: { nickname: string; emoji: string | null },
): Promise<ActionResult> {
  if (!isUuid(id)) return fail(NOT_FOUND);
  const nickname = cleanNickname(input.nickname);
  if (!nickname.ok) return fail(nickname.error);
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('update_offline_friend', {
    offline_friend_id: id,
    nickname: nickname.value,
    // An empty string clears it (`clean_group_emoji` turns it into null).
    emoji: cleanEmoji(input.emoji) ?? '',
  });
  if (error) return failFrom('update_offline_friend', error);
  refresh();
  return ok;
}

/**
 * Deletes an offline friend. Their schedule (sources and events) goes with them in the same
 * statement, so it's gone straight away (FR-SOC-18). Also how the viewer removes the offline
 * copy of someone who has since become a real friend (FR-SOC-19): never merged automatically.
 */
export async function deleteOfflineFriend(id: string): Promise<ActionResult> {
  if (!isUuid(id)) return fail(NOT_FOUND);
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('delete_offline_friend', { offline_friend_id: id });
  if (error) return failFrom('delete_offline_friend', error);
  refresh();
  return ok;
}
