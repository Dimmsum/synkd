// Statuses as the signed-in user (PRD §8.5 "Now screen", FR-VIEW-1, FR-AVL-4, D41, WF-064).
//
// Everyone else's comes from `now_for_viewer`, which returns each connection's schedule already
// redacted to the viewer's tier; the viewer's own comes from their own rows under RLS. The
// availability engine runs here, on the server, over both (lib/presence/compute.ts). Memoised
// per request with React's `cache`, so the layout, the page and its helpers share one read and
// one clock.
//
// Only error codes go into thrown errors and logs, never names, titles or labels (NFR-SEC-11).

import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { DEFAULT_UNTIL_HORIZON_MS } from '@synkd/availability';
import type { NowConnection } from '@synkd/backend';
import {
  computePresence,
  errorCode,
  nowRowToConnection,
  ownPresenceInput,
  settleOwnNow,
  UNKNOWN_PRESENCE,
  type ComputedPresence,
} from '@/lib/presence/compute';
import { createServerSupabase } from '@/lib/supabase/server';
import type { Connection } from '@/lib/types';

/**
 * The instant every status in this request is worked out at, UTC epoch ms. The same `now` goes
 * to `now_for_viewer` and the engine, so "until X" and "free soon" are exact (§8.5).
 */
export const requestNow = cache((): number => Date.now());

/**
 * The signed-in user's own users row (WF-004; RLS lets them read only that row). proxy.ts
 * creates it before any app route renders, so a missing one is a setup problem.
 */
export const getViewerRow = cache(async () => {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('users')
    .select('id, name, handle, timezone, sharing_paused')
    .eq('clerk_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Reading the viewer failed (${error.code})`);
  if (!data) throw new Error('No users row for this sign-in');
  return data;
});

/** The range `now_for_viewer` covers: the engine's "until X" look-ahead from `now`. */
function nowRange(now: number) {
  return {
    range_start: new Date(now).toISOString(),
    range_end: new Date(now + DEFAULT_UNTIL_HORIZON_MS).toISOString(),
  };
}

/**
 * Everyone the viewer can see on the Now screen (friends and group co-members, never blocked),
 * each with their status, "until X" and the changes ahead, at their tier for the viewer.
 * One person whose schedule the engine can't handle shows as `unknown`; the rest still load.
 */
export const getNowConnections = cache(async (): Promise<Connection[]> => {
  const now = requestNow();
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('now_for_viewer', nowRange(now));
  if (error) throw new Error(`now_for_viewer failed (${error.code})`);
  return (data as unknown as NowConnection[]).map((row) => {
    const { connection, error: code } = nowRowToConnection(row, now);
    // The error class only: an engine message can quote an RRULE (NFR-SEC-11).
    if (code) console.warn('Now: a status could not be worked out', code);
    return connection;
  });
});

/**
 * Connections by user id, for screens that show a status next to someone (friends, groups).
 * Those screens still work without it: on failure this is empty and they show no status.
 */
export const getPresenceIndex = cache(async (): Promise<Map<string, Connection>> => {
  try {
    return new Map((await getNowConnections()).map((c) => [c.id, c]));
  } catch (err) {
    console.warn('Now: statuses unavailable', errorCode(err));
    return new Map();
  }
});

/**
 * The viewer's own status (the status chip, group member lists), worked out by the same engine
 * from their own rows under RLS: hours, manual statuses, sources and events. Rows that belong to
 * their offline friends are filtered out (WF-127: RLS can't tell them apart from the owner's).
 */
export const getOwnPresence = cache(async (): Promise<ComputedPresence> => {
  const now = requestNow();
  const { range_start: start, range_end: end } = nowRange(now);
  const [viewer, supabase] = await Promise.all([getViewerRow(), createServerSupabase()]);
  const [prefs, overrides, sources, events] = await Promise.all([
    supabase.from('availability_prefs').select('weekly').maybeSingle(),
    supabase
      .from('status_overrides')
      .select('id, status, label, starts_at, ends_at')
      .lt('starts_at', end)
      .or(`ends_at.is.null,ends_at.gt."${start}"`),
    supabase
      .from('sources')
      .select('id, offline_friend_id, period_start, period_end, period_exceptions')
      .is('offline_friend_id', null),
    // Busy events that can touch the range: one-offs overlapping it, and recurring events that
    // started before its end (the engine expands them within their source's period).
    supabase
      .from('events')
      .select(
        'id, source_id, offline_friend_id, starts_at, ends_at, rrule, exdates, busy, category, title',
      )
      .is('offline_friend_id', null)
      .eq('busy', true)
      .lt('starts_at', end)
      .or(`rrule.not.is.null,ends_at.gt."${start}"`),
  ]);
  const failed = [prefs, overrides, sources, events].find((r) => r.error)?.error;
  if (failed) {
    console.warn('Now: own status unavailable', failed.code);
    return UNKNOWN_PRESENCE;
  }
  try {
    return computePresence(
      ownPresenceInput({
        timezone: viewer.timezone,
        sharingPaused: viewer.sharing_paused,
        weekly: prefs.data?.weekly ?? null,
        overrides: overrides.data ?? [],
        sources: sources.data ?? [],
        events: events.data ?? [],
      }),
      // Right after the status chip changes it, by the database's clock (WF-132).
      settleOwnNow(now, overrides.data ?? []),
    );
  } catch (err) {
    console.warn('Now: own status could not be worked out', errorCode(err));
    return UNKNOWN_PRESENCE;
  }
});
