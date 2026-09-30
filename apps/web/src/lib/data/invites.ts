// Invite links (WF-045, FR-SOC-3, FR-WEB-3).

import { cache } from 'react';
import { cookies } from 'next/headers';
import type { InviteSummary as DbInviteSummary } from '@whosfree/backend';
import { createServerSupabase } from '@/lib/supabase/server';
import { INVITE_COOKIE, isInviteCode } from '@/lib/social/invite-cookie';
import { toInviteSummary, type InviteSummary } from '@/lib/social/mappers';

export type { InviteSummary };

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
