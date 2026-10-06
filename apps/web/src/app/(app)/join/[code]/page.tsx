import type { Metadata } from 'next';
import Link from 'next/link';
import { CircleX, UsersRound } from 'lucide-react';
import { buttonVariants } from '@synkd/ui/components/button';
import { EmptyState } from '@synkd/ui/components/misc';
import { GroupEmoji } from '@synkd/ui/components/person-avatar';
import { PageHeader } from '@/components/app/page-header';
import { AddPersonView } from '@/components/friends/add-person';
import { JoinGroupForm } from '@/components/onboarding/join-group';
import { getInvite, previewFriendInvite } from '@/lib/data/invites';

export const metadata: Metadata = { title: 'Join from an invite', robots: { index: false } };

function InviteDoesNotWork({
  kind,
  full,
  inviterName,
}: {
  kind: 'group' | 'friend';
  full?: boolean;
  inviterName?: string;
}) {
  return (
    <>
      <PageHeader title={full ? 'Join a group' : 'Invite link'} />
      <EmptyState
        icon={full ? UsersRound : CircleX}
        title={full ? 'This group is full' : 'This invite link doesn’t work'}
        action={
          <Link
            href={kind === 'group' ? '/groups' : '/friends'}
            className={buttonVariants({ variant: 'outline' })}
          >
            {kind === 'group' ? 'Your groups' : 'Your friends'}
          </Link>
        }
      >
        {full && inviterName
          ? `Ask ${inviterName.split(' ')[0]} to make some room.`
          : 'It may have been turned off or replaced. Ask whoever sent it for a new one.'}
      </EmptyState>
    </>
  );
}

// Acting on an invite link when signed in (WF-045, FR-VIS-1). /i/<code> sends signed-in
// visitors here; proxy.ts makes sure their sign-up is finished first, and sends people who
// signed up through a friend invite here once onboarding is done. A group invite gets the tier
// picker, then join_group (one transaction). A friend invite link (WF-042) shows who it adds,
// then the tier picker and a friend request (request_friend_by_invite). Free/Busy is
// preselected either way (D20).
export default async function JoinPage({ params }: PageProps<'/join/[code]'>) {
  const code = (await params).code;
  const invite = await getInvite(code);

  if (invite.state === 'invalid' && invite.reason === 'not_found') {
    // Not a group invite: maybe a friend invite link. The preview is empty across a block
    // either way, so that looks the same as a link that doesn't exist (FR-SOC-6).
    const friend = await previewFriendInvite(code);
    if (friend.state === 'ok') return <AddPersonView person={friend.person} inviteCode={code} />;
    return <InviteDoesNotWork kind="friend" />;
  }

  if (invite.state !== 'ok') {
    return invite.state === 'full' ? (
      <InviteDoesNotWork kind="group" full inviterName={invite.inviterName} />
    ) : (
      <InviteDoesNotWork kind="group" />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col">
      <PageHeader
        title={`What can ${invite.groupName} see?`}
        subtitle={
          <span className="flex items-center gap-2">
            <GroupEmoji emoji={invite.emoji} size="sm" /> {invite.inviterName} invited you ·{' '}
            {invite.memberCount} {invite.memberCount === 1 ? 'member' : 'members'}. You can change
            this any time.
          </span>
        }
      />
      <JoinGroupForm code={invite.code} groupName={invite.groupName} />
    </div>
  );
}
