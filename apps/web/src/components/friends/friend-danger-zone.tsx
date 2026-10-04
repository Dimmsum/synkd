'use client';

import { ConfirmActionButton } from '@/components/app/confirm-action-button';
import { blockFriend, removeFriend } from '@/lib/actions/social';
import { CONFIRM } from '@/lib/confirmations';

/**
 * Remove or block (FR-SOC-6, WF-047). Blocked people aren't told. Both ask first (WF-135), then
 * end the friendship at once and go back to Friends.
 */
export function FriendDangerZone({
  personId,
  firstName,
  icons,
}: {
  personId: string;
  firstName: string;
  icons: { remove: React.ReactNode; block: React.ReactNode };
}) {
  return (
    <section
      aria-label="Remove or block"
      className="flex flex-col gap-2 rounded-2xl border bg-card p-4"
    >
      <div className="flex flex-wrap gap-2">
        <ConfirmActionButton
          action={() => removeFriend(personId)}
          confirmation={CONFIRM.removeFriend(firstName)}
          doneLabel="Removed"
          variant="outline"
          icon={icons.remove}
        >
          Remove friend
        </ConfirmActionButton>
        <ConfirmActionButton
          action={() => blockFriend(personId)}
          confirmation={CONFIRM.block(firstName)}
          doneLabel="Blocked"
          variant="outline"
          icon={icons.block}
          className="text-destructive"
        >
          Block
        </ConfirmActionButton>
      </div>
      <p className="text-xs text-muted-foreground">
        Removing stops sharing straight away. If you block {firstName}, they can&apos;t see, ping or
        invite you, and they aren&apos;t told.
      </p>
    </section>
  );
}
