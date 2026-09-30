import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { UploadCard } from '@/components/import/upload-card';

export const metadata: Metadata = { title: 'Add a schedule' };

// Import (WF-026). Re-upload any time (FR-IMP-17). TODO(WF-035): 5 parses a day.
export default function ImportPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Add a schedule"
        subtitle="Upload your class timetable or work roster. We'll read it and you check it over."
        back={{ href: '/schedule', label: 'My schedule' }}
      />
      <UploadCard flow="import" />
      <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        We ignore rooms, addresses and ID numbers in your file and never store them. The file is
        deleted as soon as you confirm your schedule, or after 7 days if you don&apos;t.{' '}
        <Link
          href="/uploads"
          className="font-semibold text-primary-ink underline-offset-2 hover:underline"
        >
          Pending uploads
        </Link>
      </p>
    </div>
  );
}
