import type { Metadata, Route } from 'next';
import { CalendarSearch, CircleCheck, UserX } from 'lucide-react';
import { Button } from '@whosfree/ui/components/button';
import { EmptyState } from '@whosfree/ui/components/misc';
import { AvatarStack } from '@whosfree/ui/components/person-avatar';
import {
  formatClockRange,
  formatDayLabel,
  formatDuration,
  formatMonthDay,
  minutesIntoDay,
} from '@whosfree/ui/lib/time';
import { cn } from '@whosfree/ui/lib/utils';
import { PageHeader, Panel } from '@/components/app/page-header';
import { OverlapWeek, defaultMinFree, minFreeChoices } from '@/components/calendar/overlap-week';
import { ShareSlot } from '@/components/slots/share-slot';
import { getGroup, getGroups, getNow } from '@/lib/data/people';
import { findSlots } from '@/lib/data/slots';
import type { Slot } from '@/lib/types';

export const metadata: Metadata = { title: 'Find a time' };

const DURATIONS = [30, 60, 90, 120] as const;
const RANGES = [3, 7, 14] as const;
const TIMES = {
  any: { label: 'Any time', window: [8 * 60, 22 * 60] },
  morning: { label: 'Morning', window: [8 * 60, 12 * 60] },
  afternoon: { label: 'Afternoon', window: [12 * 60, 17 * 60] },
  evening: { label: 'Evening', window: [17 * 60, 22 * 60] },
} as const satisfies Record<string, { label: string; window: [number, number] }>;
type TimeKey = keyof typeof TIMES;

const pick = <T extends string | number>(raw: unknown, allowed: readonly T[], fallback: T): T =>
  ((allowed as readonly unknown[]).find((a) => String(a) === raw) as T | undefined) ?? fallback;

