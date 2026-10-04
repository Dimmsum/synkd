import type { SourceType } from '@whosfree/shared';
import { SourceBadge, TimeRange } from '@whosfree/ui/components/misc';
import { minutesIntoDay, weekdayShort } from '@whosfree/ui/lib/time';
import { cn } from '@whosfree/ui/lib/utils';
import { blockPosition, TimeGrid, type GridColumn } from '@/components/calendar/time-grid';
import type { CalendarView } from '@/components/calendar/toolbar';
import { CATEGORY_LABELS } from '@/lib/status';
import type { MyEvent } from '@/lib/types';

const START = 7 * 60;
const END = 23 * 60;

const SOURCE_STYLES: Record<SourceType, string> = {
  upload: 'bg-primary-soft border-primary/25',
  manual: 'bg-status-soon-soft border-status-soon/40',
  gcal: 'bg-status-away-soft border-status-away/40',
};

/**
 * A schedule as a day or week calendar, with titles and where each event came from (FR-VIEW-5):
 * the viewer's own (My schedule) or one of their offline friends' (WF-128), which the viewer
 * added and so sees in full.
 */
export function ScheduleGrid({
  events,
  dates,
  view,
  today,
  now,
  timeZone,
  label,
}: {
  events: MyEvent[];
  dates: string[];
  view: CalendarView;
  today: string;
  now: string;
  timeZone: string;
  /** The grid's accessible name, e.g. "Your week". */
  label: string;
}) {
  const hourHeight = view === 'day' ? 56 : 44;
  const nowMinute = minutesIntoDay(now, timeZone);
  const columns: GridColumn[] = dates.map((d) => ({
    key: d,
    highlight: view === 'week' && d === today,
    nowMinute: d === today ? nowMinute : null,
    header: <DayHeader date={d} today={today} />,
    children: events
      .filter((e) => e.date === d)
      .map((e) => (
        <EventBlock key={e.id} e={e} hourHeight={hourHeight} compact={view === 'week'} />
      )),
  }));
  return (
    <section className="rounded-2xl border bg-card">
      <TimeGrid
        label={label}
        columns={columns}
        startMin={START}
        endMin={END}
        hourHeight={hourHeight}
        minColumnWidth={view === 'day' ? 240 : 96}
      />
    </section>
  );
}

export function DayHeader({ date, today }: { date: string; today: string }) {
  const isToday = date === today;
  return (
    <div className="flex items-center justify-center gap-2 px-1.5 py-2.5">
      <span
        className={cn(
          'text-[11px] font-semibold tracking-[0.05em] uppercase',
          isToday ? 'text-primary-ink' : 'text-muted-foreground',
        )}
      >
        {weekdayShort(date)}
      </span>
      <span
        className={cn(
          'flex size-7 items-center justify-center rounded-full text-[15px] font-bold',
          isToday && 'bg-primary text-primary-foreground',
        )}
      >
        {Number(date.slice(8))}
        {isToday ? <span className="sr-only"> (today)</span> : null}
      </span>
    </div>
  );
}

function EventBlock({
  e,
  hourHeight,
  compact,
}: {
  e: MyEvent;
  hourHeight: number;
  compact: boolean;
}) {
  const style = blockPosition(e.start, e.end, START, hourHeight, 2);
  const tall = Number(style.height) >= 56;
  return (
    <div
      className={cn(
        'absolute inset-x-1 z-10 flex flex-col gap-0.5 overflow-hidden rounded-lg border px-2 py-1.5',
        SOURCE_STYLES[e.source],
      )}
      style={style}
    >
      <TimeRange start={e.start} end={e.end} className="text-[10.5px] text-body-foreground" />
      <span className="truncate text-[12.5px] font-semibold">{e.title}</span>
      {tall ? (
        <span className="flex flex-wrap items-center gap-1">
          {!compact ? (
            <span className="text-[11px] text-muted-foreground">{CATEGORY_LABELS[e.category]}</span>
          ) : null}
          <SourceBadge source={e.source} />
        </span>
      ) : (
        <span className="sr-only">
          {CATEGORY_LABELS[e.category]}, from {e.source === 'gcal' ? 'Google' : e.source}
        </span>
      )}
    </div>
  );
}
