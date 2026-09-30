// Shared plumbing for the social server actions (lib/actions/social.ts, pings.ts). Not an
// action module itself, so nothing here is callable from the browser.

import 'server-only';
import { revalidatePath } from 'next/cache';
import { fail } from '@/lib/actions/result';
import { knownDbErrorMessage, TRY_AGAIN, type DbError } from '@/lib/social/errors';

/**
 * The failure to return for a database error. Unexpected ones are logged by SQLSTATE only:
 * never names, handles, group names or tokens (NFR-SEC-11).
 */
export function failFrom(fn: string, error: DbError) {
  const known = knownDbErrorMessage(error);
  if (!known) console.error(`${fn} failed`, error.code ?? 'no code');
  return fail(known ?? TRY_AGAIN);
}

/**
 * After a social mutation: re-render every screen that shows friends, requests or groups
 * (the pages, the sidebar's group list and Now). Social changes are rare, so refreshing the
 * whole app layout is simpler than tracking which pages show what.
 */
export function refreshSocial() {
  revalidatePath('/', 'layout');
}
