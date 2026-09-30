import { PersonAvatar, personColor } from '@whosfree/ui/components/person-avatar';
import { STATUS_TONES, StatusIcon, type StatusTone } from '@whosfree/ui/components/status-badge';
import { TimeRange } from '@whosfree/ui/components/misc';
import { formatClockRange } from '@whosfree/ui/lib/time';
import { cn } from '@whosfree/ui/lib/utils';
import { freeWindows } from '@/lib/overlap';
import { activityLabel } from '@/lib/status';
import type { MemberBusyDay, Person, VisibleBlock } from '@/lib/types';
import { blockPosition, TimeGrid, type GridColumn } from './time-grid';
import { OVERLAP_END, OVERLAP_START } from './overlap-week';

const HOUR = 52;

/**
 * A group's day, one column per member (FR-VIEW-6). Block labels are already redacted
 * to each member's tier: T1 members only ever show "Busy". Times when everyone is free
 * get the design's dashed green band with an "Everyone free" label.
 */
export function GroupDay({
  members,
  busy,
  nowMinute,
  status,
}: {
  members: { person: Person; blocks: VisibleBlock[]; excluded: boolean }[];
  busy: MemberBusyDay[];
  nowMinute: number | null;
  status: Map<string, { tone: StatusTone; word: string }>;
}) {
  const everyone = freeWindows(busy, OVERLAP_START, OVERLAP_END).filter(
    (w) => w.free.length === busy.length && busy.length > 1,
  );

  const columns: GridColumn[] = members.map(({ person, blocks, excluded }) => {
    const s = status.get(person.id);
    return {
      key: person.id,
      nowMinute,
      header: (
        <div className="flex items-center gap-2 px-2.5 py-3">
          <PersonAvatar name={person.name} hue={person.hue} size="md" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[13px] font-semibold">{person.name}</span>
            {s ? (
              <span
                className={cn(
                  'flex items-center gap-1 text-[11px] font-semibold',
                  STATUS_TONES[s.tone].ink,
                )}
              >
                <StatusIcon tone={s.tone} className="size-3" />
                <span className="truncate">{s.word}</span>
              </span>
            ) : null}
          </span>
        </div>
      ),
      children: excluded ? (
        <p className="absolute inset-x-2 top-4 text-center text-xs text-muted-foreground">
          Not sharing yet
        </p>
      ) : (
        blocks.map((b) => (
          <div
            key={`${b.start}-${b.end}`}
            className="absolute inset-x-1 z-10 flex flex-col gap-0.5 overflow-hidden rounded-lg border px-2 py-1.5"
            style={{
              ...blockPosition(b.start, b.end, OVERLAP_START, HOUR, 2),
              background: `color-mix(in oklch, ${personColor(person.hue)} 14%, var(--card))`,
              borderColor: `color-mix(in oklch, ${personColor(person.hue)} 40%, var(--card))`,
            }}
          >
            <TimeRange start={b.start} end={b.end} className="text-[10.5px] text-body-foreground" />
            <span className="truncate text-[12.5px] font-semibold">{activityLabel(b)}</span>
          </div>
        ))
      ),
    };
  });

  const overlay = everyone.map((w) => {
    const pos = blockPosition(w.start, w.end, OVERLAP_START, HOUR, 0);
    return (
      <div key={w.start} className="absolute inset-x-0" style={pos}>
        <div className="absolute inset-0 border-y-[1.5px] border-dashed border-overlap-all bg-overlap-few" />
        <span className="absolute top-0 right-2 z-30 -translate-y-1/2 rounded-full bg-overlap-all px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-overlap-all-ink">
          Everyone free · {formatClockRange(w.start, w.end)}
        </span>
      </div>
    );
  });

  return (
    <TimeGrid
      label="Everyone's day"
      columns={columns}
      startMin={OVERLAP_START}
      endMin={OVERLAP_END}
      hourHeight={HOUR}
      minColumnWidth={128}
      overlay={overlay}
    />
  );
}
