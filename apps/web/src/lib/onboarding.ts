import type { Route } from 'next';

/**
 * Onboarding steps in order (J1, WF-068). Google Calendar turns on with WF-080 and the
 * install/notifications step with WF-111 (its notifications half, WF-091, is built). Until then
 * they're skipped (the pages exist so they can be built and reviewed).
 */
export const ONBOARDING_FLAGS = {
  googleCalendar: false, // TODO(WF-080)
  installAndPush: false, // TODO(WF-111)
};

export type OnboardingStep = 'hours' | 'schedule' | 'calendar' | 'sharing' | 'install';

const ALL: { key: OnboardingStep; label: string; href: Route; enabled: boolean }[] = [
  { key: 'hours', label: 'Hours', href: '/onboarding/hours', enabled: true },
  { key: 'schedule', label: 'Schedule', href: '/onboarding/upload', enabled: true },
  {
    key: 'calendar',
    label: 'Calendar',
    href: '/onboarding/calendar',
    enabled: ONBOARDING_FLAGS.googleCalendar,
  },
  { key: 'sharing', label: 'Sharing', href: '/onboarding/visibility', enabled: true },
  {
    key: 'install',
    label: 'Install',
    href: '/onboarding/install',
    enabled: ONBOARDING_FLAGS.installAndPush,
  },
];

export const ONBOARDING_STEPS = ALL.filter((s) => s.enabled);

/** Where "Continue"/"Skip" goes after `step`. The last step lands on Now (J1.9). */
export function nextStepHref(step: OnboardingStep): Route {
  const i = ONBOARDING_STEPS.findIndex((s) => s.key === step);
  return ONBOARDING_STEPS[i + 1]?.href ?? '/now';
}
