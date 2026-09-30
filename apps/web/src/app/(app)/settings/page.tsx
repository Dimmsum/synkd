import type { Metadata } from 'next';
import { PageHeader } from '@/components/app/page-header';
import { SettingsNav } from '@/components/settings/settings-nav';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" />
      <SettingsNav variant="list" />
      {/* TODO(WF-004): sign out with Clerk. */}
    </div>
  );
}
