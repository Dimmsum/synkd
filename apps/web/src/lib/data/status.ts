// The viewer's own manual status (FR-AVL-3, J5, WF-063), for the status chip.
//
// A small read of the viewer's own `status_overrides` rows (owner-only under RLS). It is separate
// from getViewer() on purpose: the viewer's calendar-based status there still comes from the
// mock engine until the Now screen is wired (WF-064), which will apply overrides for everyone,
// the viewer included. Until then the chip shows an active override on top of it.

import type { Iso } from '@/lib/types';
import { activeOverride, type ActiveOverride } from '@/lib/manual-status';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * The viewer's manual status in effect right now, or null when their calendar applies. `now` is
 * the real time the check was made, for "until X".
 */
export async function getMyManualStatus(): Promise<{ override: ActiveOverride; now: Iso } | null> {
  const now = new Date().toISOString();
  const supabase = await createServerSupabase();
  // set_status closes the previous status, so at most one row is active; a few rows leave room
  // for rows that started at the same instant.
  const { data, error } = await supabase
    .from('status_overrides')
    .select('status, label, starts_at, ends_at')
    .lte('starts_at', now)
    .or(`ends_at.is.null,ends_at.gt."${now}"`)
    .order('starts_at', { ascending: false })
    .limit(5);
  if (error) {
    // The chip falls back to the calendar-based status rather than breaking every page.
    console.error('Reading the manual status failed', error.code);
    return null;
  }
  const override = activeOverride(data, now);
  return override ? { override, now } : null;
}
