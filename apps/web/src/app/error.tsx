'use client';

import Link from 'next/link';
import { Button, buttonVariants } from '@whosfree/ui/components/button';
import { Logo } from '@whosfree/ui/components/misc';

// FR-WEB-8. TODO(WF-008): report `error` to Sentry (without PII, NFR-SEC-12).
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <Logo />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="max-w-sm text-body-foreground">
          That&apos;s on us, not you. Try again, and if it keeps happening, head back to the Now
          screen.
        </p>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-2 sm:max-w-none sm:flex-row sm:justify-center">
        <Button onClick={reset}>Try again</Button>
        <Link href="/now" className={buttonVariants({ variant: 'outline' })}>
          Back to Now
        </Link>
      </div>
    </main>
  );
}
