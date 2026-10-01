import { describe, expect, it } from 'vitest';
import {
  isOnboardingStep,
  isStepDone,
  nextStepHref,
  onboardingSteps,
  resumeHref,
  type OnboardingState,
} from './onboarding';

// WF-068 / J1: the flow's order, which steps show, and where /onboarding resumes.

const fresh: OnboardingState = { passed: [], finished: false, hasSchedule: false, invite: false };
const keys = (state: Pick<OnboardingState, 'invite' | 'passed'>) =>
  onboardingSteps(state).map((s) => s.key);

describe('onboardingSteps', () => {
  it('without an invite: hours, schedule, install (Google Calendar stays hidden until WF-080)', () => {
    expect(keys(fresh)).toEqual(['hours', 'schedule', 'install']);
  });

  it('through an invite: the group tier picker comes before install', () => {
    expect(keys({ ...fresh, invite: true })).toEqual(['hours', 'schedule', 'sharing', 'install']);
  });

  it('keeps the tier picker once passed, after joining used the invite up', () => {
    expect(keys({ ...fresh, passed: ['hours', 'schedule', 'sharing'] })).toContain('sharing');
  });
});

describe('isStepDone', () => {
  it('counts a confirmed schedule as the schedule step done, even without passing it', () => {
    expect(isStepDone('schedule', fresh)).toBe(false);
    expect(isStepDone('schedule', { ...fresh, hasSchedule: true })).toBe(true);
  });

  it('counts the tier picker as done when no invite is waiting', () => {
    expect(isStepDone('sharing', fresh)).toBe(true);
    expect(isStepDone('sharing', { ...fresh, invite: true })).toBe(false);
    expect(isStepDone('sharing', { ...fresh, invite: true, passed: ['sharing'] })).toBe(true);
  });

  it('counts hours and install only once passed (done or skipped)', () => {
    expect(isStepDone('hours', fresh)).toBe(false);
    expect(isStepDone('hours', { ...fresh, passed: ['hours'] })).toBe(true);
    expect(isStepDone('install', { ...fresh, passed: ['install'] })).toBe(true);
  });
});

describe('resumeHref', () => {
  it('starts a new user at available hours', () => {
    expect(resumeHref(fresh)).toBe('/onboarding/hours');
  });

  it('resumes at the first unfinished step, skipped steps included', () => {
    expect(resumeHref({ ...fresh, passed: ['hours'] })).toBe('/onboarding/upload');
    expect(resumeHref({ ...fresh, passed: ['hours'], hasSchedule: true })).toBe(
      '/onboarding/install',
    );
    expect(resumeHref({ ...fresh, passed: ['hours', 'schedule'], invite: true })).toBe(
      '/onboarding/visibility',
    );
  });

  it('goes back to an earlier step left unfinished', () => {
    expect(resumeHref({ ...fresh, passed: ['schedule', 'install'] })).toBe('/onboarding/hours');
  });

  it('lands on Now once every step is done', () => {
    expect(resumeHref({ ...fresh, passed: ['hours', 'install'], hasSchedule: true })).toBe('/now');
  });

  it('never sends someone who finished back into onboarding', () => {
    expect(resumeHref({ ...fresh, finished: true })).toBe('/now');
    expect(resumeHref({ ...fresh, finished: true, invite: true })).toBe('/now');
  });
});

describe('nextStepHref', () => {
  const withInvite = onboardingSteps({ invite: true, passed: [] });
  const without = onboardingSteps({ invite: false, passed: [] });

  it('follows the flow order and ends on Now', () => {
    expect(nextStepHref('hours', withInvite)).toBe('/onboarding/upload');
    expect(nextStepHref('schedule', withInvite)).toBe('/onboarding/visibility');
    expect(nextStepHref('sharing', withInvite)).toBe('/onboarding/install');
    expect(nextStepHref('install', withInvite)).toBe('/now');
  });

  it('skips the tier picker without an invite', () => {
    expect(nextStepHref('schedule', without)).toBe('/onboarding/install');
  });

  it('works from a step that is not in the list', () => {
    expect(nextStepHref('sharing', without)).toBe('/onboarding/install');
    expect(nextStepHref('calendar', without)).toBe('/onboarding/install');
  });
});

describe('isOnboardingStep', () => {
  it('accepts only known steps', () => {
    expect(isOnboardingStep('hours')).toBe(true);
    expect(isOnboardingStep('tour')).toBe(false);
    expect(isOnboardingStep(undefined)).toBe(false);
  });
});
