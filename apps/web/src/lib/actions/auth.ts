'use server';

// Sign-up steps after Google sign-in: age gate (WF-005) and consent (WF-015).
// These are stubs. They validate input and redirect, but don't persist anything yet.

import { redirect } from 'next/navigation';
import { dateKey } from '@whosfree/ui/lib/time';
import { checkAge } from '@/lib/age';
import { FALLBACK_TIMEZONE, LEGAL_VERSIONS } from '@/lib/config';

export type FormState = { error?: string } | undefined;

export async function confirmAge(_prev: FormState, formData: FormData): Promise<FormState> {
  const dateOfBirth = String(formData.get('dateOfBirth') ?? '');
  // TODO(WF-004): use the viewer's timezone from their profile once Clerk + users exist.
  const today = dateKey(new Date(), FALLBACK_TIMEZONE);
  const result = checkAge(dateOfBirth, today);

  if (!result.ok) {
    if (result.reason === 'under_18') {
      // TODO(WF-005): mark the Clerk user as blocked (and sign them out) so they can't
      // retry with a different date straight away.
      redirect('/sign-up/not-eligible');
    }
    return {
      error:
        result.reason === 'future'
          ? 'That date is in the future. Check the year?'
          : 'Enter your full date of birth.',
    };
  }

  // TODO(WF-005): save ONLY { birthYear: result.birthYear, ageConfirmedAt: now } on the
  // users row. The full date of birth must never be written anywhere (D29).
  redirect('/sign-up/terms');
}

export async function acceptTerms(_prev: FormState, formData: FormData): Promise<FormState> {
  if (formData.get('accept') !== 'on') {
    return { error: 'Tick the box to agree to the terms and privacy notice.' };
  }
  // TODO(WF-015): record { consentVersion: LEGAL_VERSIONS, consentAt: now } on the users row.
  void LEGAL_VERSIONS;
  // TODO(WF-045): if an invite code was remembered through sign-up, carry it into onboarding.
  redirect('/onboarding');
}
