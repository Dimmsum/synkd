'use server';

// Moving through onboarding (J1, FR-WEB-5, WF-068). Every step after sign-up can be skipped and
// picked up later: "Continue" and "Skip for now" both record the step as passed, so /onboarding
// resumes after it, and leaving the last step records that onboarding is finished, so the user
// is never sent back into it.

import { redirect } from 'next/navigation';
import { getOnboardingState } from '@/lib/data/onboarding';
import { isOnboardingStep, nextStepHref, onboardingSteps } from '@/lib/onboarding';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Records `step` as done or skipped and goes to the next step, or to Now after the last one.
 * Usable as a form action (`advanceOnboarding.bind(null, step)`) or called from a client
 * component after its own save. Recording is best effort: if it fails the user still moves on,
 * and /onboarding may offer the step again later.
 */
export async function advanceOnboarding(step: unknown): Promise<void> {
  if (!isOnboardingStep(step)) redirect('/onboarding');
  const state = await getOnboardingState();
  const next = nextStepHref(step, onboardingSteps({ ...state, passed: [...state.passed, step] }));
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('record_onboarding_step', {
    step,
    finish: next === '/now',
  });
  // Only the SQLSTATE (NFR-SEC-11).
  if (error) console.error('record_onboarding_step failed', error.code);
  redirect(next);
}
