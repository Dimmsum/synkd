'use client';

import { useId, useState } from 'react';
import {
  DAYS_OF_WEEK,
  EVENT_CATEGORIES,
  EVENT_TITLE_MAX_LENGTH,
  EventDraft,
  type DayOfWeek,
  type EventCategory,
} from '@synkd/shared';
import { Button } from '@synkd/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@synkd/ui/components/dialog';
import { Input } from '@synkd/ui/components/input';
import { Label } from '@synkd/ui/components/label';
import { formatMonthDay } from '@synkd/ui/lib/time';
import { cn } from '@synkd/ui/lib/utils';
import { formatWeekList, parseWeekList } from '@/lib/draft-edit';
import { CATEGORY_LABELS } from '@/lib/status';
import type { DraftEvent } from '@/lib/types';

const DAY_SHORT: Record<DayOfWeek, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

/** Every week, odd/even weeks (A/B), specific week numbers (FR-IMP-5), or one date (FR-IMP-6). */
type Repeat = 'every' | 'odd' | 'even' | 'weeks' | 'date';

const selectClass =
  'h-11 w-full rounded-[10px] border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:h-10';

/** Human description of when a draft event happens. */
export function describeWhen(e: Pick<DraftEvent, 'when'>): string {
  if (e.when.kind === 'date') return formatMonthDay(e.when.date);
  const days = e.when.days.map((d) => DAY_SHORT[d]).join(', ');
  const p = e.when.pattern;
  const repeat =
    p.type === 'every'
      ? 'every week'
      : p.type === 'alternating'
        ? `${p.parity} weeks`
        : `weeks ${formatWeekList(p.weeks)}`;
  return `${days} · ${repeat}`;
}

function repeatOf(event: DraftEvent | null): Repeat {
  if (!event) return 'every';
  if (event.when.kind === 'date') return 'date';
  const p = event.when.pattern;
  return p.type === 'alternating' ? p.parity : p.type;
}

/**
 * Add or edit one event (FR-IMP-11). Reusable for manual entry (WF-031). No location
 * field, on purpose (D35). Validated with the shared EventDraft schema. The name is optional:
 * without one the event is called after its kind ("Class", "Work").
 */
export function EventEditorDialog({
  open,
  onOpenChange,
  event,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: DraftEvent | null;
  onSave: (e: DraftEvent) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        {open ? <EventForm event={event} onSave={onSave} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EventForm({
  event,
  onSave,
}: {
  event: DraftEvent | null;
  onSave: (e: DraftEvent) => void;
}) {
  const id = useId();
  const weeklyWhen = event?.when.kind === 'weekly' ? event.when : null;
  const [title, setTitle] = useState(event?.title ?? '');
  const [category, setCategory] = useState<EventCategory>(event?.category ?? 'class');
  const [days, setDays] = useState<DayOfWeek[]>(weeklyWhen?.days ?? []);
  const [start, setStart] = useState(event?.start ?? '09:00');
  const [end, setEnd] = useState(event?.end ?? '10:00');
  const [repeat, setRepeat] = useState<Repeat>(repeatOf(event));
  const [weeks, setWeeks] = useState(
    weeklyWhen?.pattern.type === 'weeks' ? formatWeekList(weeklyWhen.pattern.weeks) : '',
  );
  const [date, setDate] = useState(event?.when.kind === 'date' ? event.when.date : '');
  const [error, setError] = useState<string>();

  function save() {
    const weekList = repeat === 'weeks' ? parseWeekList(weeks) : null;
    if (repeat === 'weeks' && !weekList) {
      setError('List the weeks as numbers from 1 to 60, like 1–6, 8–12.');
      return;
    }
    const pattern =
      repeat === 'odd' || repeat === 'even'
        ? { type: 'alternating' as const, parity: repeat }
        : weekList
          ? { type: 'weeks' as const, weeks: weekList }
          : { type: 'every' as const };
    const draft = {
      title: title.trim() || CATEGORY_LABELS[category],
      category,
      start,
      end,
      when:
        repeat === 'date'
          ? { kind: 'date' as const, date }
          : {
              kind: 'weekly' as const,
              days: DAYS_OF_WEEK.filter((d) => days.includes(d)),
              pattern,
            },
      // Anything the user has touched is certain.
      confidence: 1,
    };
    const parsed = EventDraft.safeParse(draft);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path[0];
      setError(
        field === 'title'
          ? `Keep the name to ${EVENT_TITLE_MAX_LENGTH} characters.`
          : field === 'when'
            ? repeat === 'date'
              ? 'Pick the date.'
              : 'Pick at least one day.'
            : field === 'end'
              ? 'The end time needs to be different from the start.'
              : 'Check the times.',
      );
      return;
    }
    onSave({ ...parsed.data, id: event?.id ?? `new-${Date.now()}` });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <DialogHeader>
        <DialogTitle>{event ? 'Edit event' : 'Add an event'}</DialogTitle>
        <DialogDescription>We only need what and when, never where.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-title`}>Name (optional)</Label>
        <Input
          id={`${id}-title`}
          value={title}
          maxLength={EVENT_TITLE_MAX_LENGTH}
          placeholder="COMP2140 Lecture"
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-cat`}>Kind</Label>
        <select
          id={`${id}-cat`}
          className={selectClass}
          value={category}
          onChange={(e) => setCategory(e.target.value as EventCategory)}
        >
          {EVENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>
      <fieldset className={repeat === 'date' ? 'hidden' : undefined}>
        <legend className="mb-2 text-sm font-semibold">Days</legend>
        <div className="grid grid-cols-7 gap-1">
          {DAYS_OF_WEEK.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days.includes(d)}
              onClick={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])}
              className={cn(
                'min-h-11 rounded-lg border text-xs font-semibold',
                days.includes(d) ? 'border-primary bg-primary text-primary-foreground' : 'bg-card',
              )}
            >
              {DAY_SHORT[d]}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-start`}>Starts</Label>
          <Input
            id={`${id}-start`}
            type="time"
            step={300}
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="font-mono"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-end`}>Ends</Label>
          <Input
            id={`${id}-end`}
            type="time"
            step={300}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="font-mono"
          />
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        If it ends before it starts, we&apos;ll treat it as running past midnight.
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-repeat`}>Repeats</Label>
        <select
          id={`${id}-repeat`}
          className={selectClass}
          value={repeat}
          onChange={(e) => setRepeat(e.target.value as Repeat)}
        >
          <option value="every">Every week</option>
          <option value="odd">Odd weeks (week A)</option>
          <option value="even">Even weeks (week B)</option>
          <option value="weeks">Only some weeks</option>
          <option value="date">Once, on one date</option>
        </select>
      </div>
      {repeat === 'weeks' ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-weeks`}>Which weeks</Label>
          <Input
            id={`${id}-weeks`}
            value={weeks}
            inputMode="numeric"
            placeholder="1–6, 8–12"
            onChange={(e) => setWeeks(e.target.value)}
            aria-describedby={`${id}-weeks-hint`}
          />
          <p id={`${id}-weeks-hint`} className="text-xs text-muted-foreground">
            Week 1 is the week your schedule starts.
          </p>
        </div>
      ) : null}
      {repeat === 'date' ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-date`}>Date</Label>
          <Input
            id={`${id}-date`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="submit">{event ? 'Save changes' : 'Add event'}</Button>
      </DialogFooter>
    </form>
  );
}
