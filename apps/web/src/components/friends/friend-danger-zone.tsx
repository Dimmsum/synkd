'use client';

import { ActionButton } from '@/components/app/action-buttons';
import { blockFriend, removeFriend } from '@/lib/actions/social';

/**
 * Remove or block (FR-SOC-6, WF-047). Blocked people aren't told. Both end the friendship at
 * once and go back to Friends.
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
        <ActionButton
          action={() => removeFriend(personId)}
          doneLabel="Removed"
          variant="outline"
          icon={icons.remove}
        >
          Remove friend
        </ActionButton>
        <ActionButton
          action={() => blockFriend(personId)}
          doneLabel="Blocked"
          variant="outline"
          icon={icons.block}
          className="text-destructive"
        >
          Block
        </ActionButton>
      </div>
      <p className="text-xs text-muted-foreground">
        Removing stops sharing straight away. If you block {firstName}, they can&apos;t see, ping or
        invite you, and they aren&apos;t told.
      </p>
    </section>
  );
}
