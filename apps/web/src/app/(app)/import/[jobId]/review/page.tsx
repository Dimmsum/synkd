import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { LoaderCircle, TriangleAlert } from 'lucide-react';
import { buttonVariants } from '@whosfree/ui/components/button';
import { PageHeader } from '@/components/app/page-header';
import { ReviewEditor } from '@/components/import/review-editor';
import { getOfflineFriendRef, getParseJob } from '@/lib/data/imports';
import { getScheduleToReplace } from '@/lib/data/schedule';
import { parseFailureMessage } from '@/lib/parse-messages';
import { MANUAL_JOB_ID } from '@/lib/schedule-draft';

export const metadata: Metadata = { title: 'Review your schedule' };

// Review (WF-029); `/import/manual/review` is manual entry (WF-031). Confirming replaces the
// current uploaded or typed-in schedule (WF-030), so the editor says which. An offline friend's
// schedule (WF-127): a parse job knows whose it is from its upload; manual entry takes
// `?friend=<offline friend id>`.
export default async function ReviewPage({
  params,
  searchParams,
}: PageProps<'/import/[jobId]/review'>) {
  const [{ jobId }, { friend }] = await Promise.all([params, searchParams]);
  const job = await getParseJob(jobId);
  if (!job) notFound();
  const manual = job.id === MANUAL_JOB_ID;

  const offlineFriend = manual
    ? typeof friend === 'string'
      ? await getOfflineFriendRef(friend)
      : null
    : (job.offlineFriend ?? null);
  if (manual && friend !== undefined && !offlineFriend) notFound();

  const doneHref: Route = offlineFriend ? '/friends' : '/schedule';
  if (job.status === 'committed') redirect(doneHref);

  const whose = offlineFriend ? `${offlineFriend.nickname}’s` : 'your';
  const back = {
    href: (offlineFriend ? `/import?friend=${offlineFriend.id}` : '/import') as Route,
    label: 'Add a schedule',
  };

  if (job.status !== 'needs_review') {
    const failed = job.status === 'failed';
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title={`Check ${whose} schedule`} back={back} />
        <div
          role={failed ? 'alert' : 'status'}
          className="flex flex-col gap-3 rounded-2xl border bg-card p-5"
        >
          <p className="flex items-start gap-2 text-sm font-semibold">
            {failed ? (
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 text-status-dnd-ink" />
            ) : (
              <LoaderCircle aria-hidden="true" className="mt-0.5 size-4 animate-spin" />
            )}
            {failed
              ? parseFailureMessage(job.error ?? null)
              : 'We’re still reading this file. It shows up in Pending uploads when it’s ready.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/uploads" className={buttonVariants({ size: 'sm' })}>
              Pending uploads
            </Link>
            <Link
              href={
                (offlineFriend
                  ? `/import/manual/review?friend=${offlineFriend.id}`
                  : '/import/manual/review') as Route
              }
              className={buttonVariants({ size: 'sm', variant: 'ghost' })}
            >
              Enter it by hand
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const replaces = await getScheduleToReplace(offlineFriend?.id ?? null);
  return (
    <>
      <PageHeader
        title={manual ? `Enter ${whose} schedule` : `Check ${whose} schedule`}
        subtitle={
          manual
            ? offlineFriend
              ? `Add the things that keep ${offlineFriend.nickname} busy each week.`
              : 'Add the things that make you busy each week.'
            : 'Fix anything we got wrong, then confirm. It takes a couple of minutes.'
        }
        back={back}
      />
      <ReviewEditor
        job={job}
        doneHref={doneHref}
        replaces={replaces}
        offlineFriend={offlineFriend}
      />
    </>
  );
}
