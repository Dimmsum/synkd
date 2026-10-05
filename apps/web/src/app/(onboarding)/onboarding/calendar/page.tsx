import type { Metadata } from 'next';
import { CalendarDays, Check } from 'lucide-react';
import { buttonVariants } from '@synkd/ui/components/button';
import { OnboardingShell } from '@/components/onboarding/shell';
import { advanceOnboarding } from '@/lib/actions/onboarding';

export const metadata: Metadata = { title: 'Connect Google Calendar' };

const POINTS = [
  'We only read when you’re busy, to work out your status.',
  'Titles are kept only if you share Details with someone.',
  'Never descriptions, guests, locations or links. Never sent to AI tools.',
  'Disconnect any time and we delete your Google data within 24 hours.',
];

// J1.6, FR-GCAL-1. Hidden from the flow until WF-080 (see ONBOARDING_FLAGS).
export default function OnboardingCalendarPage() {
  return (
    <OnboardingShell
      step="calendar"
      title="Connect Google Calendar?"
      subtitle="Optional. Your calendar events then count as busy too."
    >
      <ul className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
        {POINTS.map((p) => (
          <li key={p} className="flex gap-3 text-sm text-body-foreground">
            <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-free-ink" />
            {p}
          </li>
        ))}
      </ul>
      {/* TODO(WF-080): our own incremental OAuth for calendar.readonly (D30), not Clerk's. */}
      <button type="button" disabled className={buttonVariants({ size: 'lg' })}>
        <CalendarDays aria-hidden="true" />
        Connect Google Calendar (coming soon)
      </button>
      <form action={advanceOnboarding.bind(null, 'calendar')} className="flex flex-col">
        <button type="submit" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
          Not now
        </button>
      </form>
    </OnboardingShell>
  );
}
