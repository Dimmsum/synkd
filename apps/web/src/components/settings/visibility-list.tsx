'use client';

import { useId, useState, useTransition } from 'react';
import { TIER_LABELS, TIERS, type Tier } from '@synkd/shared';
import { Info } from 'lucide-react';
import { Button } from '@synkd/ui/components/button';
import { GroupEmoji, PersonAvatar } from '@synkd/ui/components/person-avatar';
import { tierFromString } from '@synkd/ui/lib/tiers';
import { setFriendTier, setGroupTier } from '@/lib/actions/social';
import type { VisibilityRow } from '@/lib/types';

const selectClass =
  'h-11 rounded-[10px] border border-input bg-card px-3 text-sm font-medium outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:h-9';

/**
 * One friend or group with the tier that applies (FR-VIS-8) and a way to change it
 * (FR-VIS-2). When a shared group lowers what a friend sees, say so (FR-VIS-3a).
 */
export function VisibilityItem({ row, canSetOwn }: { row: VisibilityRow; canSetOwn: boolean }) {
  const id = useId();
  const [tier, setTier] = useState<Tier | null>(row.tier);
  const [status, setStatus] = useState<string>();
  const [pending, start] = useTransition();
  const isGroup = row.target.type === 'group';
  const name = row.target.type === 'group' ? row.target.group.name : row.target.person.name;
  const first = name.split(' ')[0] ?? name;
  const effective = tier ?? row.effectiveTier;

  function save(next: Tier | null) {
    setTier(next);
    start(async () => {
      const res =
        row.target.type === 'group'
          ? await setGroupTier(row.target.group.id, next ?? row.effectiveTier)
          : await setFriendTier(row.target.person.id, next);
      setStatus(res.ok ? 'Saved' : res.error);
    });
  }

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-3">
        {row.target.type === 'group' ? (
          <GroupEmoji emoji={row.target.group.emoji} />
        ) : (
          <PersonAvatar name={row.target.person.name} hue={row.target.person.hue} />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold">{name}</span>
          <span className="text-xs text-muted-foreground">
            Sees: <span className="font-semibold text-foreground">{TIER_LABELS[effective]}</span>
            {tier === null && !isGroup ? ' (from your groups)' : ''}
          </span>
        </span>
        {canSetOwn ? (
          <>
            <label htmlFor={`${id}-tier`} className="sr-only">
              What {name} sees
            </label>
            <select
              id={`${id}-tier`}
              className={selectClass}
              value={tier === null ? 'group' : String(tier)}
              disabled={pending}
              onChange={(e) =>
                save(e.target.value === 'group' ? null : tierFromString(e.target.value))
              }
            >
              {!isGroup ? <option value="group">Use group settings</option> : null}
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {TIER_LABELS[t]}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <span role="status" className="sr-only">
          {status}
        </span>
      </div>
      {row.loweredBy && tier === null ? (
        <p className="ml-12 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-status-soon-soft px-3 py-2 text-xs text-status-soon-ink">
          <Info aria-hidden="true" className="size-3.5 shrink-0" />
          <span>
            {first} sees {TIER_LABELS[row.effectiveTier]} because you&apos;re both in{' '}
            <strong>{row.loweredBy.name}</strong>.
          </span>
          {canSetOwn ? (
            <Button
              variant="link"
              size="sm"
              className="h-auto min-h-11 px-0 text-xs md:min-h-0"
              onClick={() => save(row.effectiveTier)}
            >
              Set a level for {first}
            </Button>
          ) : (
            <span>Add {first} as a friend to set a level just for them.</span>
          )}
        </p>
      ) : null}
    </li>
  );
}
