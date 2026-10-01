// Rows from the social database functions (WF-040 to WF-047) → the view models in lib/types.
// Pure, so every mapping is unit-tested. The rows are already filtered by the database: people
// blocked either way never appear (FR-SOC-6, D43), and nothing here widens what a row says.

import type {
  Friend as DbFriend,
  FriendRequest as DbFriendRequest,
  GroupInvite as DbGroupInvite,
  GroupMember as DbGroupMember,
  InviteSummary as DbInviteSummary,
  MyGroup,
  PublicProfile,
} from '@whosfree/backend';
import type { GroupPermissions, Tier } from '@whosfree/shared';
import { hueFor } from '@/lib/hue';
import type {
  Connection,
  FriendRequest,
  GroupInvite,
  GroupMember,
  GroupSummary,
  Person,
  PublicPerson,
} from '@/lib/types';

/** Shown for a group without an emoji (the column is optional, FR-SOC-2). */
export const DEFAULT_GROUP_EMOJI = '👥';

export function toPerson(row: { id: string; name: string; handle: string | null }): Person {
  return { id: row.id, name: row.name, handle: row.handle ?? '', hue: hueFor(row.id) };
}

export function toPublicPerson(row: PublicProfile): PublicPerson {
  return { ...toPerson(row), relationship: row.relationship };
}

/**
 * Status fields of a Connection the Now data has no row for (WF-064), e.g. when it couldn't be
 * read: they read as "No schedule yet", the same as someone who hasn't added one.
 */
export const PENDING_PRESENCE = {
  status: 'no_schedule',
  until: null,
  nextFreeAt: null,
  stale: false,
} as const satisfies Pick<Connection, 'status' | 'until' | 'nextFreeAt' | 'stale'>;

/**
 * The tier a connection shows the viewer before the resolved one is known. Every active
 * connection shows at least T1 (FR-VIS-1); `withPresence` puts in the tier `now_for_viewer`
 * resolved (FR-VIS-3).
 */
export const MIN_VISIBLE_TIER: Tier = 1;

export function toConnection(
  person: Person,
  opts: { isFriend: boolean; groupIds: string[] },
): Connection {
  return { ...person, ...PENDING_PRESENCE, tier: MIN_VISIBLE_TIER, ...opts };
}

/**
 * `c` with the status, "until X" and resolved tier from the Now data for the same person
 * (`now_for_viewer`, WF-064). Who they are, whether they're a friend and which groups they're
 * listed under stay as `c` says. Unchanged when there's no Now row for them.
 */
export function withPresence<C extends Connection>(c: C, now: Connection | undefined): C {
  if (!now || now.id !== c.id) return c;
  const next: C = {
    ...c,
    tier: now.tier,
    status: now.status,
    until: now.until,
    nextFreeAt: now.nextFreeAt,
    stale: now.stale,
    upcoming: now.upcoming ?? [],
    refreshAt: now.refreshAt ?? null,
  };
  if (now.activity) next.activity = now.activity;
  else delete next.activity;
  return next;
}

export function friendToPerson(row: DbFriend): Person {
  return toPerson({ id: row.user_id, name: row.name, handle: row.handle });
}

export function toFriendRequest(row: DbFriendRequest): FriendRequest {
  return {
    id: row.user_id,
    person: toPerson({ id: row.user_id, name: row.name, handle: row.handle }),
    direction: row.direction,
    sentAt: row.requested_at,
  };
}

/** Effective permissions (the database already reports all true for the admin, FR-SOC-9). */
export function toPermissions(row: {
  can_invite: boolean;
  can_manage_members: boolean;
  can_edit_group: boolean;
  can_group_ping: boolean;
}): GroupPermissions {
  return {
    invite: row.can_invite,
    manageMembers: row.can_manage_members,
    editGroup: row.can_edit_group,
    groupPing: row.can_group_ping,
  };
}

export function toGroupSummary(row: MyGroup): GroupSummary {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji ?? DEFAULT_GROUP_EMOJI,
    memberCount: row.member_count,
    // Filled in from the Now data where it's shown (lib/data/people.ts, freeNowByGroup).
    freeNowCount: 0,
    viewerRole: row.role,
  };
}

export function toGroupMember(
  row: DbGroupMember,
  opts: { isFriend: boolean; groupIds: string[] },
): GroupMember {
  const person = toPerson({ id: row.user_id, name: row.name, handle: row.handle });
  return {
    ...toConnection(person, opts),
    role: row.role,
    permissions: toPermissions(row),
    isViewer: row.is_me,
  };
}

/** `/i/<code>` on the app's own origin (FR-WEB-3). */
export function inviteUrl(code: string, appUrl: string): string {
  return new URL(`/i/${encodeURIComponent(code)}`, appUrl).toString();
}

/** The viewer's friend link, `/add/<id>`, which their QR code encodes (FR-SOC-1, WF-042). */
export function friendLinkUrl(userId: string, appUrl: string): string {
  return new URL(`/add/${encodeURIComponent(userId)}`, appUrl).toString();
}

export function toGroupInvite(row: DbGroupInvite, appUrl: string): GroupInvite {
  return {
    id: row.id,
    code: row.code,
    url: inviteUrl(row.code, appUrl),
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    uses: row.uses,
    createdByMe: row.created_by_me,
  };
}

/**
 * The link to show in group settings: the viewer's own newest one if they have one (so they
 * can manage it), otherwise the group's newest. `rows` come newest first.
 */
export function pickInvite(rows: DbGroupInvite[]): DbGroupInvite | null {
  return rows.find((r) => r.created_by_me) ?? rows[0] ?? null;
}

/** Among the groups two people share, the one whose tier applies: the most restrictive (FR-VIS-3). */
export function mostRestrictiveGroup(
  groups: Pick<MyGroup, 'name' | 'my_tier'>[],
): { tier: Tier; groupName: string } | null {
  let best: { tier: Tier; groupName: string } | null = null;
  for (const g of groups) {
    if (!best || g.my_tier < best.tier) best = { tier: g.my_tier, groupName: g.name };
  }
  return best;
}

/** user id → ids of the viewer's groups they're in, from each group's member list. */
export function groupsByMember(
  memberLists: { groupId: string; memberIds: string[] }[],
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const { groupId, memberIds } of memberLists) {
    for (const id of memberIds) index.set(id, [...(index.get(id) ?? []), groupId]);
  }
  return index;
}

/** What the invite page may show (FR-WEB-3): never ids, handles, avatars or schedules. */
export type InviteSummary =
  | {
      state: 'ok' | 'full';
      code: string;
      inviterName: string;
      groupName: string;
      emoji: string;
      memberCount: number;
    }
  | { state: 'invalid'; code: string; reason: 'not_found' | 'expired' | 'used_up' | 'revoked' };

/** `get_invite_summary`'s row (none for an unknown code) → the invite page's model. */
export function toInviteSummary(code: string, row: DbInviteSummary | undefined): InviteSummary {
  if (!row) return { state: 'invalid', code, reason: 'not_found' };
  if (row.status === 'valid' || row.status === 'full') {
    return {
      state: row.status === 'valid' ? 'ok' : 'full',
      code,
      inviterName: row.inviter_name,
      groupName: row.group_name,
      emoji: row.group_emoji ?? DEFAULT_GROUP_EMOJI,
      memberCount: row.member_count,
    };
  }
  return { state: 'invalid', code, reason: row.status };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a well-formed uuid, so a mangled URL is a 404 rather than a database error. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
