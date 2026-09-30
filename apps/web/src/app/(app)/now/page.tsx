import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarSearch, Share2, UsersRound } from 'lucide-react';
import { buttonVariants } from '@whosfree/ui/components/button';
import { EmptyState } from '@whosfree/ui/components/misc';
import { GroupEmoji } from '@whosfree/ui/components/person-avatar';
import { STATUS_TONES, StatusIcon, type StatusTone } from '@whosfree/ui/components/status-badge';
import { formatTime, weekdayShort, formatMonthDay } from '@whosfree/ui/lib/time';
import { cn } from '@whosfree/ui/lib/utils';
import { ConnectionRow } from '@/components/app/connection-row';
import { PageHeader, Panel } from '@/components/app/page-header';
import { getNow, getNowForViewer } from '@/lib/data/people';
import { filterByGroup, groupIntoNowSections } from '@/lib/now-sections';
import type { Connection, GroupSummary } from '@/lib/types';

export const metadata: Metadata = { title: 'Now' };

// The Now screen (FR-VIEW-1/2, WF-064): who's free right now and until when.
// TODO(WF-064): a client wrapper subscribes to Realtime "changed" signals and re-fetches,
// and a timer re-evaluates "until X" boundaries without polling (§8.5).
export default async function NowPage({ searchParams }: PageProps<'/now'>) {
  const { group } = await searchParams;
  const [{ connections, groups }, { now, today, timeZone }] = await Promise.all([
    getNowForViewer(),
    getNow(),
  ]);
  const groupId = typeof group === 'string' && groups.some((g) => g.id === group) ? group : null;
  const visible = filterByGroup(connections, groupId);
  const sections = groupIntoNowSections(visible, new Date(now));
  const groupName = (id: string) => groups.find((g) => g.id === id)?.name;
  const contextFor = (c: Connection) =>
    c.isFriend ? undefined : `In ${c.groupIds.map(groupName).filter(Boolean).join(', ')}`;

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

      <GroupFilter groups={groups} active={groupId} />

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
              {(c) => (
                <ConnectionRow
                  key={c.id}
                  c={c}
                  now={now}
                  timeZone={timeZone}
                  context={contextFor(c)}
                />
              )}
            </NowSection>
            <NowSection
              id="free-soon"
              title="Free soon"
              hint="within 60 min"
              tone="soon"
              people={sections.freeSoon}
            >
              {(c) => (
                <ConnectionRow
                  key={c.id}
                  c={c}
                  now={now}
                  timeZone={timeZone}
                  soon
                  context={contextFor(c)}
                />
              )}
            </NowSection>
            <NowSection id="busy" title="Busy or away" tone="busy" people={sections.busyAway}>
              {(c) => (
                <ConnectionRow
                  key={c.id}
                  c={c}
                  now={now}
                  timeZone={timeZone}
                  context={contextFor(c)}
                />
              )}
            </NowSection>
            <NowSection
              id="not-sharing"
              title="Not sharing yet"
              tone="no_schedule"
              people={sections.notSharing}
            >
              {(c) => (
                <ConnectionRow
                  key={c.id}
                  c={c}
                  now={now}
                  timeZone={timeZone}
                  context={contextFor(c)}
                />
              )}
            </NowSection>
          </div>
          <GroupsRail groups={groups} />
        </div>
      )}
    </>
  );
}

function GroupFilter({ groups, active }: { groups: GroupSummary[]; active: string | null }) {
  const chip = (isActive: boolean) =>
    cn(
      'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-[13px] font-semibold transition-colors md:min-h-9',
      isActive
        ? 'border-foreground bg-foreground text-background'
        : 'bg-card text-body-foreground hover:bg-accent',
    );
  return (
    <nav aria-label="Filter by group" className="-mx-4 mb-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex w-max gap-2">
        <li>
          <Link href="/now" className={chip(!active)} aria-current={!active ? 'true' : undefined}>
            Everyone
          </Link>
        </li>
        {groups.map((g) => (
          <li key={g.id}>
            <Link
              href={`/now?group=${g.id}`}
              className={chip(active === g.id)}
              aria-current={active === g.id ? 'true' : undefined}
            >
              <span aria-hidden="true">{g.emoji}</span>
              {g.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
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

function GroupsRail({ groups }: { groups: GroupSummary[] }) {
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
                  <span className="font-semibold text-status-free-ink">{g.freeNowCount} free</span>
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
