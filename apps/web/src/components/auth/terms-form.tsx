'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Button } from '@whosfree/ui/components/button';
import { Checkbox } from '@whosfree/ui/components/checkbox';
import { acceptTerms } from '@/lib/actions/auth';

/** Accept the terms and privacy notice (FR-SET-5, WF-015). Never pre-ticked. */
export function TermsForm({
  termsVersion,
  privacyVersion,
}: {
  termsVersion: string;
  privacyVersion: string;
}) {
  // TODO(WF-015): the server action records the accepted versions and time.
  const [state, formAction, pending] = useActionState(acceptTerms, undefined);
  const [checked, setChecked] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <label
        htmlFor="accept"
        className="flex cursor-pointer items-start gap-3 rounded-xl border p-4 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-soft/50"
      >
        <Checkbox
          id="accept"
          name="accept"
          checked={checked}
          onCheckedChange={(v) => setChecked(v === true)}
          className="mt-0.5"
        />
        <span className="text-sm text-body-foreground">
          I&apos;m 18 or older and I agree to the{' '}
          <Link href="/terms" target="_blank" className="font-semibold text-primary-ink underline">
            Terms of service
          </Link>{' '}
          and the{' '}
          <Link
            href="/privacy"
            target="_blank"
            className="font-semibold text-primary-ink underline"
          >
            Privacy notice
          </Link>
          .
        </span>
      </label>
      <p className="text-xs text-muted-foreground">
        Versions: terms {termsVersion}, privacy {privacyVersion}. If these change, we&apos;ll ask
        you again.
      </p>
      <p role="alert" aria-live="polite" className="min-h-5 text-sm font-medium text-destructive">
        {state?.error}
      </p>
      <Button type="submit" size="lg" disabled={pending || !checked}>
        Agree and continue
      </Button>
    </form>
  );
}
