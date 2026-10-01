'use server';

// Settings (WF-040, WF-050, WF-062, WF-094/SET-3). Available hours and the profile write to the
// database as the signed-in user; RLS limits every write to their own rows (D41).

import { revalidatePath } from 'next/cache';
import { auth } from '@clerk/nextjs/server';
import type { AvailableHoursDay } from '@/lib/types';
import { daysToWeekly } from '@/lib/available-hours';
import { hoursErrorMessage, profileErrorMessage } from '@/lib/db-errors';
import { parseProfileInput } from '@/lib/profile-form';
import { createServerSupabase } from '@/lib/supabase/server';
import { fail, mockDelay, ok, type ActionResult } from './result';

/**
 * Saves the whole week of available hours (FR-AVL-2, D24), from the onboarding slider or the
 * settings editor. Days switched off are left out, which the engine shows as Away all day
 * (packages/availability `availableHoursIntervals`). One window per day, no overnight windows;
 * the database trigger checks the same and stores the week in mon..sun order.
 *
 * The week is replaced in one UPDATE of the caller's own `availability_prefs` row, so it is never
 * half saved. (`set_day_hours` edits a single day; the editors always send all seven.)
 */
export async function saveAvailableHours(days: AvailableHoursDay[]): Promise<ActionResult> {
  const week = daysToWeekly(days);
  if (!week.ok) return fail('Each day’s end time must be after its start time.');

  const supabase = await createServerSupabase();
  // Updates need a filter, and the row id is only readable by its owner (RLS).
  const { data: prefs, error: readError } = await supabase
    .from('availability_prefs')
    .select('id')
    .maybeSingle();
  if (readError || !prefs) {
    console.error('Reading availability_prefs failed', readError?.code ?? 'no row');
    return fail(hoursErrorMessage(readError?.code ?? 'P0002'));
  }
  const { data: saved, error } = await supabase
    .from('availability_prefs')
    .update({ weekly: week.weekly })
    .eq('id', prefs.id)
    .select('id');
  if (error || saved.length !== 1) {
    console.error('Saving available hours failed', error?.code ?? 'no row updated');
    return fail(hoursErrorMessage(error?.code));
  }

  // Statuses everywhere depend on these hours (the shell's status chip, Now, friend pages).
  revalidatePath('/', 'layout');
  return ok;
}

/**
 * Saves the display name, handle and timezone (FR-AUTH-2, FR-AUTH-3, WF-040). The handle is
 * required (D47) and goes through `set_handle`, which checks the format, reserved words and
 * uniqueness and allows 10 changes a day; setting the same handle again is free. It is saved
 * first, so a taken or reserved handle leaves the rest unchanged. Name and timezone are plain
 * column updates the user is granted on their own row.
 */
export async function saveProfile(input: {
  name: string;
  handle: string;
  timeZone: string;
}): Promise<ActionResult> {
  const parsed = parseProfileInput(input);
  if (!parsed.ok) return fail(parsed.error);

  const { userId } = await auth();
  if (!userId) return fail('Sign in again to save your profile.');
  const supabase = await createServerSupabase();

  const { error: handleError } = await supabase.rpc('set_handle', { handle: parsed.handle });
  if (handleError) {
    // WF1xx and PT429 are expected; anything else is worth a log (the code only, NFR-SEC-11).
    if (!/^(WF1\d\d|PT429)$/.test(handleError.code)) {
      console.error('set_handle failed', handleError.code);
    }
    return fail(profileErrorMessage(handleError.code));
  }

  const { data: saved, error } = await supabase
    .from('users')
    .update({ name: parsed.name, timezone: parsed.timezone })
    .eq('clerk_id', userId)
    .select('id');
  if (error || saved.length !== 1) {
    console.error('Saving the profile failed', error?.code ?? 'no row updated');
    return fail(profileErrorMessage(error?.code));
  }

  // The name shows in the app shell on every page.
  revalidatePath('/', 'layout');
  return ok;
}

export async function setSharingPaused(_paused: boolean): Promise<ActionResult> {
  // TODO(WF-050): set users.sharingPaused; everyone sees "Sharing paused".
  await mockDelay();
  return ok;
}

export async function saveNotificationSettings(_input: {
  types: Record<string, boolean>;
  quietHours: { enabled: boolean; start: string; end: string };
}): Promise<ActionResult> {
  // TODO(FR-SET-3, WF-094): save per-type preferences and quiet hours.
  await mockDelay();
  return ok;
}
