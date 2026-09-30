import Link from 'next/link';
import { Plus } from 'lucide-react';
import { GroupEmoji, PersonAvatar } from '@whosfree/ui/components/person-avatar';
import { Eyebrow, Logo, LogoMark } from '@whosfree/ui/components/misc';
import { BottomNav, SidebarNav } from '@/components/app/nav';
import { StatusChip } from '@/components/app/status-chip';
import { getGroups, getNow, getViewer } from '@/lib/data/people';
import { getUnreadCount } from '@/lib/data/inbox';
import { describeStatus } from '@/lib/status';

// Signed-in app shell (WF-014). Rendered per request: statuses depend on the current time.
// TODO(WF-004/WF-005): protect these routes in proxy.ts: signed-out users go to
// /sign-in, and users without a confirmed age or current consent go to /sign-up/age or
// /sign-up/terms. There is NO route protection yet.
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [viewer, groups, unread, { now, timeZone }] = await Promise.all([
    getViewer(),
    getGroups(),
    getUnreadCount(),
    getNow(),
  ]);
  const me = describeStatus({ ...viewer, nextFreeAt: null }, now, timeZone);

  return (
    <div className="min-h-dvh md:flex">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-card px-3 py-2 font-semibold focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col gap-6 overflow-y-auto border-r bg-card px-4 pt-5 pb-4 md:flex">
        <Link href="/now" className="rounded-lg px-1.5" aria-label="Who's Free, go to Now">
          <Logo />
        </Link>
        <SidebarNav unread={unread} />
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between px-2.5 pb-1">
            <Eyebrow>Groups</Eyebrow>
            <Link
              href="/groups?new=1"
              aria-label="New group"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
            >
              <Plus aria-hidden="true" className="size-4" />
            </Link>
          </div>
          {groups.map((g) => (
            <Link
              key={g.id}
              href={`/groups/${g.id}`}
              className="flex min-h-10 items-center gap-2.5 rounded-[9px] px-2.5 text-sm hover:bg-background"
            >
              <GroupEmoji emoji={g.emoji} size="sm" />
              <span className="truncate">{g.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {g.memberCount}
                <span className="sr-only"> members</span>
              </span>
            </Link>
          ))}
        </div>
        <div className="mt-auto">
          <StatusChip variant="card" name={viewer.name} tone={me.tone} label={me.label}>
            <PersonAvatar name={viewer.name} hue={viewer.hue} />
          </StatusChip>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b bg-card/95 px-4 py-2 backdrop-blur md:hidden">
          <Link href="/now" aria-label="Who's Free, go to Now" className="rounded-lg">
            <LogoMark />
          </Link>
          <StatusChip name={viewer.name} tone={me.tone} label={me.label} />
        </header>
        <main
          id="main"
          className="mx-auto w-full max-w-[1200px] flex-1 px-4 pt-4 pb-28 md:px-6 md:pt-6 md:pb-10"
        >
          {children}
        </main>
      </div>

      <BottomNav unread={unread} />
    </div>
  );
}
