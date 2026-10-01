import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { PARSE_ATTEMPTS_PER_DAY } from '@whosfree/shared';
import { PageHeader } from '@/components/app/page-header';
import { UploadCard } from '@/components/import/upload-card';
import { getOfflineFriendRef } from '@/lib/data/imports';

export const metadata: Metadata = { title: 'Add a schedule' };

// Import (WF-026, WF-027). Re-upload any time (FR-IMP-17); 5 parses a day (FR-IMP-19, WF-035).
// `?friend=<offline friend id>` imports one of the viewer's offline friends' timetables instead
// (WF-127): the upload, its parse job and the confirm all carry them.
export default async function ImportPage({ searchParams }: PageProps<'/import'>) {
  const { friend } = await searchParams;
  const offlineFriend = typeof friend === 'string' ? await getOfflineFriendRef(friend) : null;
  if (friend !== undefined && !offlineFriend) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={offlineFriend ? `Add ${offlineFriend.nickname}’s schedule` : 'Add a schedule'}
        subtitle={
          offlineFriend
            ? `Upload ${offlineFriend.nickname}’s class timetable or work roster. We'll read it and you check it over.`
            : "Upload your class timetable or work roster. We'll read it and you check it over."
        }
        back={
          offlineFriend
            ? {
                href: `/friends/offline/${offlineFriend.id}` as Route,
                label: offlineFriend.nickname,
              }
            : { href: '/schedule', label: 'My schedule' }
        }
      />
      <UploadCard flow="import" offlineFriend={offlineFriend} />
      <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>
          We ignore rooms, addresses and ID numbers in the file and never store them. The file is
          deleted as soon as you confirm the schedule, or after 7 days if you don&apos;t. You can
          read up to {PARSE_ATTEMPTS_PER_DAY} files a day.{' '}
          <Link
            href="/uploads"
            className="font-semibold text-primary-ink underline-offset-2 hover:underline"
          >
            Pending uploads
          </Link>
        </span>
      </p>
    </div>
  );
}
