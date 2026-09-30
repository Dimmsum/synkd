'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Route } from 'next';
import {
  CalendarDays,
  CalendarSearch,
  Inbox,
  Settings,
  UserRound,
  UsersRound,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@whosfree/ui/lib/utils';

interface NavItem {
  href: Route;
  label: string;
  icon: LucideIcon;
  /** Shown in the phone bottom bar (WF-014: Now, Schedule, Groups, Inbox, Settings). */
  mobile: boolean;
}

const NAV: NavItem[] = [
  { href: '/now', label: 'Now', icon: Zap, mobile: true },
  { href: '/schedule', label: 'Schedule', icon: CalendarDays, mobile: true },
  { href: '/friends', label: 'Friends', icon: UserRound, mobile: false },
  { href: '/groups', label: 'Groups', icon: UsersRound, mobile: true },
  { href: '/find-a-time', label: 'Find a time', icon: CalendarSearch, mobile: false },
  { href: '/inbox', label: 'Inbox', icon: Inbox, mobile: true },
  { href: '/settings', label: 'Settings', icon: Settings, mobile: true },
];

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

function Badge({ count, className }: { count: number; className?: string }) {
  if (!count) return null;
  return (
    <span
      className={cn(
        'min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] leading-5 font-semibold text-primary-foreground',
        className,
      )}
    >
      {count}
      <span className="sr-only"> unread</span>
    </span>
  );
}

/** Desktop sidebar navigation, styled like the design's 232px sidebar. */
export function SidebarNav({ unread }: { unread: number }) {
  const isActive = useIsActive();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-10 items-center gap-3 rounded-[9px] px-2.5 text-sm font-medium text-body-foreground transition-colors hover:bg-background',
              active && 'bg-primary-soft font-semibold text-primary-ink hover:bg-primary-soft',
            )}
          >
            <item.icon aria-hidden="true" className="size-[18px]" />
            {item.label}
            {item.href === '/inbox' ? <Badge count={unread} className="ml-auto" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Phone bottom navigation (NFR-UX-2: 44px+ targets, reachable one-handed). */
export function BottomNav({ unread }: { unread: number }) {
  const isActive = useIsActive();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {NAV.filter((i) => i.mobile).map((item) => {
          const active = isActive(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground',
                  active && 'font-semibold text-primary-ink',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                    active && 'bg-primary-soft',
                  )}
                >
                  <item.icon aria-hidden="true" className="size-5" />
                </span>
                {item.label}
                {item.href === '/inbox' && unread ? (
                  <Badge count={unread} className="absolute top-1 left-[calc(50%+6px)]" />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
