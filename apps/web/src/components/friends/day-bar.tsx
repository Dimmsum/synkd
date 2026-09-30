import { formatClockRange, formatHourLabel } from '@whosfree/ui/lib/time';
import { activityLabel } from '@/lib/status';
import type { DayTimeline } from '@/lib/types';

const START = 8 * 60;
const END = 22 * 60;
const pct = (m: number) =>
  `${((Math.min(Math.max(m, START), END) - START) / (END - START)) * 100}%`;

/**
 * A day as a single bar, like the design's friend panel: green = free, grey = busy,
 * hatched = outside their available hours (Away). The list underneath carries the same
 * information as text (NFR-UX-1), redacted to the viewer's tier.
 */
export function DayBar({
  day,
  label,
  nowMinute,
}: {
  day: DayTimeline;
  label: string;
  nowMinute: number | null;
}) {
  const away = day.hours
    ? [
        [START, day.hours.start],
        [day.hours.end, END],
      ].filter(([s, e]) => (e ?? 0) > (s ?? 0))
    : [];
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </h3>
      <div aria-hidden="true" className="relative h-4 overflow-hidden rounded-md bg-overlap-most">
        {away.map(([s, e]) => (
          <span
            key={s}
            className="absolute inset-y-0 bg-[repeating-linear-gradient(135deg,var(--status-off)_0_2px,transparent_2px_6px)] bg-status-off-soft"
            style={{ left: pct(s ?? 0), width: `calc(${pct(e ?? 0)} - ${pct(s ?? 0)})` }}
          />
        ))}
        {day.blocks.map((b) => (
          <span
            key={b.start}
            className="absolute inset-y-0 bg-status-busy"
            style={{ left: pct(b.start), width: `calc(${pct(b.end)} - ${pct(b.start)})` }}
          />
        ))}
        {nowMinute != null && nowMinute >= START && nowMinute <= END ? (
          <span className="absolute inset-y-0 w-0.5 bg-now-line" style={{ left: pct(nowMinute) }} />
        ) : null}
      </div>
      <div
        aria-hidden="true"
        className="flex justify-between font-mono text-[10.5px] text-muted-foreground"
      >
        <span>{formatHourLabel(START)}</span>
        <span>{formatHourLabel(15 * 60)}</span>
        <span>{formatHourLabel(END)}</span>
      </div>
      {day.blocks.length ? (
        <ul className="flex flex-col gap-1 text-sm">
          {day.blocks.map((b) => (
            <li key={b.start} className="grid grid-cols-[8.5rem_1fr] gap-2">
              <span className="font-mono text-[12px] text-body-foreground">
                {formatClockRange(b.start, b.end)}
              </span>
              <span className="font-medium">{activityLabel(b)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {day.hours ? 'Nothing on. Free inside their available hours.' : 'Not sharing yet.'}
        </p>
      )}
      {day.hours && (day.hours.start > START || day.hours.end < END) ? (
        <p className="text-xs text-muted-foreground">
          Available {formatClockRange(day.hours.start, day.hours.end)}; away outside that.
        </p>
      ) : null}
    </div>
  );
}
