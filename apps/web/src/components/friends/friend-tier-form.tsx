'use client';

import { useState, useTransition } from 'react';
import { DEFAULT_TIER, type Tier } from '@whosfree/shared';
import { Button } from '@whosfree/ui/components/button';
import { Switch } from '@whosfree/ui/components/switch';
import { TierPicker } from '@whosfree/ui/components/tier-picker';
import { setFriendTier } from '@/lib/actions/social';

/**
 * What this friend sees of you (FR-VIS-2). A tier set on a friend always wins over group
 * tiers (FR-VIS-3); switching it off falls back to the most restrictive shared group.
 * Replaces the design's "Can see my event titles" toggle.
 */
export function FriendTierForm({
  personId,
  firstName,
  initial,
  groupFallback,
}: {
  personId: string;
  firstName: string;
  initial: Tier | null;
  /** Description of what applies without a friend-level tier. */
  groupFallback: string;
}) {
  const [own, setOwn] = useState(initial !== null);
  const [tier, setTier] = useState<Tier>(initial ?? DEFAULT_TIER);
  const [saved, setSaved] = useState<string>();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      <label className="flex min-h-11 items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="text-sm font-semibold">Set a level just for {firstName}</span>
          <span className="text-xs text-muted-foreground">
            {own ? 'This wins over your group settings.' : groupFallback}
          </span>
        </span>
        <Switch
          checked={own}
          onCheckedChange={setOwn}
          aria-label={`Set a level just for ${firstName}`}
        />
      </label>
      {own ? (
        <TierPicker value={tier} onValueChange={setTier} label={`What ${firstName} sees`} />
      ) : null}
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await setFriendTier(personId, own ? tier : null);
              setSaved(res.ok ? 'Saved' : res.error);
            })
          }
        >
          Save
        </Button>
        <span role="status" className="text-sm text-muted-foreground">
          {saved}
        </span>
      </div>
    </div>
  );
}
