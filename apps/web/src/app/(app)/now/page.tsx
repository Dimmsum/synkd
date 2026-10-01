import type { Metadata } from 'next';
import Link from 'next/link';
import { cn } from '@whosfree/ui/lib/utils';
import { NowBoard } from '@/components/now/now-board';
import { getViewerRow } from '@/lib/data/now';
import { getNow, getNowForViewer } from '@/lib/data/people';
import type { GroupSummary } from '@/lib/types';

export const metadata: Metadata = { title: 'Now' };

// The Now screen (FR-VIEW-1/2/3, PRD §8.5, WF-064): who's free right now and until when.
// The server reads `now_for_viewer` (already redacted to each person's tier) and works out
// every status with the availability engine; the board on the client keeps it current with
// Realtime "changed" signals (re-fetch) and a timer for "until X" boundaries (no polling).
export default async function NowPage({ searchParams }: PageProps<'/now'>) {
  const { group } = await searchParams;
  const [{ connections, groups }, { now, timeZone }, viewer] = await Promise.all([
    getNowForViewer(),
    getNow(),
    getViewerRow(),
  ]);
  const groupId = typeof group === 'string' && groups.some((g) => g.id === group) ? group : null;

  return (
    <NowBoard
      viewerId={viewer.id}
      connections={connections}
      groups={groups}
      groupId={groupId}
      now={now}
      timeZone={timeZone}
      filter={<GroupFilter groups={groups} active={groupId} />}
    />
  );
}

function GroupFilter({ groups, active }: { groups: GroupSummary[]; active: string | null }) {
  const chip = (isActive: boolean) =>
    cn(
      'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-[13px] font-semibold transition-colors md:min-h-9',
      isActive
        ? 'border-foreground bg-foreground text-background'
        : 'bg-card text-body-foreground hover:bg-accent',
    );
  return (
    <nav aria-label="Filter by group" className="-mx-4 mb-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex w-max gap-2">
        <li>
          <Link href="/now" className={chip(!active)} aria-current={!active ? 'true' : undefined}>
            Everyone
          </Link>
        </li>
        {groups.map((g) => (
          <li key={g.id}>
            <Link
              href={`/now?group=${g.id}`}
              className={chip(active === g.id)}
              aria-current={active === g.id ? 'true' : undefined}
            >
              <span aria-hidden="true">{g.emoji}</span>
              {g.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
