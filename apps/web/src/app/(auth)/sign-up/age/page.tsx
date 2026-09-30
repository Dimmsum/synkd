import type { Metadata } from 'next';
import { AgeForm } from '@/components/auth/age-form';
import { SignUpSteps } from '@/components/auth/sign-up-steps';

export const metadata: Metadata = { title: 'Confirm your age' };

// TODO(WF-004/WF-005): only reachable while signed in with an unconfirmed age; app routes
// must redirect here until the age is confirmed (proxy.ts once Clerk is wired).
export default function AgePage() {
  return (
    <div className="flex flex-col">
      <SignUpSteps current={1} />
      <div className="mb-6 flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold tracking-[-0.02em]">When&apos;s your birthday?</h1>
        <p className="text-body-foreground">You must be 18 or older to use Who&apos;s Free.</p>
      </div>
      <AgeForm />
    </div>
  );
}
