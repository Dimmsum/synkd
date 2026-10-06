'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { CalendarSearch, Share2, UserRoundPlus, UsersRound } from 'lucide-react';
import { buttonVariants } from '@synkd/ui/components/button';
import { EmptyState } from '@synkd/ui/components/misc';
import { GroupEmoji } from '@synkd/ui/components/person-avatar';
import { STATUS_TONES, StatusIcon, type StatusTone } from '@synkd/ui/components/status-badge';
import { dateKey, formatMonthDay, formatTime, weekdayShort } from '@synkd/ui/lib/time';
import { cn } from '@synkd/ui/lib/utils';
import { ConnectionRow } from '@/components/app/connection-row';
import { PageHeader, Panel } from '@/components/app/page-header';
import { OfflineFriendRow } from '@/components/offline-friends/offline-friend-row';
import { filterByGroup, freeNowByGroup, groupIntoNowSections } from '@/lib/now-sections';
import { sortOfflineFriends } from '@/lib/offline-friends';
import { presenceAt } from '@/lib/presence/clock';
import type { Connection, GroupSummary, OfflineFriendView } from '@/lib/types';
import { countOf } from '@/lib/plural';
import { useNowSignals, usePresenceClock, useRefetch } from './use-now-updates';

/** Opens "Add someone not on synkd" on the Friends page (WF-127, J8 step 1). */
const ADD_OFFLINE_HREF = '/friends?add=offline#not-on-synkd' as Route;

/**
 * The live part of the Now screen (FR-VIEW-1/2/3, PRD §8.5, WF-064): who's free right now and
 * until when, kept current by Realtime signals (re-fetch) and a local timer ("until X" passing).
 * `now` is the instant the server worked the statuses out at; `filter` is the group filter,
 * rendered on the server. `offlineFriends` are the people the viewer added who aren't on
 * synkd (WF-128), shown in their own section (null when they couldn't be read).
 */
export function NowBoard({
  viewerId,
  connections,
  offlineFriends,
  groups,
  groupId,
  now: serverNow,
  timeZone,
  filter,
}: {
  viewerId: string;
  connections: Connection[];
  offlineFriends: OfflineFriendView[] | null;
  groups: GroupSummary[];
  groupId: string | null;
  now: string;
  timeZone: string;
  filter: React.ReactNode;
}) {
  const refetch = useRefetch();
  useNowSignals(viewerId, refetch);
  // Offline friends' "until X" passes on the same timer as everyone else's.
  const timed = useMemo(
    () => [...connections, ...(offlineFriends ?? [])],
    [connections, offlineFriends],
  );
  const t = usePresenceClock(serverNow, timed, refetch);

  const now = new Date(t).toISOString();
  const today = dateKey(t, timeZone);
  const current = connections.map((c) => presenceAt(c, t));
  const sections = groupIntoNowSections(filterByGroup(current, groupId), new Date(t));
  const freeByGroup = freeNowByGroup(current);
  // Not in any group, so only without a group filter (FR-VIEW-2).
  const offline =
    offlineFriends && !groupId
      ? sortOfflineFriends(offlineFriends.map((f) => presenceAt(f, t)))
      : null;
  const offlineSection = offline ? (
    <NotOnSynkdSection friends={offline} now={now} timeZone={timeZone} />
  ) : null;
  const groupName = (id: string) => groups.find((g) => g.id === id)?.name;
  const contextFor = (c: Connection) =>
    c.isFriend ? undefined : `In ${c.groupIds.map(groupName).filter(Boolean).join(', ')}`;
  const row =
    (soon = false) =>
    (c: Connection) => (
      <ConnectionRow
        key={c.id}
        c={c}
        now={now}
        timeZone={timeZone}
        soon={soon}
        context={contextFor(c)}
      />
    );

  return (
    <>
      <PageHeader
        title="Now"
        subtitle={
          <>
            {weekdayShort(today)}, {formatMonthDay(today)} · {formatTime(now, timeZone)} ·{' '}
            <span className="font-semibold text-status-free-ink">
              {sections.freeNow.length} free right now
            </span>
          </>
        }
        actions={
          <Link href="/find-a-time" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <CalendarSearch aria-hidden="true" />
            Find a time
          </Link>
        }
      />

      {filter}

      {connections.length === 0 ? (
        <div className="flex flex-col gap-4">
          <EmptyState
            icon={UsersRound}
            title="None of your friends are here yet"
            action={
              <div className="flex flex-col gap-2 sm:flex-row">
                <Link href="/groups" className={buttonVariants()}>
                  <Share2 aria-hidden="true" />
                  Share your invite link
                </Link>
                {offline && offline.length === 0 ? (
                  <Link href={ADD_OFFLINE_HREF} className={buttonVariants({ variant: 'outline' })}>
                    <UserRoundPlus aria-hidden="true" />
                    Add a friend who isn&apos;t on synkd
                  </Link>
                ) : null}
              </div>
            }
          >
            Invite your crew and you&apos;ll see who&apos;s free right here. Or add a friend&apos;s
            timetable yourself while they haven&apos;t joined.
          </EmptyState>
          {offline?.length ? offlineSection : null}
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
          <div className="flex flex-col gap-4">
            <NowSection id="free-now" title="Free now" tone="free" people={sections.freeNow}>
              {row()}
            </NowSection>
            <NowSection
              id="free-soon"
              title="Free soon"
              hint="within 60 min"
              tone="soon"
              people={sections.freeSoon}
            >
              {row(true)}
            </NowSection>
            <NowSection id="busy" title="Busy or away" tone="busy" people={sections.busyAway}>
              {row()}
            </NowSection>
            <NowSection
              id="not-sharing"
              title="Not sharing yet"
              tone="no_schedule"
              people={sections.notSharing}
            >
              {row()}
            </NowSection>
            {offlineSection}
          </div>
          <GroupsRail groups={groups} freeByGroup={freeByGroup} />
        </div>
      )}
    </>
  );
}

