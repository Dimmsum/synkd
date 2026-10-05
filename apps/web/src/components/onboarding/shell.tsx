import { Logo } from '@synkd/ui/components/misc';
import { cn } from '@synkd/ui/lib/utils';
import { advanceOnboarding } from '@/lib/actions/onboarding';
import { getOnboardingState } from '@/lib/data/onboarding';
import { onboardingSteps, type OnboardingStep } from '@/lib/onboarding';

/**
 * Frame for each onboarding step: progress, title, and "Skip for now". Every step after sign-up
 * can be skipped and picked up later (WF-068): skipping records the step as passed, so
 * /onboarding resumes after it, and skipping the last step lands on Now.
 */
export async function OnboardingShell({
  step,
  title,
  subtitle,
  children,
  skippable = true,
}: {
  step: OnboardingStep;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  skippable?: boolean;
}) {
  const steps = onboardingSteps(await getOnboardingState());
  const current = steps.findIndex((s) => s.key === step);
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 py-5 sm:py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Logo />
        {skippable ? (
          <form action={advanceOnboarding.bind(null, step)}>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
            >
              Skip for now
            </button>
          </form>
        ) : null}
      </div>
      <ol aria-label="Setup progress" className="mb-8 flex gap-2">
        {steps.map((s, i) => (
          <li
            key={s.key}
            aria-current={i === current ? 'step' : undefined}
            className="flex flex-1 flex-col gap-1.5"
          >
            <span
              aria-hidden="true"
              className={cn('h-1.5 rounded-full', i <= current ? 'bg-primary' : 'bg-segment')}
            />
            <span
              className={cn(
                'text-xs font-medium',
                i === current ? 'text-primary-ink' : 'text-muted-foreground',
              )}
            >
              {s.label}
              {i < current ? <span className="sr-only"> (done)</span> : null}
            </span>
          </li>
        ))}
      </ol>
      <main className="flex flex-1 flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-[-0.02em] sm:text-3xl">{title}</h1>
          {subtitle ? <p className="text-body-foreground">{subtitle}</p> : null}
        </div>
        {children}
      </main>
    </div>
  );
}
