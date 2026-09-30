import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { FileText, TriangleAlert } from 'lucide-react';
import { buttonVariants } from '@whosfree/ui/components/button';
import { EmptyState } from '@whosfree/ui/components/misc';
import { formatAgo, formatMonthDay, dateKey } from '@whosfree/ui/lib/time';
import { PageHeader } from '@/components/app/page-header';
import { DeleteUploadButton } from '@/components/import/delete-upload';
import { getPendingUploads } from '@/lib/data/imports';
import { getNow } from '@/lib/data/people';

export const metadata: Metadata = { title: 'Pending uploads' };

// Pending uploads (FR-IMP-16, WF-032): unconfirmed files and when each will be deleted.
export default async function UploadsPage() {
  const [uploads, { now, timeZone }] = await Promise.all([getPendingUploads(), getNow()]);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Pending uploads"
        subtitle="Files you haven't confirmed yet. We delete each one automatically after 7 days."
        back={{ href: '/import', label: 'Add a schedule' }}
      />
      {uploads.length ? (
        <ul className="flex flex-col gap-3">
          {uploads.map((u) => (
            <li
              key={u.id}
              className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center"
            >
              <FileText aria-hidden="true" className="size-5 shrink-0 text-primary-ink" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="truncate text-sm font-semibold">{u.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  Uploaded {formatAgo(u.uploadedAt, now)} · deleted on{' '}
                  {formatMonthDay(dateKey(u.deleteAt, timeZone))}
                </p>
                {u.jobStatus === 'failed' ? (
                  <p className="flex items-center gap-1 text-xs font-semibold text-status-dnd-ink">
                    <TriangleAlert aria-hidden="true" className="size-3.5" /> {u.error}
                  </p>
                ) : (
                  <p className="text-xs font-semibold text-status-free-ink">Ready to review</p>
                )}
              </div>
              <div className="flex gap-2">
                {u.jobStatus === 'needs_review' ? (
                  <Link
                    href={`/import/${u.jobId}/review` as Route}
                    className={buttonVariants({ size: 'sm' })}
                  >
                    Review
                  </Link>
                ) : (
                  <Link
                    href="/import"
                    className={buttonVariants({ size: 'sm', variant: 'outline' })}
                  >
                    Try another file
                  </Link>
                )}
                <DeleteUploadButton id={u.id} name={u.fileName} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={FileText} title="Nothing waiting">
          Files you upload show up here until you confirm them.
        </EmptyState>
      )}
    </div>
  );
}
