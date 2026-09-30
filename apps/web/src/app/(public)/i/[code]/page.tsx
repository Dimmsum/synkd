import type { Metadata } from 'next';
import Link from 'next/link';
import { CircleX, EyeOff, UsersRound } from 'lucide-react';
import { buttonVariants } from '@whosfree/ui/components/button';
import { GroupEmoji } from '@whosfree/ui/components/person-avatar';
import { Logo } from '@whosfree/ui/components/misc';
import { getInvite } from '@/lib/data/invites';

export async function generateMetadata({ params }: PageProps<'/i/[code]'>): Promise<Metadata> {
  const invite = await getInvite((await params).code);
  if (invite.state === 'invalid') return { title: 'Invite', robots: { index: false } };
  // FR-WEB-7 / WF-046: WhatsApp previews read "Join Flat 4 on Who's Free".
  const title = `Join ${invite.groupName} on Who's Free`;
  return {
    title,
    description: `${invite.inviterName} invited you. See when the group is free and link up.`,
    openGraph: { title, description: `${invite.inviterName} invited you.` },
    robots: { index: false },
  };
}

// Invite page (FR-WEB-3, WF-045). Works signed out.
// TODO(WF-045): remember the code (cookie) through sign-up and onboarding; signed-in
// visitors go straight to the tier picker, then join (join_group, one transaction).
export default async function InvitePage({ params }: PageProps<'/i/[code]'>) {
  const invite = await getInvite((await params).code);

  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-6 sm:justify-center sm:py-12">
      <Link href="/" aria-label="Who's Free home" className="mb-8 rounded-lg">
        <Logo />
      </Link>
      <main className="flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border bg-card p-6 text-center sm:p-8">
        {invite.state === 'invalid' ? (
          <>
            <span className="flex size-12 items-center justify-center rounded-full bg-status-off-soft text-status-off-ink">
              <CircleX aria-hidden="true" className="size-6" />
            </span>
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-bold tracking-[-0.02em]">
                This invite link doesn&apos;t work
              </h1>
              <p className="text-body-foreground">
                It may have been turned off or replaced. Ask whoever sent it for a new one.
              </p>
            </div>
            <Link href="/" className={buttonVariants({ variant: 'outline', className: 'w-full' })}>
              What is Who&apos;s Free?
            </Link>
          </>
        ) : (
          <>
            <GroupEmoji emoji={invite.emoji} size="lg" />
            <div className="flex flex-col gap-2">
              <p className="text-body-foreground">{invite.inviterName} invited you to</p>
              <h1 className="text-2xl font-bold tracking-[-0.02em]">{invite.groupName}</h1>
              <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
                <UsersRound aria-hidden="true" className="size-4" />
                {invite.memberCount} {invite.memberCount === 1 ? 'member' : 'members'}
              </p>
            </div>
            {invite.state === 'full' ? (
              <p
                role="status"
                className="w-full rounded-xl bg-status-off-soft p-3 text-sm font-semibold text-status-off-ink"
              >
                This group is full ({invite.maxMembers} people). Ask{' '}
                {invite.inviterName.split(' ')[0]} to make some room.
              </p>
            ) : (
              <>
                <p className="text-body-foreground">
                  See when everyone&apos;s free and link up without the back-and-forth.
                </p>
                <Link
                  href={{ pathname: '/sign-up', query: { invite: invite.code } }}
                  className={buttonVariants({ size: 'lg', className: 'w-full' })}
                >
                  Join {invite.groupName}
                </Link>
                <p className="text-sm text-muted-foreground">
                  Already on Who&apos;s Free?{' '}
                  <Link
                    href={{ pathname: '/sign-in', query: { invite: invite.code } }}
                    className="inline-flex min-h-11 items-center font-semibold text-primary-ink underline-offset-2 hover:underline"
                  >
                    Sign in to join
                  </Link>
                </p>
              </>
            )}
            <p className="flex items-start gap-2 text-left text-xs text-muted-foreground">
              <EyeOff aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              You choose what {invite.groupName} can see before you join. Everyone starts at
              Free/Busy, and nobody ever sees where you are.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
