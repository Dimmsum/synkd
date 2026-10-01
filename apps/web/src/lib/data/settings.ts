// Settings reads (WF-015, WF-040, WF-062). Own rows only: RLS lets the signed-in user read just
// their own `users` and `availability_prefs` rows (D41), so these read the tables directly.

import { redirect } from 'next/navigation';
import { auth, currentUser } from '@clerk/nextjs/server';
import { DEFAULT_TIER, type Tier } from '@whosfree/shared';
import type { AvailableHoursDay, Iso, VisibilityRow } from '@/lib/types';
import { weeklyToDays } from '@/lib/available-hours';
import { hueFor } from '@/lib/hue';
import { createServerSupabase } from '@/lib/supabase/server';
import { PEOPLE } from '@/lib/mock/data';
import { groupsOf, toGroupSummary, toPerson, viewerGroups } from '@/lib/mock/selectors';

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
 * "Who can see me" (FR-VIS-8, WF-048): every friend and group with the tier that
 * actually applies. A tier set on a friend wins; otherwise the most restrictive shared
 * group applies, and we say which group lowered it (FR-VIS-3, FR-VIS-3a).
 * TODO(WF-048): the server resolves this with `resolve_tier` so it can't drift.
 */
export async function getVisibilityOverview(): Promise<{
  friends: VisibilityRow[];
  groups: VisibilityRow[];
  members: VisibilityRow[];
}> {
  const resolve = (
    id: string,
    own: Tier | null,
  ): Pick<VisibilityRow, 'tier' | 'effectiveTier' | 'loweredBy'> => {
    if (own !== null) return { tier: own, effectiveTier: own };
    const lowest = [...groupsOf(id)].sort((a, b) => a.viewerTier - b.viewerTier)[0];
    if (!lowest) return { tier: null, effectiveTier: DEFAULT_TIER };
    const others = groupsOf(id).filter((g) => g.id !== lowest.id);
    const lowered = others.some((g) => g.viewerTier > lowest.viewerTier);
    return {
      tier: null,
      effectiveTier: lowest.viewerTier,
      loweredBy: lowered ? toGroupSummary(lowest) : undefined,
    };
  };

  const inMyGroups = new Set(viewerGroups().flatMap((g) => g.memberIds));
  return {
    friends: PEOPLE.filter((p) => p.isFriend).map((p) => ({
      target: { type: 'friend', person: toPerson(p) },
      ...resolve(p.id, p.viewerTier),
    })),
    groups: viewerGroups().map((g) => ({
      target: { type: 'group', group: toGroupSummary(g) },
      tier: g.viewerTier,
      effectiveTier: g.viewerTier,
    })),
    members: PEOPLE.filter((p) => !p.isFriend && inMyGroups.has(p.id)).map((p) => ({
      target: { type: 'friend', person: toPerson(p) },
      ...resolve(p.id, null),
    })),
  };
}

/** TODO(FR-SET-3, WF-094): notification preferences. */
export async function getNotificationSettings() {
  return {
    types: { pings: true, friendRequests: true, groupInvites: true, scheduleReminders: true },
    quietHours: { enabled: true, start: '23:00', end: '07:00' },
    // Whether push is on is per device, so the browser works it out (WF-091, PushPermission).
  };
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
 * `avatarUrl` is the photo taken from the sign-in provider at sign-up, or null; people who sign
 * in with email and password (D45) start without one. `photoFromGoogle` says whether it came
 * from a linked Google account.
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
