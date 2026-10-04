// The profile form (FR-AUTH-2, WF-040): checks the display name, handle and timezone with the same
// rules as the database before anything is sent. Pure, so it can be tested without a database.

import { DisplayName, Handle, normalizeHandleInput } from '@whosfree/shared';
import { isKnownTimezone } from '@/lib/auth/profile';

export interface ProfileInput {
  name: string;
  handle: string;
  timeZone: string;
}

/** The form field an error is about, so the form can mark it invalid (WF-136). */
export type ProfileField = 'name' | 'handle' | 'timeZone';

export type ParsedProfile =
  | {
      ok: true;
      name: string;
      /** Normalised (no `@`, trimmed). Every user has one, so it can't be cleared (D47). */
      handle: string;
      timezone: string;
    }
  | { ok: false; error: string; field: ProfileField };

/**
 * Name: 1–100 characters, no control characters. Handle: required (D47), with the shared `Handle`
 * rules (3–30 ASCII letters, digits or underscores, starting with a letter, not reserved).
 * Timezone: an IANA name the database accepts.
 */
export function parseProfileInput(input: ProfileInput): ParsedProfile {
  const name = DisplayName.safeParse(input.name);
  if (!name.success) {
    return {
      ok: false,
      error: input.name.trim() ? 'Names are 1–100 characters, on one line.' : 'Add your name.',
      field: 'name',
    };
  }

  const typed = normalizeHandleInput(input.handle);
  if (!typed) return { ok: false, error: 'Choose a handle.', field: 'handle' };
  const handle = Handle.safeParse(typed);
  if (!handle.success) {
    return {
      ok: false,
      error: `${handle.error.issues[0]?.message ?? 'Check your handle'}.`,
      field: 'handle',
    };
  }

  if (!isKnownTimezone(input.timeZone)) {
    return { ok: false, error: 'Pick a timezone from the list.', field: 'timeZone' };
  }

  return { ok: true, name: name.data, handle: handle.data, timezone: input.timeZone };
}
