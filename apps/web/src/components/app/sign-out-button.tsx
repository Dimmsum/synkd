'use client';

import { SignOutButton as ClerkSignOutButton } from '@clerk/nextjs';
import { LogOut } from 'lucide-react';
import { Button } from '@synkd/ui/components/button';
import { disablePushBeforeSignOut } from '@/lib/push/client';

/**
 * Signs out, first turning push off on this device (WF-091): otherwise the next person to use
 * this browser would get the previous account's ping notifications. Clerk waits for the
 * button's own click handler, which gives up after a few seconds so sign-out never hangs.
 */
export function SignOutButton({
  size,
  className,
}: {
  size?: 'default' | 'sm';
  className?: string;
}) {
  return (
    <ClerkSignOutButton redirectUrl="/">
      <Button
        variant="ghost"
        size={size}
        className={className}
        onClick={() => disablePushBeforeSignOut()}
      >
        <LogOut aria-hidden="true" />
        Sign out
      </Button>
    </ClerkSignOutButton>
  );
}
