'use client';

import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from '@whosfree/ui/components/button';
import { ActionButton } from '@/components/app/action-buttons';
import { OfflineAvatar } from '@/components/offline-friends/offline-friend-row';
import { deleteOfflineFriend } from '@/lib/actions/offline-friends';

/** What the prompt needs to know about each offline friend. */
export interface OfflineFriendOption {
  id: string;
  nickname: string;
  emoji: string | null;
}

/**
 * The Friends page after someone has just become a real friend (`/friends?friended=<id>`,
 * FR-SOC-19): if the viewer has offline friends, offer to delete the copy they added of this
 * person. The viewer picks which one, if any: offline friends are never matched to accounts or
 * merged automatically (FR-SOC-15). Driven by the URL so it survives the re-render that
 * accepting triggers.
 */
export function OfflineCopyPrompt({
  friendName,
  offlineFriends,
}: {
  friendName: string;
  offlineFriends: readonly OfflineFriendOption[];
}) {
  const router = useRouter();
  return (
    <section
      aria-labelledby="offline-copy-title"
      className="flex flex-col gap-3 rounded-2xl border border-primary/25 bg-card p-4 md:p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="offline-copy-title" className="text-[15px] font-semibold">
          You and {friendName} are friends. Did you add them before they joined?
        </h2>
        <p className="text-[13px] text-muted-foreground">
          If one of these people not on whosfree is them, you can delete that copy and its schedule
          so they don&apos;t show up twice. We never merge the two for you.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {offlineFriends.map((o) => (
          <li key={o.id} className="flex items-center gap-3 rounded-xl border px-3 py-2">
            <OfflineAvatar friend={o} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{o.nickname}</span>
            <ActionButton
              action={() => deleteOfflineFriend(o.id)}
              doneLabel="Deleted"
              variant="outline"
              icon={<Trash2 aria-hidden="true" />}
              ariaLabel={`Delete ${o.nickname} and their schedule`}
            >
              Delete
            </ActionButton>
          </li>
        ))}
      </ul>
      <Button
        variant="ghost"
        onClick={() => router.replace('/friends', { scroll: false })}
        className="self-end"
      >
        Done
      </Button>
    </section>
  );
}
