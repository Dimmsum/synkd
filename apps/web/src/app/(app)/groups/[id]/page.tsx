import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CalendarSearch, Settings } from 'lucide-react';
import { buttonVariants } from '@whosfree/ui/components/button';
import { AvatarStack, GroupEmoji, PersonAvatar } from '@whosfree/ui/components/person-avatar';
import { StatusBadge, STATUS_TONES } from '@whosfree/ui/components/status-badge';
import {
  formatClockRange,
  formatDayLabel,
  formatDuration,
  formatMonthDay,
  formatTime,
  minutesIntoDay,
  weekdayShort,
} from '@whosfree/ui/lib/time';
import { Panel } from '@/components/app/page-header';
import { PingButton } from '@/components/app/ping-dialog';
import { GroupDay } from '@/components/calendar/group-day';
import { defaultMinFree, minFreeChoices, OverlapWeek } from '@/components/calendar/overlap-week';
import { CalendarToolbar, readCalendarParams } from '@/components/calendar/toolbar';
import {
  getGroup,
  getGroupDay,
  getGroupUpcomingSlots,
  getGroupWeek,
  getNow,
} from '@/lib/data/people';
import { describeStatus } from '@/lib/status';

export async function generateMetadata({ params }: PageProps<'/groups/[id]'>): Promise<Metadata> {
  const group = await getGroup((await params).id);
  return { title: group?.name ?? 'Group' };
}

// Group calendar (FR-VIEW-6, WF-066), modelled on the design's Calendar page. Day view:
// one column per member at their tier. Week view: the design's overlap style only.
export default async function GroupPage({ params, searchParams }: PageProps<'/groups/[id]'>) {
  const { id } = await params;
  const [group, { now, today, timeZone }] = await Promise.all([getGroup(id), getNow()]);
  if (!group) notFound();

  const sp = await searchParams;
  const { view, date } = readCalendarParams(sp, today, 'week');
  const nowMinute = minutesIntoDay(now, timeZone);
  // Safe: `id` belongs to a group the viewer is in (checked above).
  const path = `/groups/${id}` as Route;
  const [week, day, slots] = await Promise.all([
    view === 'week' ? getGroupWeek(id, date) : null,
    view === 'day' ? getGroupDay(id, date) : null,
    getGroupUpcomingSlots(id),
  ]);

  const statusText = new Map(
    group.members.map((m) => [m.id, describeStatus(m, now, timeZone)] as const),
  );
  const total = week?.people.length ?? 0;
  const minRaw = Number(sp.free);
  const minFree = minFreeChoices(total).includes(minRaw) ? minRaw : defaultMinFree(total);
  const nextAll = slots.find((s) => s.missing.length === 0);
  // Best slot per day (slots are already ranked), then the top three days.
  const bestDays = slots
    .filter((s, i) => slots.findIndex((x) => x.date === s.date) === i)
    .slice(0, 3);

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
              {group.memberCount} members ·{' '}
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

      <CalendarToolbar path={path} view={view} date={date} today={today} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start">
        <section className="overflow-hidden rounded-2xl border bg-card" aria-label="Group calendar">
          {week ? (
            <OverlapWeek
              week={week}
              today={today}
              nowMinute={nowMinute}
              minFree={minFree}
              path={path}
            />
          ) : null}
          {day ? (
            <GroupDay
              members={day.members}
              busy={day.busy}
              nowMinute={date === today ? nowMinute : null}
              status={
                new Map(
                  group.members.map((m) => {
                    const t = statusText.get(m.id);
                    const word =
                      t?.tone === 'free' ? 'Free now' : STATUS_TONES[t?.tone ?? 'busy'].word;
                    return [
                      m.id,
                      { tone: t?.tone ?? 'busy', word: m.isViewer ? `You · ${word}` : word },
                    ];
                  }),
                )
              }
            />
          ) : null}
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

          <section
            aria-labelledby="next-all"
            className="rounded-2xl border border-overlap-few-border bg-overlap-few p-4 md:p-5"
          >
            <h2
              id="next-all"
              className="text-[11px] font-semibold tracking-[0.06em] text-overlap-few-ink uppercase"
            >
              Next time everyone’s free
            </h2>
            {nextAll ? (
              <>
                <p className="mt-2 text-2xl font-bold tracking-[-0.02em]">
                  {formatClockRange(nextAll.start, nextAll.end)}
                </p>
                <p className="text-[13.5px] text-body-foreground">
                  {formatDayLabel(nextAll.date, today)}, {formatMonthDay(nextAll.date)} ·{' '}
                  {formatDuration(nextAll.end - nextAll.start)}
                </p>
                <AvatarStack people={nextAll.free} size="md" max={8} className="mt-3" />
                <Link
                  href={{ pathname: '/find-a-time', query: { group: id } }}
                  className={buttonVariants({ className: 'mt-4 w-full' })}
                >
                  Share this time
                </Link>
              </>
            ) : (
              <p className="mt-2 text-sm text-body-foreground">
                No time this week works for everyone. Try Find a time with fewer people.
              </p>
            )}
          </section>

          <Panel id="best-times" title="Best times this week">
            {bestDays.length ? (
              <ul className="flex flex-col gap-3">
                {bestDays.map((s) => (
                  <li key={s.date} className="flex items-center gap-3">
                    <span className="flex w-10 flex-col items-center rounded-lg bg-background py-1">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                        {weekdayShort(s.date)}
                      </span>
                      <span className="text-base font-bold">{Number(s.date.slice(8))}</span>
                    </span>
                    <span className="flex flex-col">
                      <span className="text-sm font-semibold">
                        {formatClockRange(s.start, s.end)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {s.missing.length === 0
                          ? 'Everyone free'
                          : `All but ${s.missing.map((p) => p.name.split(' ')[0]).join(', ')}`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing lines up this week.</p>
            )}
          </Panel>
        </aside>
      </div>
    </>
  );
}
