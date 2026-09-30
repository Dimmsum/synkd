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
