import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CalendarPlus, ChevronLeft, FileText, Lock, PenLine, Upload } from 'lucide-react';
import { buttonVariants } from '@synkd/ui/components/button';
import { EmptyState, SourceBadge } from '@synkd/ui/components/misc';
import { StatusBadge } from '@synkd/ui/components/status-badge';
import { addDays, startOfWeek } from '@synkd/ui/lib/time';
import { Panel } from '@/components/app/page-header';
import { ScheduleGrid } from '@/components/calendar/schedule-grid';
import { CalendarToolbar, readCalendarParams } from '@/components/calendar/toolbar';
import {
  DeleteOfflineFriendButton,
  InviteToSynkdButton,
} from '@/components/offline-friends/offline-friend-actions';
import { EditOfflineFriendButton } from '@/components/offline-friends/offline-friend-form';
import {
  NotOnSynkdTag,
  OfflineAvatar,
  offlineManualHref,
  offlineUploadHref,
} from '@/components/offline-friends/offline-friend-row';
import { appUrl } from '@/lib/config';
import { getViewerRow } from '@/lib/data/now';
import {
  getOfflineFriend,
  getOfflineFriendRow,
  getOfflineFriendSchedule,
} from '@/lib/data/offline-friends';
import { getNow } from '@/lib/data/people';
import { describeOfflineStatus, OFFLINE_FRIEND_HOURS_LABEL } from '@/lib/offline-friends';
import { friendLinkUrl } from '@/lib/social/mappers';

export async function generateMetadata({
  params,
}: PageProps<'/friends/offline/[id]'>): Promise<Metadata> {
  const row = await getOfflineFriendRow((await params).id);
  return { title: row?.nickname ?? 'Not on synkd', robots: { index: false } };
}

// An offline friend's page (FR-SOC-17, FR-SOC-18, J8, WF-128): their status now, their day and
// week, and everything the viewer can do about them: edit, re-upload or type in their schedule,
// delete, and invite them to synkd (they can't be pinged). Only the viewer who added them can
// open it: anyone else's id is "not found" (FR-SOC-15). Finding a time with them waits for the
// slot finder (WF-098).
export default async function OfflineFriendPage({
  params,
  searchParams,
}: PageProps<'/friends/offline/[id]'>) {
  const { id } = await params;
  const [friend, { now, today, timeZone }, viewer] = await Promise.all([
    getOfflineFriend(id),
    getNow(),
    getViewerRow(),
  ]);
  if (!friend) notFound();

  const { view, date } = readCalendarParams(await searchParams, today);
  const dates =
    view === 'day' ? [date] : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(date), i));
  const { events, sources } = await getOfflineFriendSchedule(friend.id, dates);
  const s = describeOfflineStatus(friend, now, timeZone);
  const name = friend.nickname;
  const hasSchedule = sources.length > 0;

  return (
    <>
      <Link
        href="/friends"
        className="-ml-1 mb-3 inline-flex min-h-11 items-center gap-1 rounded-md pr-2 text-[13px] font-semibold text-muted-foreground hover:text-foreground md:min-h-8"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        Friends
      </Link>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <section className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-5 text-center md:p-6">
            <OfflineAvatar friend={friend} size="xl" status={s.tone} />
            <div className="flex flex-col items-center gap-1">
              <h1 className="text-xl font-bold tracking-[-0.02em]">{name}</h1>
              <NotOnSynkdTag />
              <StatusBadge tone={s.tone} className="mt-1 text-sm">
                {s.label}
              </StatusBadge>
              {s.detail ? <p className="text-xs text-muted-foreground">{s.detail}</p> : null}
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock aria-hidden="true" className="size-3.5" />
              Only you can see {name}. Free time counts {OFFLINE_FRIEND_HOURS_LABEL} each day.
            </p>
            <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-start">
              <InviteToSynkdButton link={friendLinkUrl(viewer.id, appUrl())} nickname={name} />
              <EditOfflineFriendButton
                friend={{ id: friend.id, nickname: name, emoji: friend.emoji }}
              />
            </div>
          </section>

          <section aria-labelledby="schedule-title" className="flex min-w-0 flex-col">
            <h2 id="schedule-title" className="sr-only">
              {name}&apos;s schedule
            </h2>
            {hasSchedule ? (
              <>
                <CalendarToolbar
                  path={`/friends/offline/${friend.id}` as Route}
                  view={view}
                  date={date}
                  today={today}
                />
                <ScheduleGrid
                  events={events}
                  dates={dates}
                  view={view}
                  today={today}
                  now={now}
                  timeZone={timeZone}
                  label={view === 'day' ? `${name}’s day` : `${name}’s week`}
                />
                {events.length === 0 ? (
                  <p className="mt-4 text-center text-sm text-muted-foreground">
                    Nothing on {view === 'day' ? 'this day' : 'this week'}. {name} shows as free
                    {OFFLINE_FRIEND_HOURS_LABEL}.
                  </p>
                ) : null}
              </>
            ) : (
              <EmptyState
                icon={CalendarPlus}
                title={`Add ${name}’s schedule`}
                action={<ScheduleLinks id={friend.id} hasSchedule={false} />}
              >
                Upload a photo or PDF of their timetable, or type it in. Then you&apos;ll see when
                they&apos;re free.
              </EmptyState>
            )}
          </section>
        </div>

        <aside className="flex flex-col gap-4">
          {hasSchedule ? (
            <Panel id="their-schedule" title="Their schedule">
              <ul className="mb-3 flex flex-col gap-2">
                {sources.map((src) => (
                  <li key={src.id ?? src.type} className="flex items-start gap-2.5">
                    <FileText aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" />
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        {src.label}
                        <SourceBadge source={src.type} className="border" />
                      </span>
                      <span className="text-xs text-muted-foreground">{src.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <ScheduleLinks id={friend.id} hasSchedule />
              <p className="mt-2 text-xs text-muted-foreground">
                A new schedule replaces the one you added before.
              </p>
            </Panel>
          ) : null}

          <section
            aria-label={`Delete ${name}`}
            className="flex flex-col gap-2 rounded-2xl border bg-card p-4"
          >
            <DeleteOfflineFriendButton id={friend.id} nickname={name} />
            <p className="text-xs text-muted-foreground">
              Deleting removes {name} and their schedule straight away.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}

/** Upload or type in their schedule (WF-127), through the import flow for this offline friend. */
function ScheduleLinks({ id, hasSchedule }: { id: string; hasSchedule: boolean }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Link
        href={offlineUploadHref(id)}
        className={buttonVariants({
          variant: hasSchedule ? 'outline' : 'default',
          size: 'sm',
          className: 'w-full sm:w-auto',
        })}
      >
        <Upload aria-hidden="true" />
        {hasSchedule ? 'Re-upload' : 'Upload their timetable'}
      </Link>
      <Link
        href={offlineManualHref(id)}
        className={buttonVariants({
          variant: 'outline',
          size: 'sm',
          className: 'w-full sm:w-auto',
        })}
      >
        <PenLine aria-hidden="true" />
        Type it in
      </Link>
    </div>
  );
}
