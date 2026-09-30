'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import {
  Bell,
  CalendarDays,
  ChevronRight,
  Clock,
  Eye,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@whosfree/ui/lib/utils';

export const SETTINGS_SECTIONS: {
  href: Route;
  label: string;
  hint: string;
  icon: LucideIcon;
}[] = [
  {
    href: '/settings/profile',
    label: 'Profile',
    hint: 'Name, handle, timezone, pause sharing',
    icon: UserRound,
  },
  {
    href: '/settings/hours',
    label: 'Available hours',
    hint: 'When you can show as free',
    icon: Clock,
  },
  {
    href: '/settings/visibility',
    label: 'Who can see me',
    hint: 'What each friend and group sees',
    icon: Eye,
  },
  {
    href: '/settings/notifications',
    label: 'Notifications',
    hint: 'Pings, requests, quiet hours',
    icon: Bell,
  },
  {
    href: '/settings/calendars',
    label: 'Schedules and calendars',
    hint: 'Uploads and Google Calendar',
    icon: CalendarDays,
  },
  {
    href: '/settings/privacy',
    label: 'Privacy and data',
    hint: 'Export, delete, consent',
    icon: ShieldCheck,
  },
];

/**
 * Settings navigation. On phones /settings shows it as a list and each section has a back
 * link; on desktop it sits beside the open section.
 */
export function SettingsNav({ variant }: { variant: 'side' | 'list' }) {
  const pathname = usePathname();
  if (variant === 'list') {
    return (
      <nav aria-label="Settings">
        <ul className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card">
          {SETTINGS_SECTIONS.map((s) => (
            <li key={s.href}>
              <Link
                href={s.href}
                className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-background"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary-soft text-primary-ink">
                  <s.icon aria-hidden="true" className="size-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">{s.label}</span>
                  <span className="text-xs text-muted-foreground">{s.hint}</span>
                </span>
                <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    );
  }
  return (
    <nav aria-label="Settings" className="hidden lg:block">
      <ul className="flex flex-col gap-0.5">
        {SETTINGS_SECTIONS.map((s) => {
          const active = pathname === s.href;
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-10 items-center gap-2.5 rounded-[9px] px-2.5 text-sm font-medium text-body-foreground hover:bg-card',
                  active &&
                    'bg-card font-semibold text-foreground shadow-[0_1px_2px_rgb(23_21_42/0.08)]',
                )}
              >
                <s.icon aria-hidden="true" className="size-4" />
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
