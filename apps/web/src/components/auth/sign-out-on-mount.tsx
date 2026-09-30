'use client';

import { useEffect } from 'react';
import { useAuth, useClerk } from '@clerk/nextjs';

/** Ends the Clerk session and stays on `redirectUrl` (the under-18 block, WF-005). */
export function SignOutOnMount({ redirectUrl }: { redirectUrl: string }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();

  useEffect(() => {
    if (isLoaded && isSignedIn) void signOut({ redirectUrl });
  }, [isLoaded, isSignedIn, signOut, redirectUrl]);

  return null;
}
