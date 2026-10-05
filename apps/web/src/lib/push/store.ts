// Where the push module reads and prunes a recipient's devices (WF-091, D41).
//
// This is the web app's only secret-key (service role) Supabase client, and it is deliberately
// narrow: it can list one user's push subscriptions, delete subscriptions the push service
// reported as gone, and record a delivery. Nothing else. It is not exported beyond lib/push
// and never used to act on a user's behalf; user requests go through createServerSupabase()
// and RLS. Why a secret key at all: a notification goes to *another* user (a ping's
// recipient), whose subscriptions RLS rightly hides from the sender, and scheduled
// notifications (WF-115 reminders) have no user session. See lib/push/send.ts for the rule on
// who may be notified.

import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@synkd/backend';

/** A device to deliver to: only what `web-push` needs, plus the row id for bookkeeping. */
export interface StoredPushSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushStore {
  /** The user's devices (at most MAX_PUSH_SUBSCRIPTIONS). */
  listForUser(userId: string): Promise<StoredPushSubscription[]>;
  /** Deletes subscriptions the push service says no longer exist (HTTP 404/410). */
  removeGone(ids: string[]): Promise<void>;
  /** Records a successful delivery (`last_used_at`), which keeps a device from being evicted. */
  markUsed(ids: string[]): Promise<void>;
}

type Env = Record<string, string | undefined>;

/** Wraps a service-role client. Exported for tests; use createPushStore(). */
export function pushStoreFrom(client: SupabaseClient<Database>): PushStore {
  const table = () => client.from('push_subscriptions');
  return {
    async listForUser(userId) {
      const { data, error } = await table()
        .select('id, endpoint, p256dh, auth')
        .eq('user_id', userId);
      if (error) throw new Error(`push_subscriptions read failed (${error.code})`);
      return data;
    },
    async removeGone(ids) {
      if (ids.length === 0) return;
      const { error } = await table().delete().in('id', ids);
      if (error) throw new Error(`push_subscriptions delete failed (${error.code})`);
    },
    async markUsed(ids) {
      if (ids.length === 0) return;
      const { error } = await table()
        .update({ last_used_at: new Date().toISOString() })
        .in('id', ids);
      if (error) throw new Error(`push_subscriptions update failed (${error.code})`);
    },
  };
}

/**
 * The store, or null (with the reason) when the Supabase URL or secret key isn't set. The
 * reason names the variable only, never a value.
 */
export function createPushStore(
  env: Env = process.env,
): { ok: true; store: PushStore } | { ok: false; problems: string[] } {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = env.SUPABASE_SECRET_KEY;
  const problems: string[] = [];
  if (!url) problems.push('NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!secretKey) problems.push('SUPABASE_SECRET_KEY is not set');
  if (!url || !secretKey) return { ok: false, problems };
  const client = createClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { ok: true, store: pushStoreFrom(client) };
}
