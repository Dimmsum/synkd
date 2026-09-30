import type { Metadata } from 'next';
import { LogOut } from 'lucide-react';
import { SignOutButton } from '@clerk/nextjs';
import { Button } from '@whosfree/ui/components/button';
import { PageHeader } from '@/components/app/page-header';
import { SettingsNav } from '@/components/settings/settings-nav';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" />
      <SettingsNav variant="list" />
      <SignOutButton redirectUrl="/">
        <Button variant="ghost" className="mt-4 w-full justify-start">
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      </SignOutButton>
    </div>
  );
}
