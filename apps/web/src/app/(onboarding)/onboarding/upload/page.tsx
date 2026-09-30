import type { Metadata } from 'next';
import { UploadCard } from '@/components/import/upload-card';
import { OnboardingShell } from '@/components/onboarding/shell';

export const metadata: Metadata = { title: 'Add your schedule' };

// J1.4 (upload or skip), WF-026.
export default function OnboardingUploadPage() {
  return (
    <OnboardingShell
      step="schedule"
      title="Add your schedule"
      subtitle="Upload your class timetable or work roster as a PDF, photo or screenshot. You'll check it over next."
    >
      <UploadCard flow="onboarding" />
      <p className="text-xs text-muted-foreground">
        We ignore rooms and addresses in your file, and delete the file once you confirm.
      </p>
    </OnboardingShell>
  );
}
