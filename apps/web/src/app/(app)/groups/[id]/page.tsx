import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CalendarDays, CalendarSearch, Settings } from 'lucide-react';
import { buttonVariants } from '@whosfree/ui/components/button';
import { GroupEmoji, PersonAvatar } from '@whosfree/ui/components/person-avatar';
import { StatusBadge } from '@whosfree/ui/components/status-badge';
import { formatTime } from '@whosfree/ui/lib/time';
import { ComingSoon } from '@/components/app/coming-soon';
import { Panel } from '@/components/app/page-header';
import { PingButton } from '@/components/app/ping-dialog';
import { getGroup, getNow } from '@/lib/data/people';
import { describeStatus } from '@/lib/status';
import { countOf } from '@/lib/plural';

export async function generateMetadata({ params }: PageProps<'/groups/[id]'>): Promise<Metadata> {
  const group = await getGroup((await params).id);
  return { title: group?.name ?? 'Group' };
}

// Group page (FR-VIEW-6), modelled on the design's Calendar page: who's in the group and their
// status now. The group calendar and the free-time panels say they're coming instead of
// showing results until their data lands (WF-134).
// TODO(WF-066): the calendar (day view: one column per member at their tier; week view: the
// design's overlap style only), with the toolbar to switch between them.
// TODO(WF-098): "Next time everyone's free" and "Best times this week" from the slot finder.
export default async function GroupPage({ params }: PageProps<'/groups/[id]'>) {
  const { id } = await params;
  const [group, { now, timeZone }] = await Promise.all([getGroup(id), getNow()]);
  if (!group) notFound();

  const statusText = new Map(
    group.members.map((m) => [m.id, describeStatus(m, now, timeZone)] as const),
  );

  return (
    <>
      <header className="mb-5 flex flex-col gap-3">
        <Link
          href="/groups"
          className="-ml-1 inline-flex min-h-11 w-fit items-center rounded-md pr-2 text-[13px] font-semibold text-muted-foreground hover:text-foreground md:min-h-8"
        >
          ‹ Groups
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <GroupEmoji emoji={group.emoji} size="lg" />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-[-0.02em]">{group.name}</h1>
              {/* Every member can set their own tier there; admins get more options. */}
              <Link
                href={`/groups/${id}/settings`}
                className={buttonVariants({ variant: 'outline', size: 'sm', className: 'md:h-7' })}
              >
                <Settings aria-hidden="true" />
                Manage
              </Link>
            </div>
            <p className="text-[13.5px] text-muted-foreground">
              {countOf(group.memberCount, 'member')} ·{' '}
              <span className="font-semibold text-status-free-ink">
                {group.freeNowCount} free right now
              </span>
              {group.viewerRole === 'admin' ? ' · You’re the admin' : null}
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
            {group.viewerPermissions.groupPing ? (
              <PingButton
                target={{ kind: 'group', id, name: group.name, freeCount: group.freeNowCount }}
                label="Ping free members"
                variant="outline"
              />
            ) : null}
            <Link
              href={{ pathname: '/find-a-time', query: { group: id } }}
              className={buttonVariants({ size: 'sm' })}
            >
              <CalendarSearch aria-hidden="true" />
              Find a time
            </Link>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start">
        <section className="overflow-hidden rounded-2xl border bg-card" aria-label="Group calendar">
          <ComingSoon
            icon={CalendarDays}
            title="The group calendar is coming soon"
            className="border-0"
          >
            You’ll see everyone’s week side by side, and the times you’re all free.
          </ComingSoon>
        </section>

        <aside className="flex flex-col gap-4" aria-label="Group summary">
          <Panel
            id="right-now"
            title="Right now"
            action={
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-1.5 rounded-full bg-now-line" aria-hidden="true" />
                Live · {formatTime(now, timeZone)}
              </span>
            }
          >
            <ul className="flex flex-col gap-2.5">
              {group.members.map((m) => {
                const s = statusText.get(m.id)!;
                return (
                  <li key={m.id} className="flex items-center gap-2.5">
                    <PersonAvatar name={m.name} hue={m.hue} status={s.tone} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[13.5px] font-semibold">
                        {m.isViewer ? 'You' : m.name}
                      </span>
                      <StatusBadge tone={s.tone} className="text-xs">
                        {s.label}
                      </StatusBadge>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </aside>
      </div>
    </>
  );
}
