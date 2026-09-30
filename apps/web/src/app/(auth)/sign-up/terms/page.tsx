import type { Metadata } from 'next';
import { EyeOff, MapPinOff, Trash } from 'lucide-react';
import { TermsForm } from '@/components/auth/terms-form';
import { SignUpSteps } from '@/components/auth/sign-up-steps';
import { LEGAL_VERSIONS } from '@/lib/config';

export const metadata: Metadata = { title: 'Terms and privacy' };

const POINTS = [
  { icon: EyeOff, text: 'Everyone sees only Free/Busy with times until you choose to share more.' },
  { icon: MapPinOff, text: 'We never store or share where you are.' },
  { icon: Trash, text: 'Uploaded schedule files are deleted once you confirm your schedule.' },
] as const;

// TODO(WF-015): also shown again (outside sign-up) when the policy version changes.
export default function TermsPage() {
  return (
    <div className="flex flex-col">
      <SignUpSteps current={2} />
      <div className="mb-5 flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold tracking-[-0.02em]">The short version</h1>
        <p className="text-body-foreground">
          Before you start, here&apos;s how we treat your data.
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
      <TermsForm termsVersion={LEGAL_VERSIONS.terms} privacyVersion={LEGAL_VERSIONS.privacy} />
    </div>
  );
}
