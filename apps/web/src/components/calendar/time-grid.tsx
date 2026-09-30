import { formatHourLabel } from '@whosfree/ui/lib/time';
import { cn } from '@whosfree/ui/lib/utils';

export interface GridColumn {
  key: string;
  header: React.ReactNode;
  /** Tint the column (today), like the design. */
  highlight?: boolean;
  /** Minutes since midnight for the now line, if it falls in this column. */
  nowMinute?: number | null;
  /** Absolutely positioned blocks (use `blockPosition`). */
  children?: React.ReactNode;
}

/** Top/height in px for a block from `start` to `end` (local minutes). */
export function blockPosition(
  start: number,
  end: number,
  startMin: number,
  hourHeight: number,
  inset = 1,
): React.CSSProperties {
  const top = ((start - startMin) / 60) * hourHeight + inset;
  const height = Math.max(((end - start) / 60) * hourHeight - inset * 2, 14);
  return { top, height };
}

/**
 * The design's calendar grid: a mono hour gutter, faint hour lines and one column per day
 * or person. Scrolls sideways inside its card on narrow screens (never the page).
 */
export function TimeGrid({
  columns,
  startMin,
  endMin,
  hourHeight,
  minColumnWidth = 88,
  overlay,
  label,
}: {
  columns: GridColumn[];
  startMin: number;
  endMin: number;
  hourHeight: number;
  minColumnWidth?: number;
  /** Spans every column, e.g. the "Everyone free" band. */
  overlay?: React.ReactNode;
  label: string;
}) {
  const hours: number[] = [];
  for (let m = startMin; m <= endMin; m += 60) hours.push(m);
  const height = ((endMin - startMin) / 60) * hourHeight;
  const gutter = 'w-12 shrink-0 md:w-16';

  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="relative overflow-x-auto rounded-b-2xl"
    >
      <div style={{ minWidth: `calc(4rem + ${columns.length * minColumnWidth}px)` }}>
        <div className="flex border-b">
          <div className={gutter} />
          {columns.map((c) => (
            <div
              key={c.key}
              className={cn(
                'min-w-0 flex-1 border-l border-grid-line',
                c.highlight && 'bg-today-column',
              )}
            >
              {c.header}
            </div>
          ))}
        </div>
        <div className="flex pt-2.5 pb-3.5">
          <div className={cn(gutter, 'relative')} style={{ height }} aria-hidden="true">
            {hours.slice(0, -1).map((m) => (
              <span
                key={m}
                className="absolute right-2 -translate-y-1/2 font-mono text-[10.5px] whitespace-nowrap text-muted-foreground md:right-2.5"
                style={{ top: ((m - startMin) / 60) * hourHeight }}
              >
                {formatHourLabel(m)}
              </span>
            ))}
          </div>
          <div className="relative flex-1" style={{ height }}>
            {hours.map((m) => (
              <div
                key={m}
                aria-hidden="true"
                className="absolute inset-x-0 border-t border-grid-line"
                style={{ top: ((m - startMin) / 60) * hourHeight }}
              />
            ))}
            {overlay}
            <div className="absolute inset-0 flex">
              {columns.map((c) => (
                <div
                  key={c.key}
                  className={cn(
                    'relative min-w-0 flex-1 border-l border-grid-line',
                    c.highlight && 'bg-today-column/70',
                  )}
                >
                  {c.children}
                  {c.nowMinute != null && c.nowMinute >= startMin && c.nowMinute <= endMin ? (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-now-line"
                      style={{ top: ((c.nowMinute - startMin) / 60) * hourHeight }}
                    >
                      <span className="absolute -top-[3px] -left-1 size-2 rounded-full bg-now-line" />
                      <span className="sr-only">Now</span>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
