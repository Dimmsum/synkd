'use client';

import './globals.css';
import { Button, buttonVariants } from '@synkd/ui/components/button';
import { Logo } from '@synkd/ui/components/misc';

// FR-WEB-8: errors in the root layout itself (e.g. auth failing to load), which error.tsx can't
// catch. It replaces the whole document, so it brings its own <html>, <body> and styles.
// TODO(WF-008): report `error` to Sentry (without PII, NFR-SEC-12).
export default function GlobalError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en-JM">
      <body>
        <title>Something went wrong · synkd</title>
        <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
          <Logo />
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold">Something went wrong</h1>
            <p className="max-w-sm text-body-foreground">
              That&apos;s on us, not you. Try again, or reload the Now screen in a moment.
            </p>
          </div>
          <div className="flex w-full max-w-xs flex-col gap-2 sm:max-w-none sm:flex-row sm:justify-center">
            <Button onClick={retry}>Try again</Button>
            {/* A full page load, since the app's layout is what failed. */}
            <a href="/now" className={buttonVariants({ variant: 'outline' })}>
              Reload Now
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
