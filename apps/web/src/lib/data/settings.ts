import { DAYS_OF_WEEK, DEFAULT_AVAILABLE_HOURS, DEFAULT_TIER, type Tier } from '@whosfree/shared';
import type { AvailableHoursDay, VisibilityRow } from '@/lib/types';
import { LEGAL_VERSIONS } from '@/lib/config';
import { PEOPLE, VIEWER } from '@/lib/mock/data';
import { groupsOf, minutesAgo, toGroupSummary, toPerson, viewerGroups } from '@/lib/mock/selectors';

/** TODO(WF-062): read availabilityPrefs.weekly. Missing days = switched off (Away). */
export async function getAvailableHours(): Promise<AvailableHoursDay[]> {
  return DAYS_OF_WEEK.map((day) => ({
    day,
    enabled: true,
    start: day === 'sat' || day === 'sun' ? '10:00' : DEFAULT_AVAILABLE_HOURS.start,
    end: day === 'fri' || day === 'sat' ? '23:30' : DEFAULT_AVAILABLE_HOURS.end,
  }));
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
    pushEnabled: false,
  };
}

/** TODO(WF-040, WF-050): the users row. */
export async function getProfile() {
  return {
    ...toPerson(VIEWER),
    email: 'kemar.brown@example.com',
    timeZone: 'America/Jamaica',
    sharingPaused: false,
  };
}

/** TODO(WF-015): the consent record from the users row. */
export async function getConsentRecord() {
  return {
    termsVersion: LEGAL_VERSIONS.terms,
    privacyVersion: LEGAL_VERSIONS.privacy,
    acceptedAt: minutesAgo(60 * 24 * 12),
  };
}
