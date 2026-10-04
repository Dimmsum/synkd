// Settings reads (WF-015, WF-040, WF-048, WF-062). Own rows read the tables directly: RLS lets
// the signed-in user read just their own `users` and `availability_prefs` rows (D41). "Who can
// see me" reads the social database functions (lib/data/social.ts).

import { redirect } from 'next/navigation';
import { auth, currentUser } from '@clerk/nextjs/server';
import type { AvailableHoursDay, Iso } from '@/lib/types';
import { weeklyToDays } from '@/lib/available-hours';
import { isStoredAvatarUrl } from '@/lib/avatars/paths';
import { hueFor } from '@/lib/hue';
import { createServerSupabase } from '@/lib/supabase/server';
import { listFriends, listGroupMembers, listMyGroups } from '@/lib/data/social';
import { toVisibilityOverview, type VisibilityOverview } from '@/lib/social/visibility';

/**
 * The signed-in user's available hours, one row per day (FR-AVL-2, WF-062). A day missing from
 * `availability_prefs.weekly` is switched off, which the engine shows as Away all day. Every user
 * gets a prefs row (08:00–22:00 every day, D24) when their users row is created.
 */
export async function getAvailableHours(): Promise<AvailableHoursDay[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from('availability_prefs').select('weekly').maybeSingle();
  if (error) throw new Error(`Reading available hours failed (${error.code})`);
  // proxy.ts creates the users row (and with it this one) first, so a missing row is a setup
  // problem, not a user one.
  if (!data) throw new Error('No availability_prefs row for this sign-in');
  return weeklyToDays(data.weekly);
}

/**
 * "Who can see me" (FR-VIS-8, WF-048): every friend, group and fellow group member with the
 * tier that actually applies, from the viewer's own friends, groups and group members
 * (lib/social/visibility.ts).
 */
export async function getVisibilityOverview(): Promise<VisibilityOverview> {
  const [friends, groups] = await Promise.all([listFriends(), listMyGroups()]);
  const memberLists = await Promise.all(
    groups.map(async (g) => ({ groupId: g.id, members: (await listGroupMembers(g.id)) ?? [] })),
  );
  return toVisibilityOverview(friends, groups, memberLists);
}

/** The signed-in user's own users row (RLS allows only that one), with the fields settings show. */
async function readOwnUser() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('users')
    .select('id, name, handle, avatar_url, timezone, sharing_paused, consent_version, consent_at')
    .eq('clerk_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Reading the profile failed (${error.code})`);
  if (!data) throw new Error('No users row for this sign-in');
  return data;
}

/**
 * The profile settings page (FR-AUTH-2, WF-040): the users row plus the sign-in email, which
 * only Clerk has. `handle` is '' when the user hasn't chosen one (handles are optional).
 * `avatarUrl` is the photo taken from the sign-in provider at sign-up, one the user uploaded
 * (WF-040), or null; people who sign in with email and password (D45) start without one.
 * `photoFromGoogle` says whether it is still the one from a linked Google account.
 */
export async function getProfile() {
  const [row, clerkUser] = await Promise.all([readOwnUser(), currentUser()]);
  return {
    id: row.id,
    name: row.name,
    handle: row.handle ?? '',
    hue: hueFor(row.id),
    avatarUrl: row.avatar_url,
    photoFromGoogle:
      row.avatar_url !== null &&
      !isStoredAvatarUrl(row.avatar_url, process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      (clerkUser?.externalAccounts.some((a) => a.provider.includes('google')) ?? false),
    email: clerkUser?.primaryEmailAddress?.emailAddress ?? null,
    timeZone: row.timezone,
    // TODO(WF-050): pause sharing is still a stub (setSharingPaused).
    sharingPaused: row.sharing_paused,
  };
}

/**
 * The consent record (FR-SET-5, WF-015): the terms/privacy version the user accepted and when.
 * Both documents share one version (`users.consent_version`). Null before the first acceptance,
 * which proxy.ts doesn't let reach the app; a stale version is sent back to /sign-up/terms.
 */
export async function getConsentRecord(): Promise<{
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: Iso;
} | null> {
  const row = await readOwnUser();
  if (!row.consent_version || !row.consent_at) return null;
  return {
    termsVersion: row.consent_version,
    privacyVersion: row.consent_version,
    acceptedAt: row.consent_at,
  };
}
