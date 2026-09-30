import { cn } from '@whosfree/ui/lib/utils';

const STEPS = ['Account', 'Age', 'Terms'] as const;

/** Progress for the three sign-up steps. */
export function SignUpSteps({ current }: { current: 0 | 1 | 2 }) {
  return (
    <ol aria-label="Sign-up progress" className="mb-6 flex items-center gap-2">
      {STEPS.map((label, i) => (
        <li
          key={label}
          aria-current={i === current ? 'step' : undefined}
          className="flex flex-1 flex-col gap-1.5"
        >
          <span
            className={cn('h-1.5 rounded-full', i <= current ? 'bg-primary' : 'bg-segment')}
            aria-hidden="true"
          />
          <span
            className={cn(
              'text-xs font-medium',
              i === current ? 'text-primary-ink' : 'text-muted-foreground',
            )}
          >
            {i + 1}. {label}
            {i < current ? <span className="sr-only"> (done)</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
