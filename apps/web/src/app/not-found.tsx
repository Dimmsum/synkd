import Link from 'next/link';
import { buttonVariants } from '@whosfree/ui/components/button';
import { Logo } from '@whosfree/ui/components/misc';

// FR-WEB-8: point people somewhere useful.
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <Logo />
      <div className="flex flex-col gap-2">
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <h1 className="text-2xl font-bold">We couldn&apos;t find that page</h1>
        <p className="max-w-sm text-body-foreground">
          The link might be old, or the invite may have been changed. Try one of these instead.
        </p>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-2 sm:max-w-none sm:flex-row sm:justify-center">
        <Link href="/now" className={buttonVariants()}>
          See who&apos;s free
        </Link>
        <Link href="/" className={buttonVariants({ variant: 'outline' })}>
          Go to the home page
        </Link>
      </div>
    </main>
  );
}
