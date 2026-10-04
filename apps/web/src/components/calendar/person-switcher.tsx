import Link from 'next/link';
import type { Route } from 'next';
import { cn } from '@whosfree/ui/lib/utils';
import type { CalendarView } from '@/components/calendar/toolbar';

export interface SwitcherPerson {
  /** Null for the viewer's own schedule. */
  id: string | null;
  name: string;
  avatar: React.ReactNode;
}

/**
 * Whose schedule My schedule shows (FR-VIEW-4, WF-065): the viewer, then their friends and
 * offline friends, as links that keep the day/week view and date, so it works without JS.
 * Scrolls sideways inside itself on narrow screens (never the page).
 */
export function PersonSwitcher({
  path,
  people,
  selected,
  view,
  date,
}: {
  path: Route;
  people: SwitcherPerson[];
  selected: string | null;
  view: CalendarView;
  date: string;
}) {
  return (
    <nav aria-label="Whose schedule" className="-mx-4 mb-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex w-max gap-2 pb-1">
        {people.map((p) => {
          const current = p.id === selected;
          return (
            <li key={p.id ?? 'me'}>
              <Link
                href={{
                  pathname: path,
                  query: { ...(p.id ? { person: p.id } : {}), view, date },
                }}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center gap-2 rounded-full border bg-card py-1 pr-3.5 pl-1 text-[13px] font-semibold whitespace-nowrap hover:bg-accent md:min-h-10',
                  current &&
                    'border-primary bg-primary-soft text-primary-ink hover:bg-primary-soft',
                )}
              >
                {p.avatar}
                {p.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
