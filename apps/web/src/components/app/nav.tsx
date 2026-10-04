'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Route } from 'next';
import {
  CalendarDays,
  CalendarSearch,
  Inbox,
  Menu,
  Plus,
  Settings,
  UserRound,
  UsersRound,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { GroupEmoji } from '@whosfree/ui/components/person-avatar';
import { Eyebrow, Logo } from '@whosfree/ui/components/misc';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@whosfree/ui/components/sheet';
import { cn } from '@whosfree/ui/lib/utils';
import type { GroupSummary } from '@/lib/types';

interface NavItem {
  href: Route;
  label: string;
  icon: LucideIcon;
}

// The same destinations on every screen size: the desktop sidebar and the phone menu (WF-014).
const NAV: NavItem[] = [
  { href: '/now', label: 'Now', icon: Zap },
  { href: '/schedule', label: 'Schedule', icon: CalendarDays },
  { href: '/friends', label: 'Friends', icon: UserRound },
  { href: '/groups', label: 'Groups', icon: UsersRound },
  { href: '/find-a-time', label: 'Find a time', icon: CalendarSearch },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/settings', label: 'Settings', icon: Settings },
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

type GroupLink = Pick<GroupSummary, 'id' | 'name' | 'emoji' | 'memberCount'>;

/**
 * Phone navigation: a hamburger button in the header that opens a drawer with the same links and
 * groups as the desktop sidebar (owner decision, PRD FR-WEB-9; the design's bottom bar is not
 * used). Links and the close button are at least 44px tall (NFR-UX-2). Unread pings show as a
 * dot on the button, so they aren't hidden while the menu is closed.
 */
export function MobileNav({ unread, groups }: { unread: number; groups: GroupLink[] }) {
  const [open, setOpen] = useState(false);
  const isActive = useIsActive();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label={unread ? `Open menu, ${unread} unread` : 'Open menu'}
        className="relative -ml-1.5 flex size-11 items-center justify-center rounded-lg text-foreground hover:bg-background"
      >
        <Menu aria-hidden="true" className="size-6" />
        {unread ? (
          <span
            aria-hidden="true"
            className="absolute top-2 right-2 size-2.5 rounded-full bg-primary ring-2 ring-card"
          />
        ) : null}
      </SheetTrigger>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-[min(85vw,300px)] gap-6 overflow-y-auto bg-card px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex items-center justify-between">
          <SheetTitle asChild>
            <div>
              <Logo />
            </div>
          </SheetTitle>
          <SheetClose
            aria-label="Close menu"
            className="-mr-1.5 flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-background hover:text-foreground"
          >
            <X aria-hidden="true" className="size-5" />
          </SheetClose>
        </div>
        <SheetDescription className="sr-only">Go to a page or one of your groups.</SheetDescription>

        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center gap-3 rounded-[9px] px-2.5 text-[15px] font-medium text-body-foreground transition-colors hover:bg-background',
                  active && 'bg-primary-soft font-semibold text-primary-ink hover:bg-primary-soft',
                )}
              >
                <item.icon aria-hidden="true" className="size-5" />
                {item.label}
                {item.href === '/inbox' ? <Badge count={unread} className="ml-auto" /> : null}
              </Link>
            );
          })}
        </nav>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between px-2.5 pb-1">
            <Eyebrow>Groups</Eyebrow>
            <Link
              href="/groups?new=1"
              onClick={() => setOpen(false)}
              aria-label="New group"
              className="flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
            >
              <Plus aria-hidden="true" className="size-4" />
            </Link>
          </div>
          {groups.map((g) => (
            <Link
              key={g.id}
              href={`/groups/${g.id}`}
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center gap-2.5 rounded-[9px] px-2.5 text-sm hover:bg-background"
            >
              <GroupEmoji emoji={g.emoji} size="sm" />
              <span className="truncate">{g.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {g.memberCount}
                <span className="sr-only"> {g.memberCount === 1 ? 'member' : 'members'}</span>
              </span>
            </Link>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
