import type { Metadata } from 'next';
import { PageHeader } from '@/components/app/page-header';
import { AddFriendButton, FriendRequests } from '@/components/friends/friend-requests';
import { FriendsList } from '@/components/friends/friends-list';
import { OfflineCopyPrompt } from '@/components/offline-friends/offline-copy-prompt';
import { OfflineFriendsPanel } from '@/components/offline-friends/offline-friends-panel';
import { appUrl } from '@/lib/config';
import { getOfflineFriendsNow } from '@/lib/data/offline-friends';
import { getFriendRequests, getFriends, getGroups, getNow, getViewer } from '@/lib/data/people';
import { friendLinkUrl } from '@/lib/social/mappers';

export const metadata: Metadata = { title: 'Friends' };

// Friends (WF-042), and the people the viewer added who aren't on whosfree (WF-127). Group
// members who aren't friends appear on Now and in their groups.
//
// `?add=offline` opens "Add someone not on whosfree" (linked from Now). `?friended=<id>` follows
// becoming friends with someone: if the viewer has offline friends, it offers to delete the copy
// they added of that person (FR-SOC-19).
export default async function FriendsPage({ searchParams }: PageProps<'/friends'>) {
  const { add, friended } = await searchParams;
  const [friends, requests, groups, viewer, offline, { now, timeZone }] = await Promise.all([
    getFriends(),
    getFriendRequests(),
    getGroups(),
    getViewer(),
    getOfflineFriendsNow(),
    getNow(),
  ]);
  const free = friends.filter((f) => f.status === 'free').length;
  const newFriend =
    typeof friended === 'string' ? friends.find((f) => f.id === friended) : undefined;
  return (
    <>
      <PageHeader
        title="Friends"
        subtitle={
          <>
            {friends.length} friends ·{' '}
            <span className="font-semibold text-status-free-ink">{free} free right now</span>
          </>
        }
        actions={<AddFriendButton friendLink={friendLinkUrl(viewer.id, appUrl())} />}
      />
      {newFriend && offline?.length ? (
        <div className="mb-4">
          <OfflineCopyPrompt
            friendName={newFriend.name.split(' ')[0] ?? newFriend.name}
            offlineFriends={offline.map(({ id, nickname, emoji }) => ({ id, nickname, emoji }))}
          />
        </div>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <FriendsList friends={friends} groups={groups} now={now} timeZone={timeZone} />
        <div className="flex flex-col gap-4">
          <FriendRequests requests={requests} now={now} />
          <OfflineFriendsPanel
            friends={offline}
            now={now}
            timeZone={timeZone}
            openAdd={add === 'offline'}
          />
        </div>
      </div>
    </>
  );
}
