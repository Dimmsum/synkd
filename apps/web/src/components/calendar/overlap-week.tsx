import Link from 'next/link';
import type { Route } from 'next';
import { AvatarStack } from '@whosfree/ui/components/person-avatar';
import {
  formatClockRange,
  formatDayLabel,
  formatMonthDay,
  weekdayShort,
} from '@whosfree/ui/lib/time';
import { cn } from '@whosfree/ui/lib/utils';
import { freeCounts, freeWindows, rankSlots } from '@/lib/overlap';
import type { OverlapWeek as OverlapWeekData, Person } from '@/lib/types';
import { blockPosition, TimeGrid, type GridColumn } from './time-grid';

export const OVERLAP_START = 8 * 60;
export const OVERLAP_END = 22 * 60;
const HOUR = 44;

type Tone = 'all' | 'most' | 'few';
const TONES: Record<Tone, string> = {
  all: 'bg-overlap-all border-overlap-all text-overlap-all-ink',
  most: 'bg-overlap-most border-overlap-most-border text-overlap-most-ink',
  few: 'bg-overlap-few border-overlap-few-border text-overlap-few-ink',
};
const toneFor = (n: number, total: number): Tone =>
  n === total ? 'all' : n === total - 1 ? 'most' : 'few';

/** The "Show times when [Everyone | 5+ | 4+ | 3+] are free" choices. */
export function minFreeChoices(total: number): number[] {
  return [total, total - 1, total - 2, total - 3].filter((n) => n >= 2 || n === total);
}

export function defaultMinFree(total: number) {
  return Math.max(Math.min(total, 2), total - 2);
}

/**
 * The group week view in the design's **overlap** style (the only week style, per the
 * owner): blocks show when at least N people are free, labelled "Everyone" or "N free"
 * (text, not just colour), with who's free. It never shows why anyone is busy (FR-SLOT-3).
 * Each day header carries the "Group overlap · Darker = more free" strip.
 */
