import type { Metadata } from 'next';
import { buttonVariants } from '@synkd/ui/components/button';
import { OnboardingShell } from '@/components/onboarding/shell';
import { PushPermission } from '@/components/push/push-permission';
import { InstallPrompt } from '@/components/pwa/install-prompt';
import { advanceOnboarding } from '@/lib/actions/onboarding';

export const metadata: Metadata = { title: 'Install and notifications' };

// J1.8, FR-PWA-3/4. Install first (WF-111: our own prompt on Android and Chromium, the "Add to
// Home Screen" guide on iPhone and iPad, nothing once installed), then notifications (WF-091:
// an explanation, then the permission prompt). The installed app opens on /onboarding, which
// brings iPhone users back here to turn notifications on. Leaving this step finishes onboarding
// (WF-068).
export default function OnboardingInstallPage() {
  return (
    <OnboardingShell
      step="install"
      title="Get pings straight away"
      subtitle="Put synkd on your home screen, then turn on notifications."
    >
      <InstallPrompt surface="onboarding" />
      {/* The install card above already carries the iPhone steps. */}
      <PushPermission className="rounded-2xl p-5" iosSteps={false} />
      <form action={advanceOnboarding.bind(null, 'install')} className="flex flex-col">
        <button type="submit" className={buttonVariants({ size: 'lg' })}>
          See who&apos;s free
        </button>
      </form>
    </OnboardingShell>
  );
}
