import type { Metadata } from 'next';
import Link from 'next/link';
import { CircleX, UsersRound } from 'lucide-react';
import { buttonVariants } from '@whosfree/ui/components/button';
import { EmptyState } from '@whosfree/ui/components/misc';
import { GroupEmoji } from '@whosfree/ui/components/person-avatar';
import { PageHeader } from '@/components/app/page-header';
import { JoinGroupForm } from '@/components/onboarding/join-group';
import { getInvite } from '@/lib/data/invites';

export const metadata: Metadata = { title: 'Join a group', robots: { index: false } };

// Joining from an invite link when already signed in (WF-045, FR-VIS-1). /i/<code> sends
// signed-in visitors here; proxy.ts makes sure their sign-up is finished first. The tier picker
// comes before joining, with Free/Busy preselected (D20).
export default async function JoinPage({ params }: PageProps<'/join/[code]'>) {
  const invite = await getInvite((await params).code);

  if (invite.state !== 'ok') {
    return (
      <>
        <PageHeader title="Join a group" />
        <EmptyState
          icon={invite.state === 'full' ? UsersRound : CircleX}
          title={invite.state === 'full' ? 'This group is full' : 'This invite link doesn’t work'}
          action={
            <Link href="/groups" className={buttonVariants({ variant: 'outline' })}>
              Your groups
            </Link>
          }
        >
          {invite.state === 'full'
            ? `Ask ${invite.inviterName.split(' ')[0]} to make some room.`
            : 'It may have been turned off or replaced. Ask whoever sent it for a new one.'}
        </EmptyState>
      </>
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
