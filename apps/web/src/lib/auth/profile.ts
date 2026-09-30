// The first-sign-in profile (WF-004): what `ensure_current_user` gets from the Clerk user.

import { DEFAULT_TIMEZONE } from '@whosfree/shared';

/**
 * Cookie holding the browser's IANA timezone, set on the sign-in/sign-up pages so the users
 * row starts in the right zone (FR-AUTH-3). Strictly functional; read once, on first sign-in.
 */
export const TIMEZONE_COOKIE = 'wf_tz';

/** Name limit of `users.name` (1–100 characters). */
const MAX_NAME = 100;

/** The Clerk user fields we use (a subset of `User` from `@clerk/nextjs/server`). */
export interface ClerkProfile {
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  imageUrl: string;
  hasImage: boolean;
}

/** Arguments for `ensure_current_user` (`Database['public']['Functions']`). */
export interface NewProfile {
  name: string;
  avatar_url?: string;
  timezone: string;
}

/** A known IANA timezone name, or the default (America/Jamaica, FR-AUTH-3). */
export function pickTimezone(candidate: string | undefined): string {
  // Same shape rule as the users timezone trigger, which also rejects POSIX-style specs.
  if (!candidate || !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(candidate)) {
    return DEFAULT_TIMEZONE;
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/**
 * Name, avatar and timezone for a new users row. The name comes from Google, or from the name
 * fields of Clerk's email sign-up (FR-AUTH-2, D45); the avatar only when the user has a real
 * photo (Google), not Clerk's generated one.
 */
export function newProfile(user: ClerkProfile, timezoneCookie: string | undefined): NewProfile {
  const joined = [user.firstName, user.lastName].filter(Boolean).join(' ');
  // Strip control characters, which the database refuses in names.
  const name = (user.fullName || joined || user.username || '')
    .replace(/\p{Cc}/gu, '')
    .trim()
    .slice(0, MAX_NAME)
    .trim();
  const avatar =
    user.hasImage && user.imageUrl.startsWith('https://') && user.imageUrl.length <= 2048
      ? user.imageUrl
      : undefined;
  return {
    // The user can change it later (WF-050); the database needs 1–100 characters.
    name: name || 'New member',
    ...(avatar ? { avatar_url: avatar } : {}),
    timezone: pickTimezone(timezoneCookie),
  };
}
