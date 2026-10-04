import { MANUAL_STATUS_LABELS } from '@whosfree/shared';
import { TimeRange } from '@whosfree/ui/components/misc';
import { formatClockRange, minutesIntoDay } from '@whosfree/ui/lib/time';
import { cn } from '@whosfree/ui/lib/utils';
import { DayHeader } from '@/components/calendar/schedule-grid';
import { blockPosition, TimeGrid, type GridColumn } from '@/components/calendar/time-grid';
import type { CalendarView } from '@/components/calendar/toolbar';
import { activityLabel } from '@/lib/status';
import type { ScheduleBlock } from '@/lib/types';

const START = 7 * 60;
const END = 23 * 60;

const STATUS_STYLES: Record<ScheduleBlock['status'], string> = {
  busy: 'bg-status-busy-soft border-status-busy/50',
  dnd: 'bg-status-dnd-soft border-status-dnd/40',
  away: 'bg-status-away-soft border-status-away/40',
};

/** What a block says, at the viewer's tier (the server already redacted it). */
function blockLabel(b: ScheduleBlock): string {
  if (b.status === 'dnd') return b.title ?? MANUAL_STATUS_LABELS.dnd;
  if (b.status === 'away') return b.title ?? MANUAL_STATUS_LABELS.away;
  if (!b.title && !b.category && b.focused) return MANUAL_STATUS_LABELS.focused;
  return activityLabel(b);
}

/**
 * Someone else's schedule as a day or week calendar (FR-VIEW-4, WF-065), like My schedule but
 * redacted to the viewer's tier: T1 blocks only say "Busy". Blank time is free; hatching is
 * outside their available hours (Away). Every block has words, never colour alone (NFR-UX-1).
 */
export function ConnectionGrid({
  blocks,
  dates,
  view,
  today,
  now,
  timeZone,
  label,
}: {
  blocks: ScheduleBlock[];
  dates: string[];
  view: CalendarView;
  today: string;
  now: string;
  timeZone: string;
  /** The grid's accessible name, e.g. "Kemar’s week". */
  label: string;
}) {
  const hourHeight = view === 'day' ? 56 : 44;
  const nowMinute = minutesIntoDay(now, timeZone);
  const columns: GridColumn[] = dates.map((d) => ({
    key: d,
    highlight: view === 'week' && d === today,
    nowMinute: d === today ? nowMinute : null,
    header: <DayHeader date={d} today={today} />,
    children: blocks
      .filter((b) => b.date === d && b.end > START && b.start < END)
      .map((b) =>
        b.outsideHours ? (
          <AwayShade key={b.id} b={b} hourHeight={hourHeight} />
        ) : (
          <Block key={b.id} b={b} hourHeight={hourHeight} />
        ),
      ),
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

/** Clamped to the grid's hours; the label keeps the real times. */
const position = (b: ScheduleBlock, hourHeight: number, inset: number) =>
  blockPosition(Math.max(b.start, START), Math.min(b.end, END), START, hourHeight, inset);

function Block({ b, hourHeight }: { b: ScheduleBlock; hourHeight: number }) {
  return (
    <div
      className={cn(
        'absolute inset-x-1 z-10 flex flex-col gap-0.5 overflow-hidden rounded-lg border px-2 py-1.5',
        STATUS_STYLES[b.status],
      )}
      style={position(b, hourHeight, 2)}
    >
      <TimeRange start={b.start} end={b.end} className="text-[10.5px] text-body-foreground" />
      <span className="truncate text-[12.5px] font-semibold">{blockLabel(b)}</span>
    </div>
  );
}

function AwayShade({ b, hourHeight }: { b: ScheduleBlock; hourHeight: number }) {
  return (
    <div
      className="absolute inset-x-0 bg-status-off-soft bg-[repeating-linear-gradient(135deg,var(--status-off)_0_1px,transparent_1px_7px)]"
      style={position(b, hourHeight, 0)}
    >
      <span className="sr-only">
        Away {formatClockRange(b.start, b.end)}, outside their available hours
      </span>
    </div>
  );
}
