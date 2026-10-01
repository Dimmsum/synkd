import type { Metadata } from 'next';
import Link from 'next/link';
import { Smartphone } from 'lucide-react';
import { buttonVariants } from '@whosfree/ui/components/button';
import { OnboardingShell } from '@/components/onboarding/shell';
import { PushPermission } from '@/components/push/push-permission';

export const metadata: Metadata = { title: 'Install and notifications' };

// J1.8, FR-PWA-3/4. Hidden from the flow until WF-111 (see ONBOARDING_FLAGS). The
// notifications half is WF-091's PushPermission: an explanation, then the permission prompt.
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
      <PushPermission className="rounded-2xl p-5" />
      <Link href="/now" className={buttonVariants({ size: 'lg' })}>
        See who&apos;s free
      </Link>
    </OnboardingShell>
  );
}
