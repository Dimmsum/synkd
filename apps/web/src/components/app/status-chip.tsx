'use client';

import { useOptimistic, useState, useTransition } from 'react';
import {
  MANUAL_STATUS_LABELS,
  MANUAL_STATUS_TO_STATUS,
  MANUAL_STATUSES,
  STATUS_LABEL_MAX_LENGTH,
  type ManualStatus,
} from '@synkd/shared';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { Button } from '@synkd/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@synkd/ui/components/dialog';
import { Input } from '@synkd/ui/components/input';
import { Label } from '@synkd/ui/components/label';
import { RadioGroup, RadioGroupItem } from '@synkd/ui/components/radio-group';
import { StatusBadge, StatusIcon, type StatusTone } from '@synkd/ui/components/status-badge';
import { cn } from '@synkd/ui/lib/utils';
import { setManualStatus } from '@/lib/actions/status';
import { nextLocalTime, type ActiveOverride } from '@/lib/manual-status';

const DURATIONS = [
  { value: '30', label: '30 min' },
  { value: '60', label: '1 hour' },
  { value: '120', label: '2 hours' },
  { value: 'time', label: 'Until a time' },
  { value: 'forever', label: 'Until I change it' },
] as const;
type Duration = (typeof DURATIONS)[number]['value'];

/** What the chip says: always words next to the status icon, never colour alone (NFR-UX-1). */
interface Shown {
  tone: StatusTone;
  label: string;
  detail?: string;
}

/**
 * The viewer's own status chip (J5, FR-AVL-3, WF-063), in the app shell so it's reachable from
 * every page. Opens a dialog to set a manual status, which overrides the calendar (D5), for a
 * while, until a time ("until 4 PM") or until changed. `manual` is the override in effect, if any.
 * `variant="card"` is the sidebar profile card.
 */
export function StatusChip({
  name,
  tone,
  label,
  detail,
  manual = null,
  timeZone,
  variant = 'chip',
  children,
}: {
  name: string;
  tone: StatusTone;
  label: string;
  detail?: string;
  manual?: ActiveOverride | null;
  /** The viewer's timezone, for "until a time". */
  timeZone: string;
  variant?: 'chip' | 'card';
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ManualStatus>(manual?.status ?? 'busy');
  const [duration, setDuration] = useState<Duration>('60');
  const [untilTime, setUntilTime] = useState('16:00');
  const [note, setNote] = useState(manual?.label ?? '');
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  // The server re-renders the shell with the saved status (revalidatePath); until then, show
  // the choice straight away.
  const [shown, setShown] = useOptimistic<Shown>({ tone, label, detail });
  const summary = shown.detail ? `${shown.label} · ${shown.detail}` : shown.label;

  function endTime(): string | null | undefined {
    if (duration === 'forever') return null;
    if (duration === 'time') return nextLocalTime(untilTime, Date.now(), timeZone)?.toISOString();
    return new Date(Date.now() + Number(duration) * 60_000).toISOString();
  }

  function save(status: ManualStatus | null) {
    setError(undefined);
    const until = status ? endTime() : null;
    if (until === undefined) {
      setError('Pick a time for it to end.');
      return;
    }
    startTransition(async () => {
      if (status) {
        setShown({
          tone: MANUAL_STATUS_TO_STATUS[status],
          label: MANUAL_STATUS_LABELS[status],
          ...(note.trim() ? { detail: note.trim() } : {}),
        });
      }
      const res = await setManualStatus({ status, until, label: status ? note : null });
      if (!res.ok) {
        setError(res.error);
        return;
      }
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
            aria-label={`Your status: ${summary}. Change status`}
          >
            {children}
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[13.5px] font-semibold">{name}</span>
              <StatusBadge tone={shown.tone} className="min-w-0 text-xs" truncate>
                {shown.label}
              </StatusBadge>
              {shown.detail ? (
                <span className="truncate text-xs text-muted-foreground">{shown.detail}</span>
              ) : null}
            </span>
            <ChevronDown aria-hidden="true" className="ml-auto size-4 text-muted-foreground" />
          </button>
        ) : (
          <button
            type="button"
            className="flex min-h-11 max-w-[60vw] items-center gap-1.5 rounded-full border bg-card px-3 text-xs"
            aria-label={`Your status: ${summary}. Change status`}
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
            This overrides your schedule until it ends. Right now: {summary}
            {manual ? ' (set by you)' : ''}.
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
              <span className="text-sm font-medium">{MANUAL_STATUS_LABELS[s]}</span>
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
                  d.value === 'forever' && 'col-span-2',
                  duration === d.value
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-card text-body-foreground',
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
          {duration === 'time' ? (
            <div className="flex items-center gap-2">
              <Label htmlFor="status-until" className="text-sm">
                Until
              </Label>
              <Input
                id="status-until"
                type="time"
                step={900}
                value={untilTime}
                onChange={(e) => setUntilTime(e.target.value)}
                className="w-32 font-mono text-sm"
                aria-describedby="status-until-hint"
              />
              <span id="status-until-hint" className="text-xs text-muted-foreground">
                Tomorrow if that time has passed.
              </span>
            </div>
          ) : null}
        </fieldset>
        <div className="flex flex-col gap-2">
          <Label htmlFor="status-note">Note (optional)</Label>
          <Input
            id="status-note"
            value={note}
            maxLength={STATUS_LABEL_MAX_LENGTH}
            placeholder="e.g. Revising for exams"
            onChange={(e) => setNote(e.target.value)}
            aria-describedby="status-note-hint"
          />
          <p id="status-note-hint" className="text-xs text-muted-foreground">
            Up to {STATUS_LABEL_MAX_LENGTH} characters. Don&apos;t say where you are.
          </p>
        </div>
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => save(null)} disabled={pending || !manual}>
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
