import type { Metadata } from 'next';
import Link from 'next/link';
import { SettingsPage } from '@/components/settings/settings-page';
import { InstallPrompt } from '@/components/pwa/install-prompt';

export const metadata: Metadata = { title: 'Install app' };

// FR-PWA-3, WF-111. Where the install prompt or the iPhone guide can always be found again,
// even after it was dismissed: the user asked for it here.
export default function InstallSettingsPage() {
  return (
    <SettingsPage
      title="Install app"
      subtitle="Open Who's Free from your home screen and get pings as notifications."
    >
      <InstallPrompt surface="requested" />
      <p className="text-sm text-body-foreground">
        Once it&apos;s installed, turn on notifications in{' '}
        <Link
          href="/settings/notifications"
          className="font-semibold text-primary-ink underline-offset-2 hover:underline"
        >
          Notifications
        </Link>
        .
      </p>
    </SettingsPage>
  );
}
