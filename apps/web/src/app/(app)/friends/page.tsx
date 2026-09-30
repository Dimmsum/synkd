import type { Metadata } from 'next';
import { PageHeader } from '@/components/app/page-header';
import { AddFriendButton, FriendRequests } from '@/components/friends/friend-requests';
import { FriendsList } from '@/components/friends/friends-list';
import { appUrl } from '@/lib/config';
import { getFriendRequests, getFriends, getGroups, getNow, getViewer } from '@/lib/data/people';
import { friendLinkUrl } from '@/lib/social/mappers';

export const metadata: Metadata = { title: 'Friends' };

// Friends (WF-042). Group members who aren't friends appear on Now and in their groups.
export default async function FriendsPage() {
  const [friends, requests, groups, viewer, { now, timeZone }] = await Promise.all([
    getFriends(),
    getFriendRequests(),
    getGroups(),
    getViewer(),
    getNow(),
  ]);
  const free = friends.filter((f) => f.status === 'free').length;
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
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <FriendsList friends={friends} groups={groups} now={now} timeZone={timeZone} />
        <FriendRequests requests={requests} now={now} />
      </div>
    </>
  );
}
