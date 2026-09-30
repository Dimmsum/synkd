// @whosfree/backend: the Supabase project (supabase/: config and migrations)
// and the TypeScript types generated from its schema.
//
// Use `Database` to type a Supabase client, e.g.
//   createClient<Database>(url, key, { accessToken: () => clerk.session.getToken() })
import type { Database } from './database.types';

export type {
  CompositeTypes,
  Database,
  Enums,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from './database.types';

type EventsForViewerRow = Database['public']['Functions']['events_for_viewer']['Returns'][number];

/**
 * One row of `events_for_viewer` (WF-041), already redacted to the viewer's tier.
 * The CLI types function results as non-null, but `category` is null below T2
 * (and for private events), `title` is null below T3, and `rrule` is null for
 * one-off events.
 */
export type ViewerEvent = Omit<EventsForViewerRow, 'category' | 'title' | 'rrule'> & {
  category: string | null;
  title: string | null;
  rrule: string | null;
};

type AccountStatusRow = Database['public']['Functions']['account_status']['Returns'][number];

/**
 * The single row of `account_status()` (WF-004/005/015). The CLI types function results as
 * non-null, but `consent_version` is null until the user first accepts.
 */
export type AccountStatus = Omit<AccountStatusRow, 'consent_version'> & {
  consent_version: string | null;
};

/** How another user relates to the caller (`get_profile`, `find_user_by_handle`). */
export type Relationship = 'self' | 'friend' | 'request_sent' | 'request_received' | 'none';

type ProfileRow = Database['public']['Functions']['get_profile']['Returns'][number];

/**
 * Another user's public profile (WF-040), from `get_profile` or
 * `find_user_by_handle`. Nothing is returned for a user who has blocked the
 * caller or whom the caller blocked. `handle` and `avatar_url` are optional.
 * (Clear your own handle with `set_handle({ handle: null })`; the generated
 * Args type says `string`, but null is accepted.)
 */
export type PublicProfile = Omit<ProfileRow, 'handle' | 'avatar_url' | 'relationship'> & {
  handle: string | null;
  avatar_url: string | null;
  relationship: Relationship;
};

type FriendRequestRow = Database['public']['Functions']['list_friend_requests']['Returns'][number];

/**
 * One row of `list_friend_requests` (WF-042). `tier` is the tier the caller
 * chose for an outgoing request, and null for an incoming one.
 */
export type FriendRequest = Omit<
  FriendRequestRow,
  'handle' | 'avatar_url' | 'direction' | 'tier'
> & {
  handle: string | null;
  avatar_url: string | null;
  direction: 'incoming' | 'outgoing';
  tier: 1 | 2 | 3 | null;
};

type FriendRow = Database['public']['Functions']['list_friends']['Returns'][number];

/**
 * One row of `list_friends` (WF-042): a friend and the tier the caller grants
 * them. Friendships made through accept_friend_request always have a tier;
 * null would mean no individual rule (resolve_tier then falls back to shared
 * groups, else T1).
 */
export type Friend = Omit<FriendRow, 'handle' | 'avatar_url' | 'tier'> & {
  handle: string | null;
  avatar_url: string | null;
  tier: 1 | 2 | 3 | null;
};

/** What `send_friend_request*` returns: a new request, or a friendship if they had already asked. */
export type SendFriendRequestResult = 'pending' | 'accepted';

type BlockedUserRow = Database['public']['Functions']['list_blocked_users']['Returns'][number];

/** One row of `list_blocked_users` (WF-047): someone the caller has blocked. */
export type BlockedUser = Omit<BlockedUserRow, 'handle' | 'avatar_url'> & {
  handle: string | null;
  avatar_url: string | null;
};

export { DB_ERROR } from './errors';
export type { DbErrorCode } from './errors';

type Fn = Database['public']['Functions'];

/**
 * One row of `list_my_groups` (WF-043). `emoji` is null when the group has none. The
 * permissions are effective ones (all true for the admin), and `member_count` leaves out
 * people blocked either way, matching `get_group_members`.
 */
export type MyGroup = Omit<
  Fn['list_my_groups']['Returns'][number],
  'emoji' | 'role' | 'my_tier'
> & {
  emoji: string | null;
  role: 'admin' | 'member';
  my_tier: 1 | 2 | 3;
};

/** One row of `get_group_members` (WF-043): a member's public profile, role and effective permissions. */
export type GroupMember = Omit<
  Fn['get_group_members']['Returns'][number],
  'handle' | 'avatar_url' | 'role'
> & {
  handle: string | null;
  avatar_url: string | null;
  role: 'admin' | 'member';
};

/**
 * An invite link as returned by `create_group_invite`, `regenerate_group_invite` and
 * `list_group_invites` (WF-045). The CLI types composite fields as nullable; only the
 * limits really are.
 */
export interface GroupInvite {
  id: string;
  code: string;
  expires_at: string | null;
  max_uses: number | null;
  uses: number;
  created_at: string;
  created_by_me: boolean;
}

/** `get_invite_summary` statuses (WF-045). No row at all means the code was not found. */
export type InviteStatus = 'valid' | 'full' | 'expired' | 'used_up' | 'revoked';

/**
 * The row `get_invite_summary` returns for /i/[code]. The details are only filled in while
 * the link works (`valid` or `full`); a revoked, expired or used-up link reports its status only.
 */
export type InviteSummary =
  | {
      status: 'valid' | 'full';
      inviter_name: string;
      group_name: string;
      group_emoji: string | null;
      member_count: number;
    }
  | {
      status: 'expired' | 'used_up' | 'revoked';
      inviter_name: null;
      group_name: null;
      group_emoji: null;
      member_count: null;
    };

/**
 * The messages the group and invite functions raise (WF-043/044/045/047), so clients can
 * tell errors apart (e.g. show "This group is full"). Match on `error.message`.
 * SQLSTATEs: WF001 no account for this sign-in and PT429 rate limited (see `DB_ERROR`),
 * 42501 not allowed, P0002 not found, 22023 bad argument, P0001 a group rule, 0A000 not
 * supported. For "already a member", `error.details` is the group id.
 */
export const GROUP_ERRORS = {
  noAccount: 'No account for this sign-in',
  notAllowed: 'Not allowed',
  groupNotFound: 'Group not found',
  memberNotFound: 'Member not found',
  inviteNotFound: 'Invite not found',
  invalidName: 'Group name must be 1 to 60 characters',
  invalidEmoji: 'Emoji must be at most 16 characters',
  invalidTier: 'tier must be 1, 2 or 3',
  invalidExpiry: 'Invite expiry must be in the future',
  invalidMaxUses: 'Invite max uses must be between 1 and 1000',
  transferToSelf: 'Choose another member to become admin',
  mustTransferAdmin: 'Transfer the admin role before leaving the group',
  adminNotRemovable: "The admin can't be removed from the group",
  adminHasAllPermissions: 'The admin always holds every permission',
  useLeaveGroup: 'Use leave_group to leave a group',
  alreadyMember: 'You are already a member of this group',
  inviteRevoked: 'This invite has been revoked',
  inviteExpired: 'This invite has expired',
  inviteUsedUp: 'This invite has reached its maximum number of uses',
  groupFull: 'This group is full',
  approvalNotSupported: 'Joining groups that need approval is not supported yet',
  rateLimited: 'Too many attempts',
} as const;

type OfflineFriendRow = Fn['list_offline_friends']['Returns'][number];

/**
 * One row of `list_offline_friends` (WF-127): someone not on whosfree whom the caller added
 * (D44). Only ever the caller's own. `has_schedule` is false until a schedule is confirmed for
 * them. Their events are read directly under RLS: `events` where `offline_friend_id` is the id.
 */
export type OfflineFriend = Omit<OfflineFriendRow, 'emoji'> & { emoji: string | null };

/**
 * The messages the offline friend functions raise (WF-127), so clients can tell errors apart.
 * Match on `error.message`. SQLSTATEs: WF001 no account and PT429 rate limited (see
 * `DB_ERROR`), 22023 bad argument (nickname, emoji, missing permission tick), P0001 limit
 * reached (MAX_OFFLINE_FRIENDS), P0002 not found (also another user's offline friend).
 */
export const OFFLINE_FRIEND_ERRORS = {
  noAccount: 'No account for this sign-in',
  notFound: 'Offline friend not found',
  invalidNickname: 'Nickname must be 1 to 40 characters',
  nicknameControlCharacters: 'Nickname must not contain control characters',
  invalidEmoji: 'Emoji must be at most 16 characters',
  permissionRequired: 'Confirm you have their permission to add their schedule',
  limitReached: 'You have reached the limit of offline friends',
  rateLimited: 'Too many attempts',
} as const;
