import Link from 'next/link';
import type { Route } from 'next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { LocalDate } from '@whosfree/shared';
import { buttonVariants } from '@whosfree/ui/components/button';
import {
  addDays,
  formatWeekRange,
  startOfWeek,
  weekdayLong,
  formatMonthDay,
} from '@whosfree/ui/lib/time';
import { cn } from '@whosfree/ui/lib/utils';

export type CalendarView = 'day' | 'week';

/** Reads `?view=` and `?date=` safely, falling back to today. */
export function readCalendarParams(
  params: Record<string, string | string[] | undefined>,
  today: string,
  defaultView: CalendarView = 'day',
): { view: CalendarView; date: string } {
  const view = params.view === 'week' || params.view === 'day' ? params.view : defaultView;
  const raw = typeof params.date === 'string' ? params.date : '';
  const date = LocalDate.safeParse(raw).success ? raw : today;
  return { view, date };
}

/** Today / ‹ › / range label / Day–Week switch, as links so it works without JS. */
export function CalendarToolbar({
  path,
  view,
  date,
  today,
  extra,
}: {
  path: Route;
  view: CalendarView;
  date: string;
  today: string;
  extra?: Record<string, string>;
}) {
  const step = view === 'day' ? 1 : 7;
  const href = (v: CalendarView, d: string) => ({
    pathname: path,
    query: { ...extra, view: v, date: d },
  });
  const label =
    view === 'day'
      ? `${weekdayLong(date)}, ${formatMonthDay(date)}`
      : formatWeekRange(startOfWeek(date));
  const iconBtn = cn(
    buttonVariants({ variant: 'outline', size: 'icon-sm' }),
    'rounded-none border-0 first:rounded-l-[9px] last:rounded-r-[9px] last:border-l',
  );

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Link href={href(view, today)} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        Today
      </Link>
      <div className="flex overflow-hidden rounded-[10px] border bg-card">
        <Link
          href={href(view, addDays(date, -step))}
          className={iconBtn}
          aria-label={`Previous ${view}`}
        >
          <ChevronLeft aria-hidden="true" />
        </Link>
        <Link
          href={href(view, addDays(date, step))}
          className={iconBtn}
          aria-label={`Next ${view}`}
        >
          <ChevronRight aria-hidden="true" />
        </Link>
      </div>
      <h2 className="px-1 text-base font-semibold" aria-live="polite">
        {label}
      </h2>
      <div
        role="group"
        aria-label="Calendar view"
        className="ml-auto flex gap-0.5 rounded-[10px] bg-segment p-[3px]"
      >
        {(['day', 'week'] as const).map((v) => (
          <Link
            key={v}
            href={href(v, date)}
            aria-current={view === v ? 'true' : undefined}
            className={cn(
              'flex min-h-10 items-center rounded-lg px-4 text-[13.5px] font-semibold text-muted-foreground md:min-h-8',
              view === v && 'bg-card text-foreground shadow-[0_1px_2px_rgb(23_21_42/0.12)]',
            )}
          >
            {v === 'day' ? 'Day' : 'Week'}
          </Link>
        ))}
      </div>
    </div>
  );
}
