'use client';

import { useState, useTransition } from 'react';
import { BellRing, Check } from 'lucide-react';
import { Button } from '@whosfree/ui/components/button';
import { cn } from '@whosfree/ui/lib/utils';
import type { ActionResult } from '@/lib/actions/result';
import { nudgeToAddSchedule } from '@/lib/actions/pings';

/**
 * A button that runs a server action and then shows a done state, or the action's error.
 */
export function ActionButton({
  action,
  children,
  doneLabel,
  variant = 'outline',
  size = 'sm',
  className,
  icon,
  ariaLabel,
}: {
  action: () => Promise<ActionResult>;
  children: React.ReactNode;
  doneLabel: string;
  variant?: 'default' | 'outline' | 'soft' | 'ghost' | 'destructive' | 'secondary';
  size?: 'sm' | 'default';
  className?: string;
  icon?: React.ReactNode;
  ariaLabel?: string;
}) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  return (
    <span className={cn('inline-flex flex-col', className)}>
      <Button
        variant={done ? 'ghost' : variant}
        size={size}
        disabled={pending || done}
        aria-label={done ? doneLabel : ariaLabel}
        onClick={() =>
          startTransition(async () => {
            const res = await action();
            if (res.ok) setDone(true);
            else setError(res.error);
          })
        }
      >
        {done ? <Check aria-hidden="true" /> : icon}
        {done ? doneLabel : children}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** FR-VIEW-7: nudge someone who hasn't added a schedule yet. Not shown until WF-069 lands. */
export function NudgeButton({ personId, name }: { personId: string; name: string }) {
  return (
    <ActionButton
      action={() => nudgeToAddSchedule(personId)}
      doneLabel="Nudged"
      icon={<BellRing aria-hidden="true" />}
      ariaLabel={`Nudge ${name} to add a schedule`}
    >
      Nudge
    </ActionButton>
  );
}
