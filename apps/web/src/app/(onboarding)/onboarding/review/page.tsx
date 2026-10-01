import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ReviewEditor } from '@/components/import/review-editor';
import { OnboardingShell } from '@/components/onboarding/shell';
import { getParseJob } from '@/lib/data/imports';
import { getScheduleToReplace } from '@/lib/data/schedule';
import { getOnboardingState } from '@/lib/data/onboarding';
import { nextStepHref, onboardingSteps } from '@/lib/onboarding';

export const metadata: Metadata = { title: 'Check your schedule' };

// J1.5, WF-029. `?job=manual` is manual entry (WF-031).
export default async function OnboardingReviewPage({
  searchParams,
}: PageProps<'/onboarding/review'>) {
  const { job: jobId } = await searchParams;
  const [job, replaces, state] = await Promise.all([
    typeof jobId === 'string' ? getParseJob(jobId) : null,
    getScheduleToReplace(),
    getOnboardingState(),
  ]);
  if (!job) redirect('/onboarding/upload');
  return (
    <OnboardingShell
      step="schedule"
      title={job.fileName ? 'Check your schedule' : 'Enter your schedule'}
      subtitle="Fix anything that's off, then confirm."
    >
      <ReviewEditor
        job={job}
        doneHref={nextStepHref('schedule', onboardingSteps(state))}
        replaces={replaces}
      />
    </OnboardingShell>
  );
}