function NowSection({
  id,
  title,
  hint,
  tone,
  people,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  tone: StatusTone;
  people: Connection[];
  children: (c: Connection) => React.ReactNode;
}) {
  return (
    <Panel
      id={id}
      title={
        <span className="flex items-center gap-2">
          <span
            className={cn(
              'flex size-6 items-center justify-center rounded-full',
              STATUS_TONES[tone].soft,
              STATUS_TONES[tone].ink,
            )}
          >
            <StatusIcon tone={tone} className="size-3.5" />
          </span>
          {title}
          {hint ? <span className="text-xs font-medium text-muted-foreground">{hint}</span> : null}
          <span className="ml-1 rounded-full bg-muted px-2 text-xs font-semibold text-muted-foreground">
            {people.length}
          </span>
        </span>
      }
      bodyClassName="px-2 md:px-3"
    >
      {people.length ? (
        <ul className="flex flex-col">{people.map(children)}</ul>
      ) : (
        <p className="px-2 pb-1 text-sm text-muted-foreground">Nobody right now.</p>
      )}
    </Panel>
  );
}

/**
 * "Not on synkd" (FR-SOC-17, J8 step 3, WF-128): the people the viewer added who aren't on
 * synkd, with their status and "until X" from their own schedule. Only the viewer sees it.
 * No Ping buttons: they can't be pinged.
 */
function NotOnSynkdSection({
  friends,
  now,
  timeZone,
}: {
  friends: OfflineFriendView[];
  now: string;
  timeZone: string;
}) {
  return (
    <Panel
      id="not-on-synkd"
      title={
        <span className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <UsersRound aria-hidden="true" className="size-3.5" />
          </span>
          Not on synkd
          <span className="ml-1 rounded-full bg-muted px-2 text-xs font-semibold text-muted-foreground">
            {friends.length}
          </span>
        </span>
      }
      action={
        <Link
          href={ADD_OFFLINE_HREF}
          className="inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-primary-ink underline-offset-2 hover:underline md:min-h-8"
        >
          <UserRoundPlus aria-hidden="true" className="size-4" />
          Add
          <span className="sr-only"> a friend who isn’t on synkd</span>
        </Link>
      }
      bodyClassName="px-2 md:px-3"
    >
      {friends.length ? (
        <ul className="flex flex-col">
          {friends.map((f) => (
            <OfflineFriendRow key={f.id} friend={f} now={now} timeZone={timeZone} />
          ))}
        </ul>
      ) : (
        <p className="px-2 pb-1 text-sm text-muted-foreground">
          Friends who haven&apos;t joined can still show up here. Add their timetable and
          you&apos;ll see when they&apos;re free. Only you can see them.
        </p>
      )}
    </Panel>
  );
}

function GroupsRail({
  groups,
  freeByGroup,
}: {
  groups: GroupSummary[];
  freeByGroup: Map<string, number>;
}) {
  return (
    <Panel id="groups-rail" title="Your groups" className="lg:sticky lg:top-6">
      <ul className="-mx-2 flex flex-col">
        {groups.map((g) => (
          <li key={g.id}>
            <Link
              href={`/groups/${g.id}`}
              className="flex min-h-12 items-center gap-3 rounded-xl px-2 hover:bg-background"
            >
              <GroupEmoji emoji={g.emoji} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold">{g.name}</span>
                <span className="text-xs text-muted-foreground">
                  {countOf(g.memberCount, 'member')} ·{' '}
                  <span className="font-semibold text-status-free-ink">
                    {freeByGroup.get(g.id) ?? 0} free
                  </span>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href="/find-a-time"
        className={buttonVariants({ variant: 'soft', className: 'mt-3 w-full' })}
      >
        <CalendarSearch aria-hidden="true" />
        Find a time for a group
      </Link>
    </Panel>
  );
}
