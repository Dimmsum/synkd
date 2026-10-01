// Onboarding progress (J1, FR-WEB-5, WF-068): what /onboarding needs to resume at the first
// unfinished step. Own rows only, read under RLS (D41).

import { cache } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getInvite, getRememberedInviteCode } from '@/lib/data/invites';
import { isOnboardingStep, type OnboardingState } from '@/lib/onboarding';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * The signed-in user's onboarding state: steps done or skipped and whether they finished
 * (`users.onboarding_steps`, `users.onboarded_at`), whether they have a schedule of their own
 * (any `sources` row: a confirmed upload, typed-in schedule or calendar), and whether an invite
 * they arrived through is still waiting to be joined (the wf_invite cookie, WF-045).
 */
export const getOnboardingState = cache(async (): Promise<OnboardingState> => {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');
  const supabase = await createServerSupabase();
  const [user, sources, inviteCode] = await Promise.all([
    supabase
      .from('users')
      .select('onboarding_steps, onboarded_at')
      .eq('clerk_id', userId)
      .maybeSingle(),
    supabase.from('sources').select('id').is('offline_friend_id', null).limit(1),
    getRememberedInviteCode(),
  ]);
  if (user.error) throw new Error(`Reading onboarding progress failed (${user.error.code})`);
  if (!user.data) throw new Error('No users row for this sign-in');
  if (sources.error) {
    throw new Error(`Reading your schedule sources failed (${sources.error.code})`);
  }
  const invite = inviteCode ? (await getInvite(inviteCode)).state === 'ok' : false;
  return {
    passed: user.data.onboarding_steps.filter(isOnboardingStep),
    finished: user.data.onboarded_at !== null,
    hasSchedule: sources.data.length > 0,
    invite,
  };
});
