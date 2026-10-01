import { MAX_OFFLINE_FRIENDS } from '@whosfree/shared';
import { Panel } from '@/components/app/page-header';
import { AddOfflineFriendButton } from '@/components/offline-friends/offline-friend-form';
import { OfflineFriendRow } from '@/components/offline-friends/offline-friend-row';
import { sortOfflineFriends } from '@/lib/offline-friends';
import type { OfflineFriendView } from '@/lib/types';

/**
 * The Friends page's "Not on whosfree" panel (FR-SOC-14, FR-SOC-18, J8): the people the viewer
 * added who aren't on whosfree, with their status, and the button to add another. Only the
 * viewer ever sees this list (FR-SOC-15).
 */
export function OfflineFriendsPanel({
  friends,
  now,
  timeZone,
  openAdd = false,
}: {
  /** Null when they couldn't be read: the panel says so instead of showing an empty list. */
  friends: OfflineFriendView[] | null;
  now: string;
  timeZone: string;
  /** Open the add dialog straight away (`/friends?add=offline`). */
  openAdd?: boolean;
}) {
  const count = friends?.length ?? 0;
  return (
    <Panel
      id="not-on-whosfree"
      title={
        <span className="flex items-center gap-2">
          Not on whosfree
          <span className="rounded-full bg-muted px-2 text-xs font-semibold text-muted-foreground">
            {count}/{MAX_OFFLINE_FRIENDS}
          </span>
        </span>
      }
      bodyClassName="px-2 md:px-3 flex flex-col gap-3"
    >
      <p className="px-2 text-[13px] text-muted-foreground">
        Friends who haven&apos;t joined yet. Add their timetable to see when they&apos;re free. Only
        you can see them.
      </p>
      {friends === null ? (
        <p role="alert" className="px-2 text-sm text-muted-foreground">
          We couldn&apos;t load them right now. Try again in a moment.
        </p>
      ) : friends.length ? (
        <ul className="flex flex-col divide-y divide-border-subtle">
          {sortOfflineFriends(friends).map((f) => (
            <OfflineFriendRow key={f.id} friend={f} now={now} timeZone={timeZone} />
          ))}
        </ul>
      ) : null}
      {friends !== null ? (
        <div className="px-2">
          <AddOfflineFriendButton count={count} defaultOpen={openAdd} />
        </div>
      ) : null}
    </Panel>
  );
}
