// Supabase in the browser, acting as the signed-in user (D40, D41, WF-064).
//
// Only for Realtime "changed" signals today (FR-VIEW-3): the browser joins the viewer's private
// Broadcast channel and, on a signal, re-fetches through the server, which reads the redacting
// database functions. Data reads and writes stay on the server (lib/supabase/server.ts).
//
// It uses the publishable key only (NEXT_PUBLIC_*), never the secret key, and sends the user's
// Clerk session token (third-party auth) so Realtime's authorization (RLS on
// realtime.messages) applies to that user. `getToken` is called for every request and again on
// every Realtime heartbeat, so a refreshed Clerk token is picked up without reconnecting.
//
// Usage (Client Components):
//   const { session } = useSession();
//   const supabase = createBrowserSupabase(() => session?.getToken() ?? Promise.resolve(null));
//   const channel = supabase.channel(userChannel(viewerId), { config: { private: true } });
// Create one per subscription and call `supabase.removeChannel(channel)` when done.

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@synkd/backend';

export type BrowserSupabase = SupabaseClient<Database>;

/**
 * A browser client that sends whatever `getToken` returns (null = signed out, and the database
 * refuses everything). Throws if the public Supabase settings are missing.
 */
export function createBrowserSupabase(getToken: () => Promise<string | null>): BrowserSupabase {
  // Written out in full so Next inlines them into the client bundle.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Supabase public settings are not set (see .env.example)');
  return createClient<Database>(url, key, { accessToken: getToken });
}
