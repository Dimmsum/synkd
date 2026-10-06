import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { PenLine, Upload, UserRound } from 'lucide-react';
import { TIER_LABELS } from '@synkd/shared';
import { buttonVariants } from '@synkd/ui/components/button';
import { SourceBadge } from '@synkd/ui/components/misc';
import { PersonAvatar } from '@synkd/ui/components/person-avatar';
import { addDays, startOfWeek } from '@synkd/ui/lib/time';
import { PageHeader } from '@/components/app/page-header';
import { ConnectionScheduleSection } from '@/components/calendar/connection-schedule';
import { PersonSwitcher, type SwitcherPerson } from '@/components/calendar/person-switcher';
import { ScheduleGrid } from '@/components/calendar/schedule-grid';
import {
  CalendarToolbar,
  readCalendarParams,
  type CalendarView,
} from '@/components/calendar/toolbar';
import { OfflineAvatar, offlineFriendHref } from '@/components/offline-friends/offline-friend-row';
import { getConnectionSchedule } from '@/lib/data/connection-schedule';
import { getOfflineFriendSchedule, listOfflineFriends } from '@/lib/data/offline-friends';
import { getNow, getViewer } from '@/lib/data/people';
import { getMySchedule } from '@/lib/data/schedule';
import { listFriends } from '@/lib/data/social';
import { hueFor } from '@/lib/hue';
import { formatPeriod, scheduleOutsideRange } from '@/lib/my-schedule';
import { OFFLINE_FRIEND_HOURS_LABEL } from '@/lib/offline-friends';

export const metadata: Metadata = { title: 'My schedule' };

const PATH = '/schedule' as Route;

// My schedule (FR-VIEW-5, WF-065): the viewer's own events from every source, with a badge for
// where each came from (the viewer always sees their own titles). The person switcher shows a
// friend's day or week instead, at the viewer's tier (FR-VIEW-4), or an offline friend's in full
// (WF-128, only the viewer can see them). `?person=` that isn't one of them shows your own.
export default async function SchedulePage({ searchParams }: PageProps<'/schedule'>) {
  const params = await searchParams;
  const [{ now, today, timeZone }, viewer, friends, offline] = await Promise.all([
    getNow(),
    getViewer(),
    listFriends(),
    listOfflineFriends(),
  ]);
  const { view, date } = readCalendarParams(params, today);
  const dates =
    view === 'day' ? [date] : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(date), i));
  const person = typeof params.person === 'string' ? params.person : null;
  const friend = friends.find((f) => f.user_id === person);
  const offlineFriend = friend ? undefined : offline.find((o) => o.id === person);

  const people: SwitcherPerson[] = [
    {
      id: null,
      name: 'You',
      avatar: <PersonAvatar name={viewer.name} hue={viewer.hue} size="sm" />,
    },
    ...friends.map((f) => ({
      id: f.user_id,
      name: f.name.split(' ')[0] ?? f.name,
      avatar: <PersonAvatar name={f.name} hue={hueFor(f.user_id)} size="sm" />,
    })),
    ...offline.map((o) => ({
      id: o.id,
      name: o.nickname,
      avatar: <OfflineAvatar friend={o} size="sm" />,
    })),
  ];
  const switcher =
    people.length > 1 ? (
      <PersonSwitcher
        path={PATH}
        people={people}
        selected={friend?.user_id ?? offlineFriend?.id ?? null}
        view={view}
        date={date}
      />
    ) : null;
  const calendar = { view, date, dates, today, now, timeZone };

  if (friend) {
    const first = friend.name.split(' ')[0] ?? friend.name;
    const schedule = await getConnectionSchedule(friend.user_id, dates);
    return (
      <>
        <PageHeader
          title={`${first}’s schedule`}
          subtitle={
            schedule
              ? `${first} shows you: ${TIER_LABELS[schedule.tier]}`
              : 'Their schedule isn’t available.'
          }
          actions={<ProfileLink href={`/friends/${friend.user_id}` as Route} />}
        />
        {switcher}
        {schedule ? (
          <ConnectionScheduleSection
            schedule={schedule}
            firstName={first}
            path={PATH}
            extra={{ person: friend.user_id }}
            {...calendar}
          />
        ) : null}
      </>
    );
  }

  if (offlineFriend) {
    const name = offlineFriend.nickname;
    const { events } = await getOfflineFriendSchedule(offlineFriend.id, dates);
    return (
      <>
        <PageHeader
          title={`${name}’s schedule`}
          subtitle={`Only you can see ${name}. Free time counts ${OFFLINE_FRIEND_HOURS_LABEL} each day.`}
          actions={<ProfileLink href={offlineFriendHref(offlineFriend.id)} />}
        />
        {switcher}
        <CalendarToolbar
          path={PATH}
          view={view}
          date={date}
          today={today}
          extra={{ person: offlineFriend.id }}
        />
        <ScheduleGrid
          events={events}
          {...calendar}
          label={view === 'day' ? `${name}’s day` : `${name}’s week`}
        />
        {events.length === 0 ? (
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Nothing on {view === 'day' ? 'this day' : 'this week'}. {name} shows as free
            {OFFLINE_FRIEND_HOURS_LABEL}.
          </p>
        ) : null}
      </>
    );
  }

  return <OwnSchedule switcher={switcher} {...calendar} />;
}

function ProfileLink({ href }: { href: Route }) {
  return (
    <Link href={href} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
      <UserRound aria-hidden="true" />
      Profile
    </Link>
  );
}

async function OwnSchedule({
  switcher,
  view,
  date,
  dates,
  today,
  now,
  timeZone,
}: {
  switcher: React.ReactNode;
  view: CalendarView;
  date: string;
  dates: string[];
  today: string;
  now: string;
  timeZone: string;
}) {
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
      {switcher}
      <CalendarToolbar path={PATH} view={view} date={date} today={today} />
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
