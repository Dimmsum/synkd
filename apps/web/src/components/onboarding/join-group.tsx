'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { DEFAULT_TIER, type Tier } from '@synkd/shared';
import { Button } from '@synkd/ui/components/button';
import { TierPicker } from '@synkd/ui/components/tier-picker';
import { joinGroup } from '@/lib/actions/social';

/**
 * Choose what the group sees, then join (FR-VIS-1: T1 preselected, J1.7). Afterwards runs
 * `afterJoin` (onboarding passes its server action that records the step and moves on, WF-068)
 * or, without one, opens the group.
 */
export function JoinGroupForm({
  code,
  groupName,
  afterJoin,
}: {
  code: string;
  groupName: string;
  afterJoin?: () => Promise<void>;
}) {
  const router = useRouter();
  const [tier, setTier] = useState<Tier>(DEFAULT_TIER);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border bg-card p-5">
        <TierPicker value={tier} onValueChange={setTier} label={`What ${groupName} sees`} />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        size="lg"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await joinGroup({ code, tier });
            if (!res.ok) return setError(res.error);
            if (afterJoin) await afterJoin();
            else router.push(`/groups/${res.data.groupId}` as Route);
          })
        }
      >
        Join {groupName}
      </Button>
    </div>
  );
}
