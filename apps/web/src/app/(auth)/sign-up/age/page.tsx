import type { Metadata } from 'next';
import { AgeForm } from '@/components/auth/age-form';
import { SignUpSteps } from '@/components/auth/sign-up-steps';

export const metadata: Metadata = { title: 'Confirm your age' };

// Age gate (FR-AUTH-6, WF-005). proxy.ts shows this page only while the signed-in user's age
// is unconfirmed, and sends every app route here until it is.
export default function AgePage() {
  return (
    <div className="flex flex-col">
      <SignUpSteps current={1} />
      <div className="mb-6 flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold tracking-[-0.02em]">When&apos;s your birthday?</h1>
        <p className="text-body-foreground">You must be 18 or older to use synkd.</p>
      </div>
      <AgeForm />
    </div>
  );
}
