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

export { DB_ERROR } from './errors';
export type { DbErrorCode } from './errors';
