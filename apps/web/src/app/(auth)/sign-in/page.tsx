import type { Metadata } from 'next';
import Link from 'next/link';
import { SignIn } from '@clerk/nextjs';

export const metadata: Metadata = { title: 'Sign in' };

// Clerk's sign-in (FR-WEB-2, D19). Google and email + password (D45) are enabled in the Clerk
// dashboard, Google with basic profile and email scopes only (FR-AUTH-1). Hash routing keeps Clerk's own steps (e.g. the
// OAuth callback, /sign-in#/sso-callback) on this one route. After sign-in, proxy.ts sends
// the user to the right step.
export default function SignInPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold tracking-[-0.02em]">Welcome back</h1>
        <p className="text-body-foreground">Sign in to see who&apos;s free.</p>
      </div>
      <SignIn routing="hash" signUpUrl="/sign-up" fallbackRedirectUrl="/now" />
      <p className="text-sm text-muted-foreground">
        New here?{' '}
        <Link
          href="/sign-up"
          className="inline-flex min-h-11 items-center font-semibold text-primary-ink underline-offset-2 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
