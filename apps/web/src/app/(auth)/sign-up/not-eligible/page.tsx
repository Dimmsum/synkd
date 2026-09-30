import type { Metadata } from 'next';
import Link from 'next/link';
import { CircleX } from 'lucide-react';
import { buttonVariants } from '@whosfree/ui/components/button';
import { SignOutOnMount } from '@/components/auth/sign-out-on-mount';

export const metadata: Metadata = { title: 'You must be 18 or older' };

// Blocked state of the age gate (FR-AUTH-6, WF-005). The date of birth was never stored, and
// the user is signed out here. Public (see lib/auth/gate.ts), so it still shows once signed out.
export default function NotEligiblePage() {
  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <SignOutOnMount redirectUrl="/sign-up/not-eligible" />
      <span className="flex size-12 items-center justify-center rounded-full bg-status-dnd-soft text-status-dnd-ink">
        <CircleX aria-hidden="true" className="size-6" />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-[-0.02em]">
          You must be 18 or older to use Who&apos;s Free
        </h1>
        <p className="text-body-foreground">
          Thanks for being honest. We didn&apos;t keep your date of birth, and we&apos;ve signed you
          out.
        </p>
      </div>
      <Link href="/" className={buttonVariants({ variant: 'outline', className: 'w-full' })}>
        Back to the home page
      </Link>
    </div>
  );
}
