'use client';

import Link from 'next/link';
import { Button, buttonVariants } from '@synkd/ui/components/button';
import { Logo } from '@synkd/ui/components/misc';
import { FeedbackButton } from '@/components/app/feedback-dialog';

// FR-WEB-8. `retry` re-fetches the segment, so a passing server error can recover.
// TODO(WF-008): report `error` to Sentry (without PII, NFR-SEC-12).
export default function ErrorPage({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
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
        <Button onClick={retry}>Try again</Button>
        <Link href="/now" className={buttonVariants({ variant: 'outline' })}>
          Back to Now
        </Link>
      </div>
      {/* FR-WEB-10: report it, with the page it happened on. */}
      <FeedbackButton defaultKind="bug" className="text-muted-foreground">
        Report this problem
      </FeedbackButton>
    </main>
  );
}
