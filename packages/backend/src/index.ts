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
 * SQLSTATEs: 42501 not signed in / not allowed, P0002 not found, 22023 bad argument,
 * P0001 a group rule, 0A000 not supported. For "already a member", `error.details` is the
 * group id.
 */
export const GROUP_ERRORS = {
  notSignedIn: 'Not signed in',
  notAllowed: 'Not allowed',
  groupNotFound: 'Group not found',
  memberNotFound: 'Member not found',
  inviteNotFound: 'Invite not found',
  invalidName: 'Group name must be 1 to 60 characters',
  invalidEmoji: 'Emoji must be at most 16 characters',
  invalidTier: 'Tier must be 1, 2 or 3',
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
} as const;
