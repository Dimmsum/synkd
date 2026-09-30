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
 * The messages the group and invite functions raise (WF-043/044/045/047), so clients can
 * tell errors apart (e.g. show "This group is full"). Match on `error.message`.
 * SQLSTATEs: 42501 not signed in / not allowed, P0002 not found, 22023 bad argument,
 * P0001 a group rule, 0A000 not supported.
 */
export const GROUP_ERRORS = {
  notSignedIn: 'Not signed in',
  notAllowed: 'Not allowed',
  groupNotFound: 'Group not found',
  memberNotFound: 'Member not found',
  invalidName: 'Group name must be 1 to 60 characters',
  invalidEmoji: 'Emoji must be at most 16 characters',
  invalidTier: 'Tier must be 1, 2 or 3',
  transferToSelf: 'Choose another member to become admin',
} as const;
