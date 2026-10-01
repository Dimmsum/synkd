import type { Metadata } from 'next';
import { PageHeader } from '@/components/app/page-header';
import { SignOutButton } from '@/components/app/sign-out-button';
import { SettingsNav } from '@/components/settings/settings-nav';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" />
      <SettingsNav variant="list" />
      <SignOutButton className="mt-4 w-full justify-start" />
    </div>
  );
}