// Group slot finder (J4, FR-SLOT, WF-098). A GET form, so it works without JavaScript and
// the URL can be shared. Defaults: next 7 days, 60 minutes (J4).
export default async function FindATimePage({ searchParams }: PageProps<'/find-a-time'>) {
  const sp = await searchParams;
  const [groups, { now, today, timeZone }] = await Promise.all([getGroups(), getNow()]);
  const personIds =
    typeof sp.people === 'string' ? sp.people.split(',').filter(Boolean).slice(0, 19) : [];
  const groupId =
    typeof sp.group === 'string' && groups.some((g) => g.id === sp.group)
      ? sp.group
      : personIds.length
        ? undefined
        : groups[0]?.id;
  const days = pick(sp.days, RANGES, 7);
  const minDuration = pick(sp.min, DURATIONS, 60);
  const time = pick(sp.time, Object.keys(TIMES) as TimeKey[], 'any');

  const [result, group] = await Promise.all([
    findSlots({
      groupId,
      personIds,
      from: today,
      days,
      minDuration,
      window: [...TIMES[time].window],
    }),
    groupId ? getGroup(groupId) : null,
  ]);
  const everyone = result.slots.filter((s) => s.missing.length === 0);
  const allBut = result.slots.filter((s) => s.missing.length > 0);
  const who = group ? group.name : result.participants.map((p) => p.name.split(' ')[0]).join(', ');
  const total = result.participants.length;
  const minRaw = Number(sp.free);
  const minFree = minFreeChoices(total).includes(minRaw) ? minRaw : defaultMinFree(total);
  const slotText = (s: Slot) =>
    `${formatDayLabel(s.date, today)} ${formatMonthDay(s.date)}, ${formatClockRange(s.start, s.end)}`;

  return (
    <>
      <PageHeader
        title="Find a time"
        subtitle="See when your group is free. We only show when people are free, never why they’re busy."
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
        <form method="get" className="flex flex-col gap-5 rounded-2xl border bg-card p-4 md:p-5">
          <Choice legend="Who">
            {personIds.length ? (
              <>
                <input type="hidden" name="people" value={personIds.join(',')} />
                <Chip
                  name="group"
                  value=""
                  checked={!groupId}
                  label="You and the people you picked"
                />
              </>
            ) : null}
            {groups.map((g) => (
              <Chip
                key={g.id}
                name="group"
                value={g.id}
                checked={groupId === g.id}
                label={`${g.emoji} ${g.name}`}
              />
            ))}
          </Choice>
          <Choice legend="When">
            {RANGES.map((d) => (
              <Chip
                key={d}
                name="days"
                value={String(d)}
                checked={days === d}
                label={`Next ${d} days`}
              />
            ))}
          </Choice>
          <Choice legend="For at least">
            {DURATIONS.map((m) => (
              <Chip
                key={m}
                name="min"
                value={String(m)}
                checked={minDuration === m}
                label={formatDuration(m)}
              />
            ))}
          </Choice>
          <Choice legend="Time of day">
            {(Object.keys(TIMES) as TimeKey[]).map((k) => (
              <Chip key={k} name="time" value={k} checked={time === k} label={TIMES[k].label} />
            ))}
          </Choice>
          <Button type="submit">
            <CalendarSearch aria-hidden="true" />
            Find times
          </Button>
        </form>

        <div className="flex min-w-0 flex-col gap-4">
          {result.excluded.length ? (
            <p className="flex gap-2 rounded-xl border bg-status-off-soft p-3 text-sm text-body-foreground">
              <UserX aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                {result.excluded.length === 1
                  ? '1 person hasn’t added a schedule yet or has paused sharing'
                  : `${result.excluded.length} people haven’t added a schedule yet or have paused sharing`}
                , so they&apos;re left out:{' '}
                {result.excluded.map((e) => e.person.name.split(' ')[0]).join(', ')}.
              </span>
            </p>
          ) : null}

          <Panel id="everyone" title={`Everyone free · ${who}`}>
            {everyone.length ? (
              <SlotList
                slots={everyone}
                today={today}
                slotText={slotText}
                groupId={groupId}
                canGroupPing={Boolean(group?.viewerPermissions.groupPing)}
              />
            ) : (
              <EmptyState
                icon={CalendarSearch}
                title="No time works for everyone"
                className="border-0 py-6"
              >
                Try a shorter time, more days, or check the times below where most people can make
                it.
              </EmptyState>
            )}
          </Panel>

          {allBut.length ? (
            <Panel id="all-but" title="Almost everyone">
              <SlotList
                slots={allBut}
                today={today}
                slotText={slotText}
                groupId={groupId}
                canGroupPing={Boolean(group?.viewerPermissions.groupPing)}
              />
            </Panel>
          ) : null}

          {total > 1 ? (
            <section
              aria-labelledby="week-title"
              className="overflow-hidden rounded-2xl border bg-card"
            >
              <h2 id="week-title" className="px-4 pt-4 text-[15px] font-semibold md:px-5">
                This week at a glance
              </h2>
              <OverlapWeek
                week={result.week}
                today={today}
                nowMinute={minutesIntoDay(now, timeZone)}
                minFree={minFree}
                path="/find-a-time"
                query={{
                  ...(groupId ? { group: groupId } : { people: personIds.join(',') }),
                  days: String(days),
                  min: String(minDuration),
                  time,
                }}
                dayPath={groupId ? (`/groups/${groupId}` as Route) : undefined}
              />
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Choice({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

function Chip({
  name,
  value,
  checked,
  label,
}: {
  name: string;
  value: string;
  checked: boolean;
  label: string;
}) {
  return (
    <label className="relative">
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={checked}
        className="peer sr-only"
      />
      <span
        className={cn(
          'flex min-h-11 cursor-pointer items-center rounded-full border bg-card px-3.5 text-[13px] font-semibold text-body-foreground md:min-h-9',
          'peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground',
          'peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50',
        )}
      >
        {label}
      </span>
    </label>
  );
}

function SlotList({
  slots,
  today,
  slotText,
  groupId,
  canGroupPing,
}: {
  slots: Slot[];
  today: string;
  slotText: (s: Slot) => string;
  groupId?: string;
  canGroupPing: boolean;
}) {
  return (
    <ol className="flex flex-col gap-2.5">
      {slots.map((s) => (
        <li
          key={`${s.date}-${s.start}`}
          className={cn(
            'flex flex-col gap-3 rounded-xl border p-3.5 sm:flex-row sm:items-center',
            s.missing.length === 0 && 'border-overlap-few-border bg-overlap-few',
          )}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="font-semibold">
              {formatDayLabel(s.date, today)} · {formatClockRange(s.start, s.end)}
            </p>
            <p className="text-xs text-body-foreground">
              {formatMonthDay(s.date)} · {formatDuration(s.end - s.start)}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <AvatarStack people={s.free} size="xs" max={6} />
              {s.missing.length ? (
                <span className="text-muted-foreground">
                  Can&apos;t make it: {s.missing.map((p) => p.name.split(' ')[0]).join(', ')}
                </span>
              ) : (
                <span className="flex items-center gap-1 font-semibold text-status-free-ink">
                  <CircleCheck aria-hidden="true" className="size-3.5" />
                  Everyone free
                </span>
              )}
            </div>
          </div>
          <ShareSlot
            text={`Link up? ${slotText(s)}`}
            groupId={groupId}
            canGroupPing={canGroupPing}
          />
        </li>
      ))}
    </ol>
  );
}
