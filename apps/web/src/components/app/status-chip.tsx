'use client';

import { useState, useTransition } from 'react';
import { MANUAL_STATUS_TO_STATUS, MANUAL_STATUSES, type ManualStatus } from '@whosfree/shared';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { Button } from '@whosfree/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@whosfree/ui/components/dialog';
import { RadioGroup, RadioGroupItem } from '@whosfree/ui/components/radio-group';
import { StatusBadge, StatusIcon, type StatusTone } from '@whosfree/ui/components/status-badge';
import { cn } from '@whosfree/ui/lib/utils';
import { setManualStatus } from '@/lib/actions/pings';

const LABELS: Record<ManualStatus, string> = {
  free: 'Free',
  busy: 'Busy',
  dnd: 'Do not disturb',
  away: 'Away',
  focused: 'Studying/Focused',
};

const DURATIONS = [
  { value: '30', label: '30 min' },
  { value: '60', label: '1 hour' },
  { value: '120', label: '2 hours' },
  { value: 'forever', label: 'Until I change it' },
] as const;

/**
 * The viewer's own status chip (J5). Opens a dialog to set a manual status, which
 * overrides the calendar (D5). `variant="card"` is the sidebar profile card.
 */
export function StatusChip({
  name,
  tone,
  label,
  variant = 'chip',
  children,
}: {
  name: string;
  tone: StatusTone;
  label: string;
  variant?: 'chip' | 'card';
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ManualStatus>('busy');
  const [duration, setDuration] = useState<string>('60');
  const [shown, setShown] = useState<{ tone: StatusTone; label: string }>({ tone, label });
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function save(status: ManualStatus | null) {
    setError(undefined);
    startTransition(async () => {
      const until =
        status && duration !== 'forever'
          ? new Date(Date.now() + Number(duration) * 60_000).toISOString()
          : null;
      const res = await setManualStatus({ status, until });
      if (!res.ok) return setError(res.error);
      setShown(
        status
          ? {
              tone: MANUAL_STATUS_TO_STATUS[status],
              label: `${LABELS[status]} (set by you)`,
            }
          : { tone, label },
      );
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {variant === 'card' ? (
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-xl border bg-card p-2.5 text-left transition-colors hover:bg-background"
            aria-label={`Your status: ${shown.label}. Change status`}
          >
            {children}
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[13.5px] font-semibold">{name}</span>
              <StatusBadge tone={shown.tone} className="text-xs">
                {shown.label}
              </StatusBadge>
            </span>
            <ChevronDown aria-hidden="true" className="ml-auto size-4 text-muted-foreground" />
          </button>
        ) : (
          <button
            type="button"
            className="flex min-h-11 max-w-[60vw] items-center gap-1.5 rounded-full border bg-card px-3 text-xs"
            aria-label={`Your status: ${shown.label}. Change status`}
          >
            <StatusBadge tone={shown.tone} className="min-w-0 text-xs" truncate>
              {shown.label}
            </StatusBadge>
            <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Set your status</DialogTitle>
          <DialogDescription>
            This overrides your schedule until it ends. Right now: {shown.label}.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup
          aria-label="Status"
          value={choice}
          onValueChange={(v) => setChoice(v as ManualStatus)}
          className="gap-1.5"
        >
          {MANUAL_STATUSES.map((s) => (
            <label
              key={s}
              htmlFor={`status-${s}`}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-soft/60"
            >
              <RadioGroupItem id={`status-${s}`} value={s} />
              <StatusIcon tone={MANUAL_STATUS_TO_STATUS[s]} />
              <span className="text-sm font-medium">{LABELS[s]}</span>
              {s === 'focused' ? (
                <span className="ml-auto text-xs text-muted-foreground">Friends see Busy</span>
              ) : null}
              {s === 'dnd' ? (
                <span className="ml-auto text-xs text-muted-foreground">No pings</span>
              ) : null}
            </label>
          ))}
        </RadioGroup>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold">For how long?</legend>
          <div className="grid grid-cols-2 gap-2">
            {DURATIONS.map((d) => (
              <button
                key={d.value}
                type="button"
                aria-pressed={duration === d.value}
                onClick={() => setDuration(d.value)}
                className={cn(
                  'min-h-11 rounded-full border px-3 text-sm font-semibold',
                  duration === d.value
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-card text-body-foreground',
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
        </fieldset>
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => save(null)} disabled={pending}>
            <RotateCcw aria-hidden="true" />
            Back to automatic
          </Button>
          <Button onClick={() => save(choice)} disabled={pending}>
            Set status
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
