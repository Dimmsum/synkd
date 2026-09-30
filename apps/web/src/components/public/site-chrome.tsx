import Link from 'next/link';
import { buttonVariants } from '@whosfree/ui/components/button';
import { Logo } from '@whosfree/ui/components/misc';
import { cn } from '@whosfree/ui/lib/utils';

export function SiteHeader() {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
      <Link href="/" className="rounded-lg" aria-label="Who's Free home">
        <Logo />
      </Link>
      <nav aria-label="Account" className="flex items-center gap-1 sm:gap-2">
        <Link href="/sign-in" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          Sign in
        </Link>
        <Link href="/sign-up" className={buttonVariants({ size: 'sm' })}>
          Get started
        </Link>
      </nav>
    </header>
  );
}

export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer className={cn('border-t bg-card', className)}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>Who&apos;s Free · for adults 18+ · Made in Jamaica</p>
        <nav aria-label="Legal and help" className="flex flex-wrap gap-x-1">
          {(
            [
              ['/privacy', 'Privacy'],
              ['/terms', 'Terms'],
              ['/help', 'Help'],
              ['/contact', 'Contact'],
            ] as const
          ).map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="inline-flex min-h-11 items-center rounded-md px-2 font-medium text-body-foreground hover:text-foreground"
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
