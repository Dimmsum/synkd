import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Ban, CalendarSearch, ChevronLeft, UserMinus } from 'lucide-react';
import { TIER_LABELS } from '@whosfree/shared';
import { buttonVariants } from '@whosfree/ui/components/button';
import { GroupEmoji, PersonAvatar } from '@whosfree/ui/components/person-avatar';
import { StaleWarning } from '@whosfree/ui/components/misc';
import { StatusBadge } from '@whosfree/ui/components/status-badge';
import { TierBadge } from '@whosfree/ui/components/tier-picker';
import {
  formatClockRange,
  formatDayLabel,
  formatDuration,
  formatMonthDay,
  minutesIntoDay,
} from '@whosfree/ui/lib/time';
import { Panel } from '@/components/app/page-header';
import { PingButton } from '@/components/app/ping-dialog';
import { FriendDangerZone } from '@/components/friends/friend-danger-zone';
import { DayBar } from '@/components/friends/day-bar';
import { FriendTierForm } from '@/components/friends/friend-tier-form';
import { getFriend, getNow } from '@/lib/data/people';
import { describeStatus } from '@/lib/status';

export async function generateMetadata({ params }: PageProps<'/friends/[id]'>): Promise<Metadata> {
  const f = await getFriend((await params).id);
  return { title: f?.person.name ?? 'Friend' };
}

// Friend detail (FR-VIEW-4, WF-065): today and tomorrow at the viewer's tier.
export default async function FriendPage({ params }: PageProps<'/friends/[id]'>) {
  const { id } = await params;
  const [friend, { now, today, timeZone }] = await Promise.all([getFriend(id), getNow()]);
  if (!friend) notFound();
  const p = friend.person;
  const first = p.name.split(' ')[0] ?? p.name;
  const s = describeStatus(p, now, timeZone);
  const nowMinute = minutesIntoDay(now, timeZone);

  return (
    <>
      <Link
        href="/friends"
        className="-ml-1 mb-3 inline-flex min-h-11 items-center gap-1 rounded-md pr-2 text-[13px] font-semibold text-muted-foreground hover:text-foreground md:min-h-8"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        Friends
      </Link>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="flex flex-col gap-4">
          <section className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-5 text-center md:p-6">
            <PersonAvatar name={p.name} hue={p.hue} size="xl" status={s.tone} />
            <div className="flex flex-col items-center gap-1">
              <h1 className="text-xl font-bold tracking-[-0.02em]">{p.name}</h1>
              <p className="text-sm text-muted-foreground">@{p.handle}</p>
              <StatusBadge tone={s.tone} className="mt-1 text-sm">
                {s.label}
              </StatusBadge>
              {s.detail ? <p className="text-xs text-muted-foreground">{s.detail}</p> : null}
              {p.stale ? <StaleWarning /> : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {first} shows you: <TierBadge tier={p.tier} />
            </p>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              {p.status !== 'no_schedule' ? (
                <PingButton
                  target={{
                    kind: 'person',
                    id: p.id,
                    name: p.name,
                    status: p.status,
                    statusLabel: s.label,
                  }}
                  variant="default"
                  size="default"
                  className="w-full sm:w-auto"
                />
              ) : null}
              <Link
                href={{ pathname: '/find-a-time', query: { people: p.id } }}
                className={buttonVariants({ variant: 'outline', className: 'w-full sm:w-auto' })}
              >
                <CalendarSearch aria-hidden="true" />
                Find a time together
              </Link>
            </div>
          </section>

          <Panel id="timeline" title={`${first}’s day`}>
            <div className="flex flex-col gap-6">
              {friend.timeline.map((d, i) => (
                <DayBar
                  key={d.date}
                  day={d}
                  label={formatDayLabel(d.date, today)}
                  nowMinute={i === 0 ? nowMinute : null}
                />
              ))}
            </div>
          </Panel>
        </div>

        <aside className="flex flex-col gap-4">
          <Panel id="both-free" title="You’re both free">
            {friend.freeTogether.length ? (
              <ul className="flex flex-col gap-2">
                {friend.freeTogether.map((w) => (
                  <li
                    key={`${w.date}-${w.start}`}
                    className="rounded-xl border border-overlap-few-border bg-overlap-few px-3.5 py-2.5"
                  >
                    <p className="text-sm font-semibold">
                      {formatDayLabel(w.date, today)} · {formatClockRange(w.start, w.end)}
                    </p>
                    <p className="text-xs text-body-foreground">
                      {formatMonthDay(w.date)} · {formatDuration(w.end - w.start)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {p.status === 'no_schedule' || p.status === 'paused'
                  ? `${first} isn’t sharing a schedule yet.`
                  : 'No shared free time this week.'}
              </p>
            )}
          </Panel>

          {friend.sharedGroups.length ? (
            <Panel id="shared-groups" title="Shared groups">
              <ul className="flex flex-wrap gap-2">
                {friend.sharedGroups.map((g) => (
                  <li key={g.id}>
                    <Link
                      href={`/groups/${g.id}`}
                      className="flex min-h-11 items-center gap-2 rounded-full border bg-card py-1 pr-3 pl-1 text-[13px] font-semibold hover:bg-accent md:min-h-9"
                    >
                      <GroupEmoji emoji={g.emoji} size="sm" className="rounded-full" />
                      {g.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel id="they-see" title={`What ${first} sees of you`}>
            <FriendTierForm
              personId={p.id}
              firstName={first}
              initial={friend.viewerTierForThem}
              groupFallback={
                friend.groupTier
                  ? `Now: ${TIER_LABELS[friend.groupTier.tier]}, because you’re both in ${friend.groupTier.groupName}.`
                  : `Now: ${TIER_LABELS[1]} (the default).`
              }
            />
          </Panel>

          <FriendDangerZone
            personId={p.id}
            firstName={first}
            icons={{ remove: <UserMinus aria-hidden="true" />, block: <Ban aria-hidden="true" /> }}
          />
        </aside>
      </div>
    </>
  );
}
