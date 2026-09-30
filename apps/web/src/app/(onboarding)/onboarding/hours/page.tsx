import type { Metadata } from 'next';
import { HoursSlider } from '@/components/onboarding/hours-slider';
import { OnboardingShell } from '@/components/onboarding/shell';
import { nextStepHref } from '@/lib/onboarding';

export const metadata: Metadata = { title: 'Your hours' };

// J1.3, FR-AVL-2, WF-062.
export default function OnboardingHoursPage() {
  return (
    <OnboardingShell
      step="hours"
      title="When are you usually up and about?"
      subtitle="We'll only show you as free inside these hours."
    >
      <HoursSlider next={nextStepHref('hours')} />
    </OnboardingShell>
  );
}
