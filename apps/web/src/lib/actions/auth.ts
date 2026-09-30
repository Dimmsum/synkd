'use server';

// Sign-up steps after signing in with Google or email (D45): age gate (WF-005) and consent (WF-015). Both write
// through database functions as the signed-in user; proxy.ts only lets each one run while it's
// the user's current step.

import { redirect } from 'next/navigation';
import { checkAge, localDateIn } from '@whosfree/shared';
import type { AgeCheckFailure } from '@whosfree/shared';
import { createServerSupabase } from '@/lib/supabase/server';

export type FormState = { error?: string } | undefined;

const AGE_ERRORS: Record<Exclude<AgeCheckFailure, 'under_age'>, string> = {
  invalid_date: 'Enter your full date of birth.',
  in_future: 'That date is in the future. Check the year?',
  implausible: 'Check the year you were born.',
};

const TRY_AGAIN = 'Something went wrong on our side. Try again.';

/**
 * Checks the date of birth against today in Jamaica (FR-AUTH-6, D29) and stores only the
 * birth year (`confirm_age`, write-once). The full date stays inside this action: it isn't
 * stored, logged or sent to the database.
 */
export async function confirmAge(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = checkAge(formData.get('dateOfBirth'), localDateIn(Date.now()));

  if (!result.ok) {
    // The not-eligible page signs the user out. The check is self-declared (D29), so nothing
    // is recorded; accounts found to be under 18 are handled by suspension (FR-AUTH-6).
    if (result.reason === 'under_age') redirect('/sign-up/not-eligible');
    return { error: AGE_ERRORS[result.reason] };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('confirm_age', {
    birth_year: result.birthYear,
  });
  if (error) {
    console.error('confirm_age failed', error.code);
    return { error: TRY_AGAIN };
  }
  redirect('/sign-up/terms');
}

/**
 * Records acceptance of the terms/privacy version the page showed (FR-SET-5): the database
 * stores `consent_version` and `consent_at`, and refuses a version that is no longer current.
 * New users go on to onboarding; users re-accepting after a policy change go back to the app.
 */
export async function acceptTerms(_prev: FormState, formData: FormData): Promise<FormState> {
  if (formData.get('accept') !== 'on') {
    return { error: 'Tick the box to agree to the terms and privacy notice.' };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('accept_consent', {
    version: String(formData.get('version') ?? ''),
  });
  if (error) {
    // 22023: the version changed while the page was open.
    if (error.code === '22023') {
      return { error: 'We just updated these. Reload the page to read the new version.' };
    }
    console.error('accept_consent failed', error.code);
    return { error: TRY_AGAIN };
  }
  // A remembered invite (WF-045) rides along in its cookie: onboarding's sharing step reads it
  // and offers the tier picker before joining (lib/social/invite-cookie.ts).
  redirect(formData.get('renewal') === '1' ? '/now' : '/onboarding');
}
