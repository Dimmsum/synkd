'use client';

import { useActionState, useId, useState } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@whosfree/ui/components/button';
import { Input } from '@whosfree/ui/components/input';
import { Label } from '@whosfree/ui/components/label';
import { confirmAge } from '@/lib/actions/auth';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const selectClass =
  'h-11 w-full rounded-[10px] border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:h-10 md:text-sm';

/**
 * Date of birth for the 18+ age gate (FR-AUTH-6, WF-005). Separate day/month/year fields
 * are quicker than a calendar picker for birth dates. Only the birth year is kept.
 */
export function AgeForm() {
  // TODO(WF-004): swap the server action for the Clerk-backed one once auth exists.
  const [state, formAction, pending] = useActionState(confirmAge, undefined);
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const id = useId();

  const dateOfBirth =
    day && month && year.length === 4
      ? `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
      : '';

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <fieldset className="flex flex-col gap-2" aria-describedby={`${id}-hint`}>
        <legend className="mb-2 text-sm font-semibold">Date of birth</legend>
        <div className="grid grid-cols-[4.5rem_1fr_5.5rem] gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-day`} className="text-xs text-muted-foreground">
              Day
            </Label>
            <Input
              id={`${id}-day`}
              inputMode="numeric"
              autoComplete="bday-day"
              maxLength={2}
              placeholder="DD"
              value={day}
              onChange={(e) => setDay(e.target.value.replace(/\D/g, ''))}
              aria-invalid={Boolean(state?.error)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-month`} className="text-xs text-muted-foreground">
              Month
            </Label>
            <select
              id={`${id}-month`}
              autoComplete="bday-month"
              className={selectClass}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              aria-invalid={Boolean(state?.error)}
            >
              <option value="">Month</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={String(i + 1)}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-year`} className="text-xs text-muted-foreground">
              Year
            </Label>
            <Input
              id={`${id}-year`}
              inputMode="numeric"
              autoComplete="bday-year"
              maxLength={4}
              placeholder="YYYY"
              value={year}
              onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))}
              aria-invalid={Boolean(state?.error)}
            />
          </div>
        </div>
        <input type="hidden" name="dateOfBirth" value={dateOfBirth} />
        <p id={`${id}-hint`} className="flex gap-2 text-[13px] text-muted-foreground">
          <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          We only keep your birth year. Your full date of birth is used for this check and then
          thrown away.
        </p>
      </fieldset>
      <p role="alert" aria-live="polite" className="min-h-5 text-sm font-medium text-destructive">
        {state?.error}
      </p>
      <Button type="submit" size="lg" disabled={pending || !dateOfBirth}>
        Continue
      </Button>
    </form>
  );
}
