import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { after } from 'next/server';
import { ExternalLink, FileText, LoaderCircle, TriangleAlert } from 'lucide-react';
import { buttonVariants } from '@whosfree/ui/components/button';
import { EmptyState } from '@whosfree/ui/components/misc';
import { formatAgo, formatMonthDay, dateKey } from '@whosfree/ui/lib/time';
import { cn } from '@whosfree/ui/lib/utils';
import { PageHeader } from '@/components/app/page-header';
import {
  DeleteUploadButton,
  RetryParseButton,
  UploadsLive,
} from '@/components/import/delete-upload';
import { getPendingUploads, originalFileHref } from '@/lib/data/imports';
import { getNow, getViewer } from '@/lib/data/people';
import { canRetry, jobStateLabel, parseFailureMessage } from '@/lib/parse-messages';
import { dispatchParseJob, isStalledJob } from '@/lib/parse/runner';

export const metadata: Metadata = { title: 'Pending uploads' };

// Pending uploads (FR-IMP-16, WF-032, D38): files that haven't been confirmed yet, each with
// the date it's deleted, its parse state, and view / review / retry / delete. Confirmed files are
// deleted straight away, so they never show here. Live while a parse runs (FR-IMP-13). A parse
// left waiting (a lost dispatch, a restarted server) is started again on a visit (WF-131).
export default async function UploadsPage() {
  const [uploads, { now, timeZone }, viewer] = await Promise.all([
    getPendingUploads(),
    getNow(),
    getViewer(),
  ]);
  const stalled = uploads.flatMap((u) =>
    u.jobId &&
    u.jobStatus &&
    u.jobUpdatedAt &&
    isStalledJob({ status: u.jobStatus, updatedAt: u.jobUpdatedAt }, new Date(now))
      ? [u.jobId]
      : [],
  );
  if (stalled.length > 0) after(() => Promise.all(stalled.map((id) => dispatchParseJob(id))));
  return (
    <div className="mx-auto max-w-2xl">
      <UploadsLive viewerId={viewer.id} />
      <PageHeader
        title="Pending uploads"
        subtitle="Files you haven't confirmed yet. We delete each one automatically after 7 days."
        back={{ href: '/import', label: 'Add a schedule' }}
      />
      {uploads.length ? (
        <ul className="flex flex-col gap-3">
          {uploads.map((u) => {
            const importHref = (
              u.offlineFriend ? `/import?friend=${u.offlineFriend.id}` : '/import'
            ) as Route;
            const running = u.jobStatus === 'queued' || u.jobStatus === 'processing';
            return (
              <li
                key={u.id}
                className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center"
              >
                <FileText aria-hidden="true" className="size-5 shrink-0 text-primary-ink" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="truncate text-sm font-semibold">{u.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {u.offlineFriend ? `For ${u.offlineFriend.nickname} · ` : ''}
                    Uploaded {formatAgo(u.uploadedAt, now)} · deleted on{' '}
                    {formatMonthDay(dateKey(u.deleteAt, timeZone))}
                  </p>
                  {u.jobStatus === 'failed' ? (
                    <p className="flex items-start gap-1 text-xs font-semibold text-status-dnd-ink">
                      <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                      {parseFailureMessage(u.error)}
                    </p>
                  ) : (
                    <p
                      className={cn(
                        'flex items-center gap-1 text-xs font-semibold',
                        u.jobStatus === 'needs_review'
                          ? 'text-status-free-ink'
                          : 'text-muted-foreground',
                      )}
                    >
                      {running ? (
                        <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                      ) : null}
                      {jobStateLabel(u.jobStatus)}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {u.jobStatus === 'needs_review' && u.jobId ? (
                    <Link
                      href={`/import/${u.jobId}/review` as Route}
                      className={buttonVariants({ size: 'sm' })}
                    >
                      Review
                    </Link>
                  ) : u.jobStatus === 'failed' && canRetry(u.error) ? (
                    <RetryParseButton fileId={u.id} name={u.fileName} />
                  ) : !running ? (
                    <Link
                      href={importHref}
                      className={buttonVariants({ size: 'sm', variant: 'outline' })}
                    >
                      Try another file
                    </Link>
                  ) : null}
                  {u.jobStatus !== null ? (
                    <a
                      href={originalFileHref(u.id)}
                      target="_blank"
                      rel="noreferrer"
                      className={buttonVariants({ size: 'sm', variant: 'ghost' })}
                      aria-label={`View ${u.fileName}`}
                    >
                      <ExternalLink aria-hidden="true" />
                      View
                    </a>
                  ) : null}
                  <DeleteUploadButton id={u.id} name={u.fileName} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState icon={FileText} title="Nothing waiting">
          Files you upload show up here until you confirm them.
        </EmptyState>
      )}
    </div>
  );
}
