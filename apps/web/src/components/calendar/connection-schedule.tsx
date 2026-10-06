import type { Route } from 'next';
import { CalendarOff, CircleAlert, Pause } from 'lucide-react';
import { EmptyState } from '@synkd/ui/components/misc';
import { ConnectionGrid } from '@/components/calendar/connection-grid';
import { CalendarToolbar, type CalendarView } from '@/components/calendar/toolbar';
import type { ConnectionSchedule } from '@/lib/types';

/**
 * A friend's day or week (FR-VIEW-4, WF-065): the calendar toolbar and grid, or why there's
 * nothing to show. Used on their page and in My schedule's person switcher.
 */
export function ConnectionScheduleSection({
  schedule,
  firstName,
  path,
  extra,
  view,
  date,
  dates,
  today,
  now,
  timeZone,
}: {
  schedule: ConnectionSchedule;
  firstName: string;
  path: Route;
  /** Query kept by the toolbar's links, e.g. `{ person }`. */
  extra?: Record<string, string>;
  view: CalendarView;
  date: string;
  dates: string[];
  today: string;
  now: string;
  timeZone: string;
}) {
  if (schedule.state === 'paused') {
    return (
      <EmptyState icon={Pause} title={`${firstName} has paused sharing`}>
        Their schedule shows again when they turn sharing back on.
      </EmptyState>
    );
  }
  if (schedule.state === 'no_schedule') {
    return (
      <EmptyState icon={CalendarOff} title={`${firstName} hasn’t added a schedule yet`}>
        Once they upload or type in their timetable, you’ll see their day and week here.
      </EmptyState>
    );
  }
  if (schedule.state === 'unavailable') {
    return (
      <EmptyState icon={CircleAlert} title={`${firstName}’s schedule can’t be shown right now`}>
        Something in it couldn’t be read. Try again later.
      </EmptyState>
    );
  }

  const busy = schedule.blocks.some((b) => !b.outsideHours);
  return (
    <>
      <CalendarToolbar
        path={path}
        view={view}
        date={date}
        today={today}
        {...(extra ? { extra } : {})}
      />
      <p className="mb-3 text-xs text-muted-foreground">
        Blank time is free. Hatched is outside {firstName}’s available hours.
        {schedule.tier === 1 ? ` ${firstName} shares free/busy only, so blocks just say Busy.` : ''}
      </p>
      <ConnectionGrid
        blocks={schedule.blocks}
        dates={dates}
        view={view}
        today={today}
        now={now}
        timeZone={timeZone}
        label={view === 'day' ? `${firstName}’s day` : `${firstName}’s week`}
      />
      {busy ? null : (
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Nothing on {view === 'day' ? 'this day' : 'this week'}. {firstName} is free inside their
          available hours.
        </p>
      )}
    </>
  );
}
