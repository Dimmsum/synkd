// Supabase on the Next.js server, acting as the signed-in user (D40, D41, WF-004).
//
// Every request goes to Supabase with the user's Clerk session token (third-party auth), so
// Postgres applies RLS and the tier-redacting functions to that user: RLS keys on
// `auth.jwt()->>'sub'`. Without a session the publishable key alone is sent and the database
// refuses everything. There is deliberately no secret-key (service role) client here: that is
// for background work only (webhooks, cron, worker callbacks) and belongs next to that code.
//
// Usage (Server Components, Server Actions, Route Handlers):
//   const supabase = await createServerSupabase();
//   const { data, error } = await supabase.rpc('list_friends');
// In proxy.ts, pass the token getter from `clerkMiddleware`'s `auth()`:
//   supabaseWithToken(getToken)

import 'server-only';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@synkd/backend';

export type ServerSupabase = SupabaseClient<Database>;

function requireEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  return value;
}

/** A client that sends whatever token `getToken` returns (null = signed out). */
export function supabaseWithToken(getToken: () => Promise<string | null>): ServerSupabase {
  // Written out in full so Next inlines them (NEXT_PUBLIC_*), including in proxy.ts.
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = requireEnv(
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  return createClient<Database>(url, key, { accessToken: getToken });
}

/**
 * Supabase as the user signed in to the current request (Clerk's `auth()`). Create one per
 * request; don't share it. `auth()` is awaited here, not inside the client's token callback,
 * because supabase-js swallows errors thrown there, including Next's signal that the page
 * must render dynamically.
 */
export async function createServerSupabase(): Promise<ServerSupabase> {
  const { getToken } = await auth();
  return supabaseWithToken(() => getToken());
}
