import { redirect } from 'next/navigation';
import { getOnboardingState } from '@/lib/data/onboarding';
import { resumeHref } from '@/lib/onboarding';

// Entry point after sign-up (J1), after sign-in and when the installed app opens (its start_url):
// resumes at the first unfinished step, or goes to Now for anyone who finished onboarding
// (WF-068). A remembered invite (WF-045) adds the group tier picker to the steps.
export default async function OnboardingStart() {
  redirect(resumeHref(await getOnboardingState()));
}
