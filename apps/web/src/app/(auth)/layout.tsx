import Link from 'next/link';
import { Logo } from '@whosfree/ui/components/misc';

// Custom auth UI (not Clerk's prebuilt components) so it can be wired to Clerk's
// custom-flow hooks later. TODO(WF-004): wrap the app in <ClerkProvider> in the root layout.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-6 sm:justify-center sm:py-12">
      <Link href="/" aria-label="Who's Free home" className="mb-8 rounded-lg sm:mb-10">
        <Logo />
      </Link>
      <main className="w-full max-w-md rounded-2xl border bg-card p-6 sm:p-8">{children}</main>
    </div>
  );
}
