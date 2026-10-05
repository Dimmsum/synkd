import type { Metadata } from 'next';
import Link from 'next/link';
import { Download, Trash } from 'lucide-react';
import { buttonVariants } from '@synkd/ui/components/button';
import { Panel } from '@/components/app/page-header';
import { SignOutButton } from '@/components/app/sign-out-button';
import { SettingsPage } from '@/components/settings/settings-page';
import { getConsentRecord } from '@/lib/data/settings';

export const metadata: Metadata = { title: 'Privacy and data' };

// TODO(WF-011): final domain and contact address.
const CONTACT = 'privacy@getsynked.com';

const formatAccepted = (at: string) =>
  new Date(at).toLocaleDateString('en-JM', { dateStyle: 'medium', timeZone: 'America/Jamaica' });

// FR-SET-1/2 (export and delete, handled by email until WF-113/WF-114, D39) and FR-SET-5
// (links + consent record).
export default async function PrivacyPage() {
  const consent = await getConsentRecord();
  return (
    <SettingsPage title="Privacy and data">
      <Panel id="your-data" title="Your data">
        <p className="text-sm text-body-foreground">
          We handle these by email for now, within 30 days. Email us from the address you signed up
          with.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`mailto:${CONTACT}?subject=${encodeURIComponent('Export my data')}`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <Download aria-hidden="true" />
            Ask for a copy of my data
          </a>
          <a
            href={`mailto:${CONTACT}?subject=${encodeURIComponent('Delete my account')}`}
            className={buttonVariants({
              variant: 'outline',
              size: 'sm',
              className: 'text-destructive',
            })}
          >
            <Trash aria-hidden="true" />
            Delete my account
          </a>
        </div>
      </Panel>
      <Panel id="consent" title="What you agreed to">
        <p className="text-sm text-body-foreground">
          {consent
            ? `Terms ${consent.termsVersion} and privacy notice ${consent.privacyVersion}, accepted ${formatAccepted(consent.acceptedAt)}.`
            : 'We have no record of you accepting the terms yet.'}
        </p>
        <div className="mt-2 flex gap-4 text-sm font-semibold">
          <Link
            href="/terms"
            className="inline-flex min-h-11 items-center text-primary-ink underline-offset-2 hover:underline"
          >
            Terms
          </Link>
          <Link
            href="/privacy"
            className="inline-flex min-h-11 items-center text-primary-ink underline-offset-2 hover:underline"
          >
            Privacy notice
          </Link>
        </div>
      </Panel>
      <Panel>
        <SignOutButton size="sm" />
      </Panel>
    </SettingsPage>
  );
}
