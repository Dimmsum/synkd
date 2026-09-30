// Route gating for proxy.ts (WF-004, WF-005, WF-015, PRD §8.3). Pure, so every case is
// unit-tested; the proxy does the I/O (Clerk session, `account_status()`) and applies the
// decision.
//
// Order for a signed-in user: create the users row → confirm age (18+) → accept the current
// terms/privacy version → app. Onboarding follows consent (the consent action sends new users
// to /onboarding); there is no "onboarding finished" flag in the database, so it isn't gated.

import type { AccountStatus } from '@whosfree/backend';

/** What a signed-in user still has to do before they may use the app. */
export type AccountStep = 'profile' | 'age' | 'consent' | 'ready';

/** The step `account_status()` implies. No row (or no profile) means the users row is missing. */
export function accountStep(
  status: Pick<AccountStatus, 'has_profile' | 'age_confirmed' | 'consent_required'> | null,
): AccountStep {
  if (!status?.has_profile) return 'profile';
  if (!status.age_confirmed) return 'age';
  if (status.consent_required) return 'consent';
  return 'ready';
}

/** Where each unfinished sign-up step is done, and where a ready user lands. */
export const STEP_PATH = {
  age: '/sign-up/age',
  consent: '/sign-up/terms',
  ready: '/now',
} as const satisfies Record<Exclude<AccountStep, 'profile'>, string>;

/**
 * How a path is treated.
 *   public   anyone, no account check (legal pages, help, invite links, the under-18 page,
 *            PWA files)
 *   open     not gated here; route handlers check their own auth (cron secrets, webhooks)
 *   landing  `/`: signed-in users are sent on to the app
 *   auth     Clerk's sign-in/sign-up pages: signed-in users are sent on
 *   age      the age step, only while the age is unconfirmed (WF-005)
 *   consent  the terms step, only while consent is required (WF-015)
 *   app      everything else, including /onboarding: signed in, 18+ confirmed, current consent
 * Unknown paths count as `app` (deny by default), so a new route is protected without a list
 * to update.
 */
export type RouteKind = 'public' | 'open' | 'landing' | 'auth' | 'age' | 'consent' | 'app';

const PUBLIC_PREFIXES = [
  '/privacy',
  '/terms',
  '/contact',
  '/help',
  '/i',
  '/sign-up/not-eligible',
  // PWA files (WF-090). /offline must never redirect: the service worker precaches it without
  // a session, and a redirect would cache the sign-in page as the offline page.
  '/offline',
  '/serwist',
  '/manifest.webmanifest',
  '/icons',
  '/splash',
];

const under = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

export function routeKind(pathname: string): RouteKind {
  if (pathname === '/') return 'landing';
  if (under(pathname, '/api')) return 'open';
  if (PUBLIC_PREFIXES.some((p) => under(pathname, p))) return 'public';
  if (under(pathname, STEP_PATH.age)) return 'age';
  if (under(pathname, STEP_PATH.consent)) return 'consent';
  if (under(pathname, '/sign-in') || under(pathname, '/sign-up')) return 'auth';
  return 'app';
}

export type GateDecision =
  | { type: 'allow' }
  /** Signed out on a page that needs an account: Clerk's sign-in, returning here afterwards. */
  | { type: 'sign-in' }
  /** Signed in but no users row yet: call `ensure_current_user`, then decide again. */
  | { type: 'create-profile' }
  | { type: 'redirect'; to: string };

const allow: GateDecision = { type: 'allow' };

/**
 * Decides what happens to a request for a route of `kind`. `step` is null when signed out.
 * Signed-in users are always sent to the page for their current step, so the age and terms
 * pages can't be skipped and can't be revisited once done.
 */
export function gate(kind: RouteKind, step: AccountStep | null): GateDecision {
  if (kind === 'public' || kind === 'open') return allow;

  if (step === null) {
    return kind === 'landing' || kind === 'auth' ? allow : { type: 'sign-in' };
  }
  if (step === 'profile') return { type: 'create-profile' };

  const here =
    (kind === 'age' && step === 'age') ||
    (kind === 'consent' && step === 'consent') ||
    (kind === 'app' && step === 'ready');
  return here ? allow : { type: 'redirect', to: STEP_PATH[step] };
}
