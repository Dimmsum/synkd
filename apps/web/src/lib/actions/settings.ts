'use server';

// Settings (WF-040, WF-050, WF-062, WF-094/SET-3). Stubs only.

import { AvailableHours } from '@whosfree/shared';
import type { AvailableHoursDay } from '@/lib/types';
import { fail, mockDelay, ok, type ActionResult } from './result';

export async function saveAvailableHours(days: AvailableHoursDay[]): Promise<ActionResult> {
  for (const d of days.filter((x) => x.enabled)) {
    const parsed = AvailableHours.safeParse({ day: d.day, start: d.start, end: d.end });
    if (!parsed.success) return fail('Each day’s end time must be after its start time.');
  }
  // TODO(WF-062): save availabilityPrefs.weekly. Days switched off are left out, which the
  // engine treats as Away all day (confirm with packages/availability, WF-060).
  await mockDelay();
  return ok;
}

export async function saveProfile(input: {
  name: string;
  handle: string;
  timeZone: string;
}): Promise<ActionResult> {
  if (!input.name.trim()) return fail('Add your name.');
  if (!/^[a-z0-9_.-]{2,30}$/i.test(input.handle)) {
    return fail('Handles use 2–30 letters, numbers, dots, dashes or underscores.');
  }
  // TODO(WF-040): update users (name, handle, timezone).
  await mockDelay();
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
