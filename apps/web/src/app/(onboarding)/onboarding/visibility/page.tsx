import type { Metadata } from 'next';
import Link from 'next/link';
import { EyeOff, ShieldCheck } from 'lucide-react';
import { TIERS } from '@whosfree/shared';
import { buttonVariants } from '@whosfree/ui/components/button';
import { GroupEmoji } from '@whosfree/ui/components/person-avatar';
import { TIER_DETAILS } from '@whosfree/ui/lib/tiers';
import { JoinGroupForm } from '@/components/onboarding/join-group';
import { OnboardingShell } from '@/components/onboarding/shell';
import { getInvite, getRememberedInviteCode } from '@/lib/data/invites';
import { nextStepHref } from '@/lib/onboarding';

export const metadata: Metadata = { title: 'Who sees what' };

// J1.7 (FR-VIS-1). With an invite, pick the group's tier and join; without one, explain
// the default. The invite is the one remembered from /i/<code> (WF-045); `?invite=` still
// works for links made before the cookie existed. Joining clears it.
export default async function OnboardingVisibilityPage({
  searchParams,
}: PageProps<'/onboarding/visibility'>) {
  const { invite: param } = await searchParams;
  const code = (await getRememberedInviteCode()) ?? (typeof param === 'string' ? param : null);
  const invite = code ? await getInvite(code) : null;
  const next = nextStepHref('sharing');

  if (invite && invite.state === 'ok') {
    return (
      <OnboardingShell
        step="sharing"
        title={`What can ${invite.groupName} see?`}
        subtitle={
          <span className="flex items-center gap-2">
            <GroupEmoji emoji={invite.emoji} size="sm" /> {invite.inviterName} invited you. You can
            change this any time.
          </span>
        }
      >
        <JoinGroupForm code={invite.code} groupName={invite.groupName} next={next} />
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell
      step="sharing"
      title="You choose who sees what"
      subtitle="Every friend and group starts at Free/Busy. You can share more with the people you trust."
    >
      <ul className="flex flex-col gap-2">
        {TIERS.map((t) => (
          <li key={t} className="flex flex-col gap-0.5 rounded-2xl border bg-card p-4">
            <span className="font-semibold">
              {TIER_DETAILS[t].title}
              {t === 1 ? (
                <span className="ml-2 text-xs font-medium text-muted-foreground">Default</span>
              ) : null}
            </span>
            <span className="text-sm text-muted-foreground">{TIER_DETAILS[t].description}</span>
            <span className="text-xs text-body-foreground">
              They&apos;d see: “{TIER_DETAILS[t].example}”
            </span>
          </li>
        ))}
      </ul>
      <p className="flex items-center gap-2 text-sm text-body-foreground">
        <EyeOff aria-hidden="true" className="size-4" /> Nobody ever sees where you are.
      </p>
      <p className="flex items-center gap-2 text-sm text-body-foreground">
        <ShieldCheck aria-hidden="true" className="size-4" /> You pick a level each time you add a
        friend or join a group.
      </p>
      <Link href={next} className={buttonVariants({ size: 'lg' })}>
        Got it
      </Link>
    </OnboardingShell>
  );
}
