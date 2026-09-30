'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@whosfree/ui/components/input';
import { TIER_LABELS } from '@whosfree/shared';
import { cn } from '@whosfree/ui/lib/utils';
import { ConnectionRow } from '@/components/app/connection-row';
import type { Connection, GroupSummary } from '@/lib/types';

/** Friends with a search box and All / Free now tabs, like the design's Friends page. */
export function FriendsList({
  friends,
  groups,
  now,
  timeZone,
}: {
  friends: Connection[];
  groups: GroupSummary[];
  now: string;
  timeZone: string;
}) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'all' | 'free'>('all');
  const freeCount = friends.filter((f) => f.status === 'free').length;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return friends
      .filter((f) => tab === 'all' || f.status === 'free')
      .filter(
        (f) => !q || f.name.toLowerCase().includes(q) || f.handle.includes(q.replace('@', '')),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [friends, query, tab]);
  const groupName = (id: string) => groups.find((g) => g.id === id)?.name;

  const tabs = [
    { key: 'all' as const, label: 'All', n: friends.length },
    { key: 'free' as const, label: 'Free now', n: freeCount },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div role="group" aria-label="Show" className="flex gap-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'flex min-h-11 items-center gap-2 rounded-full border px-4 text-[13px] font-semibold md:min-h-9',
                tab === t.key
                  ? 'border-foreground bg-foreground text-background'
                  : 'bg-card text-body-foreground hover:bg-accent',
              )}
            >
              {t.label}
              <span
                className={cn(
                  'rounded-full px-1.5 text-[11px]',
                  tab === t.key ? 'bg-background/20' : 'bg-muted',
                )}
              >
                {t.n}
              </span>
            </button>
          ))}
        </div>
        <div className="relative sm:ml-auto sm:w-72">
          <Search
            aria-hidden="true"
            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search friends"
            placeholder="Search friends"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>
      <section aria-label="Friends" className="rounded-2xl border bg-card px-2 py-2 md:px-3">
        {shown.length ? (
          <ul className="flex flex-col divide-y divide-border-subtle">
            {shown.map((f) => (
              <ConnectionRow
                key={f.id}
                c={f}
                now={now}
                timeZone={timeZone}
                context={[
                  `You see: ${TIER_LABELS[f.tier]}`,
                  f.groupIds.length ? f.groupIds.map(groupName).join(', ') : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
          </ul>
        ) : (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {query ? `No friends match “${query}”.` : 'Nobody is free right now.'}
          </p>
        )}
      </section>
    </div>
  );
}
