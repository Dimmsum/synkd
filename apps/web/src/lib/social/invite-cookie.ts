// Remembering an invite through sign-up and onboarding (FR-WEB-3, WF-045, J1).
//
// proxy.ts sets a short-lived cookie when someone opens /i/<code>. Sign-up shows which group
// they're joining, onboarding's sharing step offers the tier picker and joins, and joining
// clears it. Strictly functional: it holds only the code, which the visitor already has.

import { INVITE_CODE_PATTERN } from '@whosfree/shared';

export const INVITE_COOKIE = 'wf_invite';

/** A day: long enough to finish sign-up and onboarding, short enough not to linger. */
export const INVITE_COOKIE_MAX_AGE = 60 * 60 * 24;

export function isInviteCode(value: unknown): value is string {
  return typeof value === 'string' && INVITE_CODE_PATTERN.test(value);
}

/** The code in an invite page path (`/i/<code>`), or null for anything else. */
export function inviteCodeFromPath(pathname: string): string | null {
  const match = /^\/i\/([^/]+)\/?$/.exec(pathname);
  const code = match?.[1];
  return isInviteCode(code) ? code : null;
}

export function inviteCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: INVITE_COOKIE_MAX_AGE,
  } as const;
}
