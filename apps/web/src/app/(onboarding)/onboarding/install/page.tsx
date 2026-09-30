import type { Metadata } from 'next';
import Link from 'next/link';
import { BellRing, Smartphone } from 'lucide-react';
import { buttonVariants } from '@whosfree/ui/components/button';
import { OnboardingShell } from '@/components/onboarding/shell';

export const metadata: Metadata = { title: 'Install and notifications' };

// J1.8, FR-PWA-3/4. Hidden from the flow until WF-111 and WF-091 (see ONBOARDING_FLAGS).
export default function OnboardingInstallPage() {
  return (
    <OnboardingShell
      step="install"
      title="Put Who's Free on your home screen"
      subtitle="Then turn on notifications so pings reach you straight away."
    >
      <section className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Smartphone aria-hidden="true" className="size-4 text-primary-ink" /> Install
        </h2>
        <p className="text-sm text-body-foreground">
          Android: tap Install when Chrome offers it. iPhone: tap Share, then “Add to Home Screen”.
        </p>
        {/* TODO(WF-111): use the beforeinstallprompt event on Android. */}
      </section>
      <section className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <BellRing aria-hidden="true" className="size-4 text-primary-ink" /> Notifications
        </h2>
        <p className="text-sm text-body-foreground">
          We only notify you about pings, replies and requests. You can set quiet hours.
        </p>
        {/* TODO(WF-091): request permission here, after this explanation (FR-PWA-4). */}
        <button type="button" disabled className={buttonVariants({ variant: 'outline' })}>
          Turn on notifications (coming soon)
        </button>
      </section>
      <Link href="/now" className={buttonVariants({ size: 'lg' })}>
        See who&apos;s free
      </Link>
    </OnboardingShell>
  );
}
