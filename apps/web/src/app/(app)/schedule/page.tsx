import type { Metadata } from 'next';
import Link from 'next/link';
import { PenLine, Upload } from 'lucide-react';
import { buttonVariants } from '@whosfree/ui/components/button';
import { SourceBadge } from '@whosfree/ui/components/misc';
import { addDays, startOfWeek } from '@whosfree/ui/lib/time';
import { PageHeader } from '@/components/app/page-header';
import { ScheduleGrid } from '@/components/calendar/schedule-grid';
import { CalendarToolbar, readCalendarParams } from '@/components/calendar/toolbar';
import { getNow } from '@/lib/data/people';
import { getMySchedule } from '@/lib/data/schedule';
import { formatPeriod, scheduleOutsideRange } from '@/lib/my-schedule';

export const metadata: Metadata = { title: 'My schedule' };

// My schedule (FR-VIEW-5, WF-065): the viewer's own events from every source, with a
// badge for where each came from. The viewer always sees their own titles.
export default async function SchedulePage({ searchParams }: PageProps<'/schedule'>) {
  const { now, today, timeZone } = await getNow();
  const { view, date } = readCalendarParams(await searchParams, today);
  const dates =
    view === 'day' ? [date] : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(date), i));
  const { events, periods } = await getMySchedule(dates);
  const outside = events.length === 0 ? scheduleOutsideRange(periods, dates) : null;

  return (
    <>
      <PageHeader
        title="My schedule"
        subtitle="Everything that makes you busy, from every source."
        actions={
          <>
            {/* Manual entry (FR-IMP-12, WF-031): build a schedule without a file. */}
            <Link
              href="/import/manual/review"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <PenLine aria-hidden="true" />
              Type it in
            </Link>
            <Link href="/import" className={buttonVariants({ size: 'sm' })}>
              <Upload aria-hidden="true" />
              Add a schedule
            </Link>
          </>
        }
      />
      <CalendarToolbar path="/schedule" view={view} date={date} today={today} />
      <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Sources:</span>
        <SourceBadge source="upload" className="border" />
        <SourceBadge source="manual" className="border" />
        <SourceBadge source="gcal" className="border" />
      </p>
      <ScheduleGrid
        events={events}
        dates={dates}
        view={view}
        today={today}
        now={now}
        timeZone={timeZone}
        label={view === 'day' ? 'Your day' : 'Your week'}
      />
      {outside ? (
        // The schedule exists but covers other dates (e.g. a file without a year, or next term).
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {outside.kind === 'upcoming'
            ? `Your schedule runs ${formatPeriod(outside.period)}, so nothing shows yet. `
            : `Your schedule ran ${formatPeriod(outside.period)} and has ended. `}
          <Link
            href={`/schedule?view=${view}&date=${outside.period.start}`}
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            Go to its first {view === 'day' ? 'day' : 'week'}
          </Link>
          {outside.kind === 'ended' ? (
            <>
              {' or '}
              <Link
                href="/import"
                className="font-semibold text-primary underline-offset-4 hover:underline"
              >
                add your current schedule
              </Link>
            </>
          ) : null}
          .
        </p>
      ) : events.length === 0 ? (
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Nothing on {view === 'day' ? 'this day' : 'this week'}. You show as free inside your
          available hours.
        </p>
      ) : null}
    </>
  );
}
