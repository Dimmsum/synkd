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
