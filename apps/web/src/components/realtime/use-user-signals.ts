'use client';

// Realtime "changed" signals on the viewer's private channel (D41, FR-VIEW-3, WF-064, WF-092).
// The database sends an empty Broadcast (`now_changed`, `inbox_changed`, ...) on `user:<users.id>`
// when something the viewer sees changes; the client then re-renders the route from the server,
// which reads the redacting database functions again. No data travels over Realtime.

import { startTransition, useEffect, useEffectEvent, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@clerk/nextjs';
import { userChannel } from '@whosfree/shared';
import { debounce } from '@/lib/presence/debounce';
import { createBrowserSupabase } from '@/lib/supabase/browser';

/**
 * Re-renders the current route from the server, at most once per burst of requests (see
 * lib/presence/debounce.ts).
 */
export function useRefetch(): () => void {
  const router = useRouter();
  const refetch = useMemo(() => debounce(() => startTransition(() => router.refresh())), [router]);
  useEffect(() => () => refetch.cancel(), [refetch]);
  return refetch;
}

/**
 * Subscribes to the viewer's private Realtime channel (`user:<users.id>`) and calls `onChange`
 * for every `event` signal, and once after a reconnect (signals sent while disconnected are
 * lost). The Clerk session token is read on every Realtime heartbeat, so token refreshes are
 * picked up. If the subscription fails, the page keeps working on what it has and a status is
 * logged under `label`, never a token or anything the signal is about (NFR-SEC-11).
 */
export function useUserSignals(
  viewerId: string,
  event: string,
  onChange: () => void,
  label: string,
): void {
  const { isLoaded, session } = useSession();
  const sessionId = session?.id;
  const getToken = useEffectEvent(async () => (session ? session.getToken() : null));
  const changed = useEffectEvent(onChange);

  useEffect(() => {
    if (!isLoaded || !sessionId) return;
    let supabase: ReturnType<typeof createBrowserSupabase>;
    try {
      supabase = createBrowserSupabase(() => getToken());
    } catch {
      console.warn(`${label}: live updates unavailable`, 'no_config');
      return;
    }
    let joined = false;
    const channel = supabase
      .channel(userChannel(viewerId), { config: { private: true } })
      .on('broadcast', { event }, () => changed())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // A re-join after a dropped connection: catch up on anything missed meanwhile.
          if (joined) changed();
          joined = true;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // The status only: the error itself can carry connection details.
          console.warn(`${label}: live updates unavailable`, status);
        }
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isLoaded, sessionId, viewerId, event, label]);
}
