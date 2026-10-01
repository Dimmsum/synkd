// Route protection (WF-004, WF-005, WF-015, PRD §8.3). Next 16 calls this file "proxy"
// (formerly middleware). The rules live in lib/auth/gate.ts; this file only does the I/O.
//
// This is a convenience gate, not the security boundary: Postgres enforces authorisation on
// every read and write (D41), and server actions reach it only with the user's own token.

import { clerkClient, clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { accountStep, gate, routeKind } from '@/lib/auth/gate';
import type { AccountStep } from '@/lib/auth/gate';
import { newProfile, TIMEZONE_COOKIE } from '@/lib/auth/profile';
import {
  INVITE_COOKIE,
  inviteCodeFromPath,
  inviteCookieOptions,
  inviteToResume,
} from '@/lib/social/invite-cookie';
import { supabaseWithToken } from '@/lib/supabase/server';
import type { ServerSupabase } from '@/lib/supabase/server';

async function readStep(supabase: ServerSupabase): Promise<AccountStep> {
  const { data, error } = await supabase.rpc('account_status').single();
  // Only the SQLSTATE: never log tokens or profile data (NFR-SEC-11).
  if (error) throw new Error(`account_status failed (${error.code})`);
  return accountStep(data);
}

/**
 * On an invite page (/i/<code>), remembers the code so it survives sign-up and onboarding
 * (FR-WEB-3, WF-045). Only a well-formed code is stored.
 */
function rememberInvite(req: NextRequest): NextResponse | undefined {
  const code = inviteCodeFromPath(req.nextUrl.pathname);
  if (!code) return undefined;
  const res = NextResponse.next();
  res.cookies.set(INVITE_COOKIE, code, inviteCookieOptions(req.nextUrl.protocol === 'https:'));
  return res;
}

/**
 * After sign-up and onboarding, picks a remembered friend invite link up again (WF-042): on the
 * first visit to Now, if the code is a working friend link, opens /join/<code> (who it adds, the
 * tier picker, the request) and forgets the code. Group invites are left to onboarding and
 * /join (WF-045). Best effort: any error just shows Now.
 */
async function resumeFriendInvite(
  req: NextRequest,
  supabase: ServerSupabase,
): Promise<NextResponse | undefined> {
  const code = inviteToResume(req.nextUrl.pathname, req.cookies.get(INVITE_COOKIE)?.value);
  if (!code) return undefined;
  const { data, error } = await supabase.rpc('get_friend_invite_summary', { code });
  // No row: a group invite (or a link this user can't use). Leave the cookie to the group flow.
  const row = error ? undefined : data[0];
  if (!row) return undefined;
  const res =
    row.status === 'valid'
      ? NextResponse.redirect(new URL(`/join/${code}`, req.url))
      : NextResponse.next();
  res.cookies.delete(INVITE_COOKIE);
  return res;
}

export default clerkMiddleware(async (auth, req) => {
  const kind = routeKind(req.nextUrl.pathname);
  // Public pages skip the session and database round trips entirely.
  if (kind === 'public' || kind === 'open') return rememberInvite(req);

  const { userId, getToken, redirectToSignIn } = await auth();
  const supabase = userId ? supabaseWithToken(() => getToken()) : null;
  let decision = gate(kind, supabase ? await readStep(supabase) : null);

  if (decision.type === 'create-profile' && userId && supabase) {
    // First sign-in: create the users row from the Clerk profile (Google, or the name entered at email sign-up). Idempotent, and
    // the database takes the Clerk ID from the token, never from these arguments.
    const user = await (await clerkClient()).users.getUser(userId);
    const { error } = await supabase.rpc(
      'ensure_current_user',
      newProfile(user, req.cookies.get(TIMEZONE_COOKIE)?.value),
    );
    if (error) throw new Error(`ensure_current_user failed (${error.code})`);
    decision = gate(kind, await readStep(supabase));
    if (decision.type === 'create-profile') throw new Error('users row missing after creation');
  }

  switch (decision.type) {
    case 'allow':
      return supabase ? resumeFriendInvite(req, supabase) : undefined;
    case 'sign-in':
      return redirectToSignIn({ returnBackUrl: req.url });
    case 'redirect':
      return NextResponse.redirect(new URL(decision.to, req.url));
    case 'create-profile':
      throw new Error('unreachable: profile creation needs a signed-in user');
  }
});

export const config = {
  matcher: [
    // Everything except Next internals, static files (unless named in search params) and the
    // PWA's service worker, icons and offline page (WF-090), which must never see Clerk's
    // session handshake or a redirect.
    '/((?!_next|offline|serwist|icons/|splash/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes, so Clerk's auth() works in route handlers.
    '/(api)(.*)',
  ],
};
