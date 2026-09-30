// The profile form (FR-AUTH-2, WF-040): checks the display name, handle and timezone with the same
// rules as the database before anything is sent. Pure, so it can be tested without a database.

import { DisplayName, Handle, normalizeHandleInput } from '@whosfree/shared';
import { isKnownTimezone } from '@/lib/auth/profile';

export interface ProfileInput {
  name: string;
  handle: string;
  timeZone: string;
}

export type ParsedProfile =
  | {
      ok: true;
      name: string;
      /** Normalised (no `@`, trimmed). Null clears the handle: handles are optional. */
      handle: string | null;
      timezone: string;
    }
  | { ok: false; error: string };

/**
 * Name: 1–100 characters, no control characters. Handle: optional; when given, the shared
 * `Handle` rules (3–30 ASCII letters, digits or underscores, starting with a letter, not
 * reserved). Timezone: an IANA name the database accepts.
 */
export function parseProfileInput(input: ProfileInput): ParsedProfile {
  const name = DisplayName.safeParse(input.name);
  if (!name.success) {
    return {
      ok: false,
      error: input.name.trim() ? 'Names are 1–100 characters, on one line.' : 'Add your name.',
    };
  }

  const typed = normalizeHandleInput(input.handle);
  let handle: string | null = null;
  if (typed) {
    const parsed = Handle.safeParse(typed);
    if (!parsed.success) {
      return { ok: false, error: `${parsed.error.issues[0]?.message ?? 'Check your handle'}.` };
    }
    handle = parsed.data;
  }

  if (!isKnownTimezone(input.timeZone)) {
    return { ok: false, error: 'Pick a timezone from the list.' };
  }

  return { ok: true, name: name.data, handle, timezone: input.timeZone };
}
