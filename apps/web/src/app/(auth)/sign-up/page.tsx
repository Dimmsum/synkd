import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { SignUp } from '@clerk/nextjs';
import { GroupEmoji } from '@whosfree/ui/components/person-avatar';
import { SignUpSteps } from '@/components/auth/sign-up-steps';
import { getInvite, getRememberedInviteCode } from '@/lib/data/invites';

export const metadata: Metadata = { title: 'Sign up' };

// Clerk's sign-up (FR-WEB-2, D19), step 1 of 3. Hash routing keeps Clerk's own steps on this
// route. proxy.ts creates the users row on the first signed-in request and then sends the
// user on to /sign-up/age.
// Coming from an invite (WF-045): proxy.ts remembered the code on /i/<code>, so this page says
// which group they're joining, and onboarding offers the tier picker and joins.
export default async function SignUpPage({ searchParams }: PageProps<'/sign-up'>) {
  const { invite: param } = await searchParams;
  const code = (await getRememberedInviteCode()) ?? (typeof param === 'string' ? param : null);
  const invite = code ? await getInvite(code) : null;
  return (
    <div className="flex flex-col">
      <SignUpSteps current={0} />
      <div className="flex flex-col gap-6">
        {invite?.state === 'ok' ? (
          <p className="flex items-center gap-3 rounded-xl border bg-card p-3 text-sm">
            <GroupEmoji emoji={invite.emoji} size="sm" />
            <span>
              You&apos;re joining <span className="font-semibold">{invite.groupName}</span>.
              You&apos;ll choose what it can see once you&apos;re set up.
            </span>
          </p>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-bold tracking-[-0.02em]">Create your account</h1>
          <p className="text-body-foreground">
            See who&apos;s free, ping friends and find a time for the whole crew.
          </p>
        </div>
        <SignUp routing="hash" signInUrl="/sign-in" fallbackRedirectUrl="/sign-up/age" />
        <p className="flex gap-2 rounded-xl bg-muted p-3 text-[13px] text-body-foreground">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-free-ink" />
          We only ask Google for your name, email and photo. Never your calendar. You can connect it
          separately later if you want.
        </p>
        <p className="text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link
            href="/sign-in"
            className="inline-flex min-h-11 items-center font-semibold text-primary-ink underline-offset-2 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
