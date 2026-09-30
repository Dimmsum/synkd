import type { Metadata } from 'next';
import Link from 'next/link';
import { GoogleButton } from '@/components/auth/google-button';

export const metadata: Metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold tracking-[-0.02em]">Welcome back</h1>
        <p className="text-body-foreground">Sign in to see who&apos;s free.</p>
      </div>
      <GoogleButton mode="sign-in" />
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
