import type { Metadata } from 'next';
import { WifiOff } from 'lucide-react';
import { buttonVariants } from '@whosfree/ui/components/button';
import { Logo } from '@whosfree/ui/components/misc';

export const metadata: Metadata = {
  title: "You're offline",
  robots: { index: false },
};

// Offline fallback (FR-PWA-1, WF-090). The service worker precaches this page and serves it when a
// navigation fails. It must stay fully static and free of user data, because the cached copy is
// shown to whoever opens the app on this device. WF-110 replaces it with the last-known Now.
export const dynamic = 'force-static';

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <Logo />
      <div className="flex flex-col items-center gap-2">
        <WifiOff aria-hidden="true" className="size-6 text-muted-foreground" />
        <h1 className="text-2xl font-bold">You&apos;re offline</h1>
        <p className="max-w-sm text-body-foreground">
          Who&apos;s Free needs a connection to show who&apos;s free right now. Check your Wi-Fi or
          mobile data, then try again.
        </p>
      </div>
      {/* A plain link, so it works without JavaScript and reloads through the network. */}
      <a href="/now" className={buttonVariants()}>
        Try again
      </a>
    </main>
  );
}
