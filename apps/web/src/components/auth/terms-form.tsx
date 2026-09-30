'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Button } from '@whosfree/ui/components/button';
import { Checkbox } from '@whosfree/ui/components/checkbox';
import { acceptTerms } from '@/lib/actions/auth';

/**
 * Accept the terms and privacy notice (FR-SET-5, WF-015). Never pre-ticked. `version` is the
 * one this page shows (both documents share it); the server refuses it if it's out of date.
 */
export function TermsForm({ version, renewal }: { version: string; renewal: boolean }) {
  const [state, formAction, pending] = useActionState(acceptTerms, undefined);
  const [checked, setChecked] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="version" value={version} />
      {renewal ? <input type="hidden" name="renewal" value="1" /> : null}
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
        Version {version}. If the terms or privacy notice change, we&apos;ll ask you again.
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
