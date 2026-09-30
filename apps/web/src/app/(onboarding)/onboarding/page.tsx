import { redirect } from 'next/navigation';
import { ONBOARDING_STEPS } from '@/lib/onboarding';

// Entry point after sign-up (J1).
// TODO(WF-068): resume at the first unfinished step, and carry a remembered invite (WF-045).
export default function OnboardingStart() {
  redirect(ONBOARDING_STEPS[0]?.href ?? '/now');
}
