import Link from 'next/link';
import { Logo } from '@synkd/ui/components/misc';
import { TimezoneCookie } from '@/components/auth/timezone-cookie';

// Sign-in, sign-up and the sign-up steps (FR-WEB-2). Clerk's components render flat inside
// this card (lib/auth/clerk-appearance.ts); proxy.ts decides who may see which step.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-6 sm:justify-center sm:py-12">
      <TimezoneCookie />
      <Link
        href="/"
        aria-label="synkd home"
        className="mb-6 inline-flex min-h-11 items-center rounded-lg sm:mb-8"
      >
        <Logo />
      </Link>
      <main className="w-full max-w-md rounded-2xl border bg-card p-6 sm:p-8">{children}</main>
    </div>
  );
}
