'use client';

import * as React from 'react';
import { TIER_LABELS, TIERS, type Tier } from '@synkd/shared';
import { EyeOff } from 'lucide-react';
import { cn } from '@synkd/ui/lib/utils';
import { TIER_DETAILS, tierFromString } from '@synkd/ui/lib/tiers';
import { RadioGroup, RadioGroupItem } from '@synkd/ui/components/radio-group';

/**
 * Pick the tier a friend or group will see (FR-VIS-1). T1 is preselected by callers and
 * is the minimum for any connection (D20). Locations are never shared at any tier (D35).
 */
export function TierPicker({
  value,
  onValueChange,
  name,
  label = 'What they can see',
  className,
  showLocationNote = true,
}: {
  value: Tier;
  onValueChange: (tier: Tier) => void;
  name?: string;
  label?: string;
  className?: string;
  showLocationNote?: boolean;
}) {
  const id = React.useId();
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <span id={`${id}-label`} className="text-sm font-semibold">
        {label}
      </span>
      <RadioGroup
        aria-labelledby={`${id}-label`}
        name={name}
        value={String(value)}
        onValueChange={(v) => onValueChange(tierFromString(v))}
        className="gap-2"
      >
        {TIERS.map((tier) => {
          const d = TIER_DETAILS[tier];
          const itemId = `${id}-t${tier}`;
          return (
            <label
              key={tier}
              htmlFor={itemId}
              className={cn(
                'flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border bg-card p-3.5 transition-colors',
                'has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-soft/60',
                'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40',
              )}
            >
              <RadioGroupItem id={itemId} value={String(tier)} className="mt-0.5" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-semibold">
                  {d.title}
                  {tier === 1 ? (
                    <span className="ml-2 text-xs font-medium text-muted-foreground">Default</span>
                  ) : null}
                </span>
                <span className="text-[13px] text-muted-foreground">{d.description}</span>
                <span className="mt-1 text-xs text-body-foreground">
                  They’d see: <q className="font-medium">{d.example}</q>
                </span>
              </span>
            </label>
          );
        })}
      </RadioGroup>
      {showLocationNote ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <EyeOff aria-hidden="true" className="size-3.5" />
          Your location is never shared, at any level.
        </p>
      ) : null}
    </div>
  );
}

/** Compact label for a tier, e.g. "Category". */
export function TierBadge({ tier, className }: { tier: Tier; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary-ink',
        className,
      )}
    >
      {TIER_LABELS[tier]}
    </span>
  );
}
