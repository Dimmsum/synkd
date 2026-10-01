// Invite links (WF-045, FR-SOC-3, FR-WEB-3).

import { cache } from 'react';
import { cookies } from 'next/headers';
import type {
  FriendInvite as DbFriendInvite,
  FriendInvitePreview as DbFriendInvitePreview,
  FriendInviteSummary as DbFriendInviteSummary,
  InviteSummary as DbInviteSummary,
} from '@whosfree/backend';
import { appUrl } from '@/lib/config';
import { createServerSupabase } from '@/lib/supabase/server';
import { INVITE_COOKIE, isInviteCode } from '@/lib/social/invite-cookie';
import {
  toFriendInvitePreview,
  toFriendInviteSummary,
  toInviteSummary,
  toMyFriendInvite,
  type FriendInvitePreview,
  type FriendInviteSummary,
  type InviteSummary,
  type MyFriendInvite,
} from '@/lib/social/mappers';

export type { FriendInvitePreview, FriendInviteSummary, InviteSummary, MyFriendInvite };

/**
 * What a visitor may see about an invite (FR-WEB-3): the inviter's name, the group's name and
 * emoji, and the member count. Never anyone's schedule. `get_invite_summary` is granted to
 * signed-out visitors too, so this works on the public /i/[code] page. A revoked, expired or
 * used-up link says only that it doesn't work.
 *
 * TODO(NFR-SEC-9): the function can't rate-limit anonymous callers; limit /i/[code] per IP at
 * the edge (e.g. a Vercel WAF rate-limit rule). Codes are 128-bit, so guessing isn't practical.
 */
export const getInvite = cache(async (code: string): Promise<InviteSummary> => {
  if (!isInviteCode(code)) return toInviteSummary(code, undefined);
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('get_invite_summary', { code });
  if (error) throw new Error(`get_invite_summary failed (${error.code})`);
  return toInviteSummary(code, (data as DbInviteSummary[])[0]);
});

/** The invite remembered through sign-up and onboarding (see lib/social/invite-cookie.ts). */
export async function getRememberedInviteCode(): Promise<string | null> {
  const value = (await cookies()).get(INVITE_COOKIE)?.value;
  return isInviteCode(value) ? value : null;
}

/**
 * What the public invite page may show about a friend invite link (WF-042, FR-WEB-3): whether it
 * works and the inviter's name. Callable signed out, like `getInvite`; a signed-in visitor
 * blocked either way gets "not found", the same as for a code that doesn't exist.
 */
export const getFriendInvite = cache(async (code: string): Promise<FriendInviteSummary> => {
  if (!isInviteCode(code)) return toFriendInviteSummary(code, undefined);
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('get_friend_invite_summary', { code });
  if (error) throw new Error(`get_friend_invite_summary failed (${error.code})`);
  return toFriendInviteSummary(code, (data as DbFriendInviteSummary[])[0]);
});

/** A code that opens /i/<code>: a group invite, or else a friend invite link (WF-042). */
export type AnyInvite =
  { kind: 'group'; invite: InviteSummary } | { kind: 'friend'; invite: FriendInviteSummary };

/** Looks the code up as a group invite first, then as a friend link. */
export const getAnyInvite = cache(async (code: string): Promise<AnyInvite> => {
  const group = await getInvite(code);
  if (group.state !== 'invalid' || group.reason !== 'not_found') {
    return { kind: 'group', invite: group };
  }
  const friend = await getFriendInvite(code);
  if (friend.state === 'invalid' && friend.reason === 'not_found') {
    return { kind: 'group', invite: group };
  }
  return { kind: 'friend', invite: friend };
});

/**
 * Who a friend invite link adds, for the signed-in viewer (`preview_friend_invite`): the
 * inviter's public profile and relationship. "not_found" across a block, either way.
 */
export const previewFriendInvite = cache(async (code: string): Promise<FriendInvitePreview> => {
  if (!isInviteCode(code)) return toFriendInvitePreview(code, undefined);
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('preview_friend_invite', { code });
  if (error) throw new Error(`preview_friend_invite failed (${error.code})`);
  return toFriendInvitePreview(code, (data as DbFriendInvitePreview[])[0]);
});

/** The viewer's own friend invite link, or null when they haven't made one (or turned it off). */
export const getMyFriendInvite = cache(async (): Promise<MyFriendInvite | null> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('get_my_friend_invite');
  if (error) throw new Error(`get_my_friend_invite failed (${error.code})`);
  const row = (data as DbFriendInvite[])[0];
  return row ? toMyFriendInvite(row, appUrl()) : null;
});
