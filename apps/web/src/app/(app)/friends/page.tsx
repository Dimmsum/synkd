import type { Metadata } from 'next';
import { PageHeader } from '@/components/app/page-header';
import { AddFriendButton, FriendRequests } from '@/components/friends/friend-requests';
import { FriendsList } from '@/components/friends/friends-list';
import { getFriendRequests, getFriends, getGroups, getNow } from '@/lib/data/people';

export const metadata: Metadata = { title: 'Friends' };

// Friends (WF-042). Group members who aren't friends appear on Now and in their groups.
export default async function FriendsPage() {
  const [friends, requests, groups, { now, timeZone }] = await Promise.all([
    getFriends(),
    getFriendRequests(),
    getGroups(),
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
        actions={<AddFriendButton />}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <FriendsList friends={friends} groups={groups} now={now} timeZone={timeZone} />
        <FriendRequests requests={requests} now={now} />
      </div>
    </>
  );
}
