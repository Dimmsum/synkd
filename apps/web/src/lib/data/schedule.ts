import type { MyEvent, ScheduleSource } from '@/lib/types';
import { VIEWER } from '@/lib/mock/data';
import { eventsOn } from '@/lib/mock/engine';
import { ctx } from '@/lib/mock/selectors';

/**
 * The viewer's combined schedule from every source for the given dates (FR-VIEW-5).
 * TODO(WF-065): read the viewer's own events (RLS) and expand recurrences on the server
 * with packages/availability (WF-061).
 */
export async function getMySchedule(dates: string[]): Promise<MyEvent[]> {
  const { today } = ctx();
  return dates.flatMap((date) =>
    eventsOn(VIEWER, date, today).map((e, i) => ({
      id: `${date}-${i}`,
      date,
      start: e.start,
      end: e.end,
      title: e.title,
      category: e.category,
      source: e.source,
    })),
  );
}

/**
 * Where the viewer's schedule comes from, with sync health (FR-GCAL-10).
 * TODO(WF-030, WF-080): read `sources`.
 */
export async function getSources(): Promise<ScheduleSource[]> {
  return [
    {
      type: 'upload',
      label: 'Uploaded timetable',
      status: 'healthy',
      detail: 'Semester 1 · Aug 31 – Dec 12, 2026',
    },
    { type: 'manual', label: 'Added by hand', status: 'healthy', detail: '3 events' },
    {
      type: 'gcal',
      label: 'Google Calendar',
      status: 'healthy',
      detail: 'Primary calendar · last synced 2 min ago',
    },
  ];
}
