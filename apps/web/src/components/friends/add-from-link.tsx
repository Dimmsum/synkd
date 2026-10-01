'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_TIER, type Tier } from '@whosfree/shared';
import { Button } from '@whosfree/ui/components/button';
import { TierPicker } from '@whosfree/ui/components/tier-picker';
import { respondToFriendRequest, sendFriendRequestTo } from '@/lib/actions/social';
import { friendedHref } from '@/lib/offline-friends';

/**
 * From someone's friend link or QR code (FR-SOC-1): pick what they'll see (FR-VIS-1, T1
 * preselected), then send a request, or accept theirs if they already asked.
 */
export function AddFromLinkForm({
  personId,
  firstName,
  theyAsked,
}: {
  personId: string;
  firstName: string;
  theyAsked: boolean;
}) {
  const router = useRouter();
  const [tier, setTier] = useState<Tier>(DEFAULT_TIER);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border bg-card p-5">
        <TierPicker value={tier} onValueChange={setTier} label={`What ${firstName} will see`} />
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
            if (theyAsked) {
              const res = await respondToFriendRequest({ requestId: personId, accept: true, tier });
              // Now friends: Friends offers to delete an offline copy of them (FR-SOC-19).
              if (res.ok) router.push(friendedHref(personId));
              else setError(res.error);
              return;
            }
            const res = await sendFriendRequestTo(personId, tier);
            if (!res.ok) setError(res.error);
            else router.push(res.data.status === 'accepted' ? friendedHref(personId) : '/friends');
          })
        }
      >
        {theyAsked ? `Accept ${firstName}` : `Send ${firstName} a friend request`}
      </Button>
    </div>
  );
}
