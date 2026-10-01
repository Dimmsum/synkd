// The inbox (WF-092, WF-093, FR-PING-3) as the signed-in user. Pings are read only through
// `list_inbox`, which returns the viewer's own pings with the other person's public profile and
// leaves out anyone blocked either way (FR-SOC-6, D41). The page re-fetches when the viewer's
// Realtime channel says `inbox_changed` (components/inbox/inbox-live.tsx).
//
// Only error codes are logged, never ping text or names (NFR-SEC-11).

import 'server-only';
import { cache } from 'react';
import type { InboxPing } from '@whosfree/backend';
import { createServerSupabase } from '@/lib/supabase/server';
import { splitInbox } from '@/lib/pings/mappers';
import type { Ping } from '@/lib/types';

/** Received and sent pings from the last 30 days, newest first (WF-092, FR-PING-3). */
export const getInbox = cache(async (): Promise<{ received: Ping[]; sent: Ping[] }> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('list_inbox');
  if (error) throw new Error(`list_inbox failed (${error.code ?? 'no code'})`);
  return splitInbox(data as InboxPing[]);
});

/**
 * The inbox badge: unread pings plus unread replies to the viewer's pings. Never fails the
 * page it's on (the app layout): on an error it logs the code and shows no badge.
 */
export const getUnreadCount = cache(async (): Promise<number> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('unread_ping_count');
  if (error) {
    console.error('unread_ping_count failed', error.code ?? 'no code');
    return 0;
  }
  return data;
});

/**
 * The viewer's users.id, which names their private Realtime channel (`user:<id>`), or null
 * without an account.
 */
export const getViewerUserId = cache(async (): Promise<string | null> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('current_user_id');
  if (error) {
    console.error('current_user_id failed', error.code ?? 'no code');
    return null;
  }
  return data ?? null;
});
