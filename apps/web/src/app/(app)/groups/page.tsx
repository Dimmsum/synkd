import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, UsersRound } from 'lucide-react';
import { EmptyState } from '@whosfree/ui/components/misc';
import { GroupEmoji } from '@whosfree/ui/components/person-avatar';
import { StatusBadge } from '@whosfree/ui/components/status-badge';
import { PageHeader } from '@/components/app/page-header';
import { NewGroupDialog } from '@/components/groups/new-group-dialog';
import { getGroups } from '@/lib/data/people';

export const metadata: Metadata = { title: 'Groups' };

// Groups (WF-043). `?new=1` opens the create dialog (used by the sidebar "+").
export default async function GroupsPage({ searchParams }: PageProps<'/groups'>) {
  const [groups, sp] = await Promise.all([getGroups({ freeNow: true }), searchParams]);
  return (
    <>
      <PageHeader
        title="Groups"
        subtitle="Everyone in a group sees each other at the level each person picked."
        actions={<NewGroupDialog defaultOpen={sp.new === '1'} />}
      />
      {groups.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <li key={g.id}>
              <Link
                href={`/groups/${g.id}`}
                className="flex min-h-20 items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <GroupEmoji emoji={g.emoji} size="lg" />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold">{g.name}</span>
                    {g.viewerRole === 'admin' ? (
                      <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary-ink">
                        Admin
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">{g.memberCount} members</span>
                  <StatusBadge tone="free" className="text-xs">
                    {g.freeNowCount} free right now
                  </StatusBadge>
                </span>
                <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={UsersRound} title="No groups yet" action={<NewGroupDialog />}>
          Make one for your flat, class or team, then share the invite link on WhatsApp.
        </EmptyState>
      )}
    </>
  );
}
