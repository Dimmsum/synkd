'use client';

import Link from 'next/link';
import { CalendarSearch, Share2, UsersRound } from 'lucide-react';
import { buttonVariants } from '@whosfree/ui/components/button';
import { EmptyState } from '@whosfree/ui/components/misc';
import { GroupEmoji } from '@whosfree/ui/components/person-avatar';
import { STATUS_TONES, StatusIcon, type StatusTone } from '@whosfree/ui/components/status-badge';
import { dateKey, formatMonthDay, formatTime, weekdayShort } from '@whosfree/ui/lib/time';
import { cn } from '@whosfree/ui/lib/utils';
import { ConnectionRow } from '@/components/app/connection-row';
import { PageHeader, Panel } from '@/components/app/page-header';
import { filterByGroup, freeNowByGroup, groupIntoNowSections } from '@/lib/now-sections';
import { presenceAt } from '@/lib/presence/clock';
import type { Connection, GroupSummary } from '@/lib/types';
import { useNowSignals, usePresenceClock, useRefetch } from './use-now-updates';

/**
 * The live part of the Now screen (FR-VIEW-1/2/3, PRD §8.5, WF-064): who's free right now and
 * until when, kept current by Realtime signals (re-fetch) and a local timer ("until X" passing).
 * `now` is the instant the server worked the statuses out at; `filter` is the group filter,
 * rendered on the server.
 */
export function NowBoard({
  viewerId,
  connections,
  groups,
  groupId,
  now: serverNow,
  timeZone,
  filter,
}: {
  viewerId: string;
  connections: Connection[];
  groups: GroupSummary[];
  groupId: string | null;
  now: string;
  timeZone: string;
  filter: React.ReactNode;
}) {
  const refetch = useRefetch();
  useNowSignals(viewerId, refetch);
  const t = usePresenceClock(serverNow, connections, refetch);

  const now = new Date(t).toISOString();
  const today = dateKey(t, timeZone);
  const current = connections.map((c) => presenceAt(c, t));
  const sections = groupIntoNowSections(filterByGroup(current, groupId), new Date(t));
  const freeByGroup = freeNowByGroup(current);
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
        <EmptyState
          icon={UsersRound}
          title="None of your friends are here yet"
          action={
            <Link href="/groups" className={buttonVariants()}>
              <Share2 aria-hidden="true" />
              Share your invite link
            </Link>
          }
        >
          Invite your crew and you&apos;ll see who&apos;s free right here.
        </EmptyState>
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
                  {g.memberCount} members ·{' '}
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
