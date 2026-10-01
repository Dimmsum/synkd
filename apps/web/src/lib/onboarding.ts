import type { Route } from 'next';
import { ONBOARDING_STEPS as STEP_ORDER, type OnboardingStep } from '@whosfree/shared';

export type { OnboardingStep };

/**
 * Onboarding steps in order (J1, FR-WEB-5, WF-068): available hours → upload or skip → review →
 * Google Calendar → group tier picker (only when arriving through an invite) → install and
 * notifications → Now. Google Calendar turns on with WF-080; until then its page exists but the
 * flow skips it.
 */
export const ONBOARDING_FLAGS = {
  googleCalendar: false, // TODO(WF-080)
  installAndPush: true, // WF-111 (install) + WF-091 (notifications)
};

export interface OnboardingStepInfo {
  key: OnboardingStep;
  label: string;
  href: Route;
}

const ALL: (OnboardingStepInfo & { enabled: boolean })[] = [
  { key: 'hours', label: 'Hours', href: '/onboarding/hours', enabled: true },
  { key: 'schedule', label: 'Schedule', href: '/onboarding/upload', enabled: true },
  {
    key: 'calendar',
    label: 'Calendar',
    href: '/onboarding/calendar',
    enabled: ONBOARDING_FLAGS.googleCalendar,
  },
  { key: 'sharing', label: 'Group', href: '/onboarding/visibility', enabled: true },
  {
    key: 'install',
    label: 'Install',
    href: '/onboarding/install',
    enabled: ONBOARDING_FLAGS.installAndPush,
  },
];

/**
 * What the flow knows about the user (read by lib/data/onboarding.ts):
 *   passed       steps done or skipped (`users.onboarding_steps`)
 *   finished     they reached the end of the flow once (`users.onboarded_at`)
 *   hasSchedule  they have a confirmed schedule of their own (a `sources` row)
 *   invite       they arrived through an invite that still works and haven't joined yet (the
 *                wf_invite cookie, WF-045)
 */
export interface OnboardingState {
  passed: readonly OnboardingStep[];
  finished: boolean;
  hasSchedule: boolean;
  invite: boolean;
}

/**
 * The steps this user goes through, in order. The group tier picker only appears when they
 * arrived through an invite (or already went through it, so the progress bar doesn't shrink
 * once joining has used the invite up).
 */
export function onboardingSteps(
  state: Pick<OnboardingState, 'invite' | 'passed'>,
): OnboardingStepInfo[] {
  return ALL.filter(
    (s) => s.enabled && (s.key !== 'sharing' || state.invite || state.passed.includes('sharing')),
  ).map(({ key, label, href }) => ({ key, label, href }));
}

/** Whether `step` needs nothing more from the user: done (real data where we have it) or skipped. */
export function isStepDone(step: OnboardingStep, state: OnboardingState): boolean {
  if (state.passed.includes(step)) return true;
  switch (step) {
    case 'schedule':
      return state.hasSchedule;
    case 'sharing':
      return !state.invite;
    default:
      return false;
  }
}

/**
 * Where /onboarding sends the user: the first unfinished step, or Now once there's none or they
 * finished onboarding before (so they're never sent back into it).
 */
export function resumeHref(state: OnboardingState): Route {
  if (state.finished) return '/now';
  return onboardingSteps(state).find((s) => !isStepDone(s.key, state))?.href ?? '/now';
}

/**
 * Where "Continue"/"Skip" goes after `step`: the next of `steps` in flow order, or Now after the
 * last one (J1.9). Works for a step that isn't in `steps` too (e.g. the tier picker opened without
 * an invite).
 */
export function nextStepHref(step: OnboardingStep, steps: readonly OnboardingStepInfo[]): Route {
  const order = STEP_ORDER.indexOf(step);
  return steps.find((s) => STEP_ORDER.indexOf(s.key) > order)?.href ?? '/now';
}

/** True for a step name from a request (server actions take it from the client). */
export function isOnboardingStep(value: unknown): value is OnboardingStep {
  return typeof value === 'string' && (STEP_ORDER as readonly string[]).includes(value);
}
