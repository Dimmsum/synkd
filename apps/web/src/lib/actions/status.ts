'use server';

// Manual status (FR-AVL-3, J5, D5, WF-063): the status chip sets or clears an override through
// `set_status` / `clear_status`, which start it now, close the previous one, and check the same
// limits as parseStatusInput (label at most 40 characters, end at most 7 days away).

import { revalidatePath } from 'next/cache';
import type { ManualStatus } from '@whosfree/shared';
import { statusErrorMessage } from '@/lib/db-errors';
import { parseStatusInput } from '@/lib/manual-status';
import { createServerSupabase } from '@/lib/supabase/server';
import { fail, ok, type ActionResult } from './result';

export async function setManualStatus(input: {
  /** null = back to automatic (the calendar applies again). */
  status: ManualStatus | null;
  /** ISO instant, or null for "until I change it". */
  until: string | null;
  /** Optional short note, e.g. "Revising for MATH1141". Never a location (D35). */
  label?: string | null;
}): Promise<ActionResult> {
  const parsed = parseStatusInput(input, Date.now());
  if (!parsed.ok) return fail(parsed.error);

  const supabase = await createServerSupabase();
  const { error } = parsed.clear
    ? await supabase.rpc('clear_status')
    : await supabase.rpc('set_status', parsed.args);
  if (error) {
    // The code only: never the label (NFR-SEC-11).
    console.error(parsed.clear ? 'clear_status failed' : 'set_status failed', error.code);
    return fail(statusErrorMessage(error.code));
  }

  // The chip is in the app shell on every page; Now and friend pages show statuses too.
  // Other viewers pick the change up through the Realtime "changed" signal (WF-064).
  revalidatePath('/', 'layout');
  return ok;
}
