// A minimal browser Supabase client for the inbox's Realtime subscription (WF-092).
// TODO(merge): unify with the shared browser client under lib/supabase/ that the Now screen
// wiring adds; this one exists only because that helper isn't on this branch yet.
//
// It sends the user's Clerk session token (third-party auth, D40), so Realtime checks the
// private-channel policy as that user: they can receive on `user:<their id>` only, and can't
// send (20261002400100_now_realtime_signals.sql). Used for "changed" signals only; data is
// always re-fetched on the server through the redacting functions (D41).

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@whosfree/backend';

/** A client that authenticates with `getToken`, or null when Supabase isn't configured. */
export function createBrowserSupabase(
  getToken: () => Promise<string | null>,
): SupabaseClient<Database> | null {
  // Written out in full so Next inlines them into the client bundle.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key, { accessToken: getToken });
}