export function OverlapWeek({
  week,
  today,
  nowMinute,
  minFree,
  path,
  query = {},
}: {
  week: OverlapWeekData;
  today: string;
  nowMinute: number;
  minFree: number;
  /** Page this view lives on; day links open its day view, chips set `?min=`. */
  path: Route;
  query?: Record<string, string>;
}) {
  const hrefFor = {
    day: (date: string) => ({ pathname: path, query: { ...query, view: 'day', date } }),
    minFree: (n: number) => ({
      pathname: path,
      query: { ...query, view: 'week', date: week.weekStart, min: String(n) },
    }),
  };
  const total = week.people.length;
  const byId = new Map<string, Person>(week.people.map((p) => [p.id, p]));
  const people = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is Person => !!p);

  const columns: GridColumn[] = week.days.map((day) => {
    const counts = freeCounts(day.members, OVERLAP_START, OVERLAP_END);
    const best = rankSlots([day], {
      minDuration: 60,
      window: [OVERLAP_START, OVERLAP_END],
      maxMissing: Math.max(total - 2, 0),
    })[0];
    const isToday = day.date === today;
    const dayLabel = formatDayLabel(day.date, today);
    return {
      key: day.date,
      highlight: isToday,
      nowMinute: isToday ? nowMinute : null,
      header: (
        <div className="flex flex-col gap-1.5 px-1.5 pt-2.5 pb-2">
          <Link
            href={hrefFor.day(day.date)}
            className="flex min-h-8 items-center justify-center gap-1.5 rounded-md hover:bg-background"
            aria-label={`${dayLabel}, ${formatMonthDay(day.date)}: open day`}
          >
            <span
              className={cn(
                'text-[11px] font-semibold tracking-[0.05em] uppercase',
                isToday ? 'text-primary-ink' : 'text-muted-foreground',
              )}
            >
              {weekdayShort(day.date)}
            </span>
            <span
              className={cn(
                'flex size-7 items-center justify-center rounded-full text-[15px] font-bold',
                isToday && 'bg-primary text-primary-foreground',
              )}
            >
              {Number(day.date.slice(8))}
            </span>
          </Link>
          {/* Group overlap strip: darker = more people free. Summarised in text below. */}
          <div aria-hidden="true" className="flex h-3 gap-px overflow-hidden rounded-[4px]">
            {counts.map((c, i) => (
              <span
                key={i}
                className="flex-1"
                style={{
                  background: `color-mix(in oklch, var(--overlap-all) ${total ? Math.round((c / total) * 100) : 0}%, var(--overlap-none))`,
                }}
              />
            ))}
          </div>
          <span className="truncate text-center text-[10.5px] font-semibold text-status-free-ink">
            {best ? (
              <>
                <span className="sr-only">Best: </span>
                {best.free.length === total ? 'All' : `${best.free.length} free`} ·{' '}
                {formatClockRange(best.start, best.end)}
              </>
            ) : (
              '—'
            )}
          </span>
        </div>
      ),
      children: freeWindows(day.members, OVERLAP_START, OVERLAP_END)
        .filter((w) => w.free.length >= minFree)
        .map((w) => {
          const style = blockPosition(w.start, w.end, OVERLAP_START, HOUR, 1);
          const h = Number(style.height);
          const n = w.free.length;
          const tone = toneFor(n, total);
          const who = people(w.free);
          const range = formatClockRange(w.start, w.end);
          return (
            <Link
              key={`${w.start}`}
              href={hrefFor.day(day.date)}
              aria-label={`${dayLabel} ${range}: ${n === total ? 'everyone free' : `${n} of ${total} free: ${who.map((p) => p.name).join(', ')}`}`}
              className={cn(
                'absolute inset-x-1 z-10 flex flex-col gap-1 overflow-hidden rounded-[7px] border hover:ring-2 hover:ring-primary focus-visible:ring-2',
                h < 30 ? 'px-1.5 py-0.5' : 'px-1.5 py-1',
                TONES[tone],
              )}
              style={style}
            >
              <span className="truncate text-[11px] leading-4 font-bold">
                {n === total ? 'Everyone' : `${n} free`}
              </span>
              {h >= 40 ? (
                <span className="truncate font-mono text-[10.5px] leading-3">{range}</span>
              ) : null}
              {h >= 66 ? <AvatarStack people={who} size="xs" max={4} /> : null}
            </Link>
          );
        }),
    };
  });

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
        <span className="text-[13px] text-muted-foreground">Show times when</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Minimum people free">
          {minFreeChoices(total).map((n) => (
            <Link
              key={n}
              href={hrefFor.minFree(n)}
              aria-current={n === minFree ? 'true' : undefined}
              className={cn(
                'flex min-h-10 items-center rounded-full border px-3 text-[12.5px] font-semibold md:min-h-8',
                n === minFree
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-card text-body-foreground hover:bg-accent',
              )}
            >
              {n === total ? 'Everyone' : `${n}+`}
            </Link>
          ))}
        </div>
        <span className="text-[13px] text-muted-foreground">are free</span>
        <ul className="flex flex-wrap items-center gap-3 text-[11.5px] text-muted-foreground lg:ml-auto">
          <li className="flex items-center gap-1.5">
            <span className="size-3 rounded-[3px] bg-overlap-all" aria-hidden="true" />
            Everyone
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-3 rounded-[3px] bg-overlap-most" aria-hidden="true" />
            {total - 1} of {total}
          </li>
          <li className="flex items-center gap-1.5">
            <span
              className="size-3 rounded-[3px] border border-overlap-few-border bg-overlap-few"
              aria-hidden="true"
            />
            Fewer
          </li>
          <li className="flex items-center gap-1.5">
            <span
              className="h-3 w-5 rounded-[3px] bg-gradient-to-r from-overlap-none to-overlap-all"
              aria-hidden="true"
            />
            Darker = more free
          </li>
        </ul>
      </div>
      <TimeGrid
        label="Group overlap for the week"
        columns={columns}
        startMin={OVERLAP_START}
        endMin={OVERLAP_END}
        hourHeight={HOUR}
        minColumnWidth={92}
      />
      {week.excluded.length ? (
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">
          Left out of the times above:{' '}
          {week.excluded
            .map(
              (e) =>
                `${e.person.name.split(' ')[0]} (${e.reason === 'paused' ? 'sharing paused' : 'no schedule yet'})`,
            )
            .join(', ')}
          .
        </p>
      ) : null}
    </div>
  );
}
