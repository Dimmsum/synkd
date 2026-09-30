import type { Metadata } from 'next';
import { EyeOff, MapPinOff, Trash } from 'lucide-react';
import type { AccountStatus } from '@whosfree/backend';
import { TermsForm } from '@/components/auth/terms-form';
import { SignUpSteps } from '@/components/auth/sign-up-steps';
import { createServerSupabase } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Terms and privacy' };

const POINTS = [
  { icon: EyeOff, text: 'Everyone sees only Free/Busy with times until you choose to share more.' },
  { icon: MapPinOff, text: 'We never store or share where you are.' },
  { icon: Trash, text: 'Uploaded schedule files are deleted once you confirm your schedule.' },
] as const;

// Consent (FR-SET-5, WF-015): the last sign-up step, and shown again whenever the terms/privacy
// version changes (proxy.ts sends users here while `account_status().consent_required`).
export default async function TermsPage() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('account_status').single();
  if (error) throw new Error(`account_status failed (${error.code})`);
  const status: AccountStatus = data;
  // Someone who accepted an older version is re-accepting, not signing up.
  const renewal = status.consent_version !== null;

  return (
    <div className="flex flex-col">
      {renewal ? null : <SignUpSteps current={2} />}
      <div className="mb-5 flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold tracking-[-0.02em]">
          {renewal ? 'We’ve updated our terms' : 'The short version'}
        </h1>
        <p className="text-body-foreground">
          {renewal
            ? 'Please read and accept the new version to keep using Who’s Free. Here’s how we treat your data.'
            : 'Before you start, here’s how we treat your data.'}
        </p>
      </div>
      <ul className="mb-6 flex flex-col gap-3">
        {POINTS.map((p) => (
          <li key={p.text} className="flex gap-3 text-sm text-body-foreground">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-status-free-soft text-status-free-ink">
              <p.icon aria-hidden="true" className="size-4" />
            </span>
            <span className="pt-1.5">{p.text}</span>
          </li>
        ))}
      </ul>
      <TermsForm version={status.current_consent_version} renewal={renewal} />
    </div>
  );
}
