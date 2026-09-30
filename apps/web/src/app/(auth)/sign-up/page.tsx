import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { GoogleButton } from '@/components/auth/google-button';
import { SignUpSteps } from '@/components/auth/sign-up-steps';

export const metadata: Metadata = { title: 'Sign up' };

// TODO(WF-045): if ?invite=<code> is present, remember it (cookie) through sign-up and
// onboarding, and show "You're joining <group>" here.
export default function SignUpPage() {
  return (
    <div className="flex flex-col">
      <SignUpSteps current={0} />
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-bold tracking-[-0.02em]">Create your account</h1>
          <p className="text-body-foreground">
            See who&apos;s free, ping friends and find a time for the whole crew.
          </p>
        </div>
        <GoogleButton mode="sign-up" />
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
