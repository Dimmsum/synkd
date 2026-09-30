import { describe, expect, it } from 'vitest';
import { accountStep, gate, routeKind } from './gate';
import type { AccountStep, RouteKind } from './gate';

const status = (has_profile: boolean, age_confirmed: boolean, consent_required: boolean) => ({
  has_profile,
  age_confirmed,
  consent_required,
});

describe('accountStep (WF-004/005/015)', () => {
  it('needs a users row first', () => {
    expect(accountStep(null)).toBe('profile');
    expect(accountStep(status(false, false, true))).toBe('profile');
  });

  it('then the age, then consent, then the app', () => {
    expect(accountStep(status(true, false, true))).toBe('age');
    expect(accountStep(status(true, true, true))).toBe('consent');
    expect(accountStep(status(true, true, false))).toBe('ready');
  });

  it('asks for the age before consent even if consent is already on record', () => {
    expect(accountStep(status(true, false, false))).toBe('age');
  });
});

describe('routeKind (PRD §8.3)', () => {
  it.each<[string, RouteKind]>([
    ['/', 'landing'],
    ['/privacy', 'public'],
    ['/terms', 'public'],
    ['/help', 'public'],
    ['/i/abc123', 'public'],
    ['/sign-up/not-eligible', 'public'],
    ['/contact', 'public'],
    ['/offline', 'public'],
    ['/serwist/sw.js', 'public'],
    ['/manifest.webmanifest', 'public'],
    ['/icons/icon-192.png', 'public'],
    ['/splash/iphone.png', 'public'],
    ['/api/cron/sync', 'open'],
    ['/sign-in', 'auth'],
    ['/sign-in/sso-callback', 'auth'],
    ['/sign-up', 'auth'],
    ['/sign-up/verify-email-address', 'auth'],
    ['/sign-up/age', 'age'],
    ['/sign-up/terms', 'consent'],
    ['/now', 'app'],
    ['/inbox', 'app'],
    ['/import/job_1/review', 'app'],
    ['/groups/g1/settings', 'app'],
    ['/settings/privacy', 'app'],
    ['/onboarding/hours', 'app'],
    ['/admin', 'app'],
  ])('%s is %s', (path, kind) => {
    expect(routeKind(path)).toBe(kind);
  });

  it('matches whole path segments only', () => {
    expect(routeKind('/terms-old')).toBe('app');
    expect(routeKind('/helpful')).toBe('app');
    expect(routeKind('/sign-inx')).toBe('app');
  });

  it('protects unknown paths by default', () => {
    expect(routeKind('/something-new')).toBe('app');
  });
});

describe('gate', () => {
  describe('signed out', () => {
    it('can see public pages, the landing page and the sign-in/up pages', () => {
      for (const kind of ['public', 'open', 'landing', 'auth'] as const) {
        expect(gate(kind, null)).toEqual({ type: 'allow' });
      }
    });

    it('goes to sign-in from app routes and the sign-up steps', () => {
      for (const kind of ['app', 'age', 'consent'] as const) {
        expect(gate(kind, null)).toEqual({ type: 'sign-in' });
      }
    });
  });

  it('creates the users row on first sign-in, wherever they land', () => {
    for (const kind of ['landing', 'auth', 'age', 'consent', 'app'] as const) {
      expect(gate(kind, 'profile')).toEqual({ type: 'create-profile' });
    }
  });

  it('never checks the account on public pages', () => {
    for (const step of ['profile', 'age', 'consent', 'ready'] as const) {
      expect(gate('public', step)).toEqual({ type: 'allow' });
    }
  });

  describe('age not confirmed (WF-005)', () => {
    it('keeps app routes, onboarding and the terms step closed', () => {
      expect(gate('app', 'age')).toEqual({ type: 'redirect', to: '/sign-up/age' });
      expect(gate('consent', 'age')).toEqual({ type: 'redirect', to: '/sign-up/age' });
    });

    it('sends sign-in, sign-up and the landing page to the age step', () => {
      expect(gate('auth', 'age')).toEqual({ type: 'redirect', to: '/sign-up/age' });
      expect(gate('landing', 'age')).toEqual({ type: 'redirect', to: '/sign-up/age' });
    });

    it('shows the age step', () => {
      expect(gate('age', 'age')).toEqual({ type: 'allow' });
    });
  });

  describe('consent required (WF-015)', () => {
    it('keeps app routes closed until the current version is accepted', () => {
      expect(gate('app', 'consent')).toEqual({ type: 'redirect', to: '/sign-up/terms' });
    });

    it('shows the terms step, and not the age step again', () => {
      expect(gate('consent', 'consent')).toEqual({ type: 'allow' });
      expect(gate('age', 'consent')).toEqual({ type: 'redirect', to: '/sign-up/terms' });
    });
  });

  describe('ready', () => {
    it('opens app routes', () => {
      expect(gate('app', 'ready')).toEqual({ type: 'allow' });
    });

    it('sends the landing, auth and finished step pages to Now', () => {
      for (const kind of ['landing', 'auth', 'age', 'consent'] as const) {
        expect(gate(kind, 'ready')).toEqual({ type: 'redirect', to: '/now' });
      }
    });
  });

  it('a policy version bump sends a ready user back to the terms step', () => {
    const before: AccountStep = accountStep(status(true, true, false));
    const after: AccountStep = accountStep(status(true, true, true));
    expect(gate('app', before)).toEqual({ type: 'allow' });
    expect(gate('app', after)).toEqual({ type: 'redirect', to: '/sign-up/terms' });
  });
});
