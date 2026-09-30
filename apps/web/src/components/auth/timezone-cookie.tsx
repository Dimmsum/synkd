'use client';

import { useEffect } from 'react';
import { TIMEZONE_COOKIE } from '@/lib/auth/profile';

/**
 * Remembers the browser's timezone for the first-sign-in profile (FR-AUTH-3). proxy.ts reads
 * it once, when it creates the users row; without it the row starts in America/Jamaica.
 */
export function TimezoneCookie() {
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // IANA names only use cookie-safe characters; the server validates the value anyway.
    if (!tz || !/^[\w/+-]+$/.test(tz)) return;
    document.cookie = `${TIMEZONE_COOKIE}=${tz}; path=/; max-age=86400; samesite=lax`;
  }, []);
  return null;
}
