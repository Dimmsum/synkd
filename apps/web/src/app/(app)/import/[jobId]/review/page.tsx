import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/app/page-header';
import { ReviewEditor } from '@/components/import/review-editor';
import { getParseJob } from '@/lib/data/imports';

export const metadata: Metadata = { title: 'Review your schedule' };

// Review (WF-029); `/import/manual/review` is manual entry (WF-031).
export default async function ReviewPage({ params }: PageProps<'/import/[jobId]/review'>) {
  const job = await getParseJob((await params).jobId);
  if (!job) notFound();
  const manual = !job.fileName;
  return (
    <>
      <PageHeader
        title={manual ? 'Enter your schedule' : 'Check your schedule'}
        subtitle={
          manual
            ? 'Add the things that make you busy each week.'
            : 'Fix anything we got wrong, then confirm. It takes a couple of minutes.'
        }
        back={{ href: '/import', label: 'Add a schedule' }}
      />
      <ReviewEditor job={job} doneHref="/schedule" />
    </>
  );
}
