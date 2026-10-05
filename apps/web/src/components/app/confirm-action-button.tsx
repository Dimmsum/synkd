'use client';

import { useState, useTransition } from 'react';
import { Button } from '@synkd/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@synkd/ui/components/dialog';
import type { ActionResult } from '@/lib/actions/result';
import type { Confirmation } from '@/lib/confirmations';

/**
 * ActionButton for an action that's hard to take back (WF-135): the button only asks
 * (`confirmation`, lib/confirmations.ts), and the action runs from the dialog's confirm button.
 * Errors show in the dialog; on success it closes and the button shows `doneLabel` (actions
 * that navigate away never get there).
 */
export function ConfirmActionButton({
  action,
  confirmation,
  children,
  doneLabel,
  variant = 'outline',
  size = 'sm',
  className,
  icon,
  ariaLabel,
  destructive = true,
}: {
  action: () => Promise<ActionResult>;
  confirmation: Confirmation;
  children: React.ReactNode;
  doneLabel: string;
  variant?: 'default' | 'outline' | 'soft' | 'ghost' | 'destructive' | 'secondary';
  size?: 'sm' | 'default';
  className?: string;
  icon?: React.ReactNode;
  ariaLabel?: string;
  /** Style the confirm button as destructive. */
  destructive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(undefined);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant={done ? 'ghost' : variant}
          size={size}
          disabled={done}
          aria-label={done ? doneLabel : ariaLabel}
          className={className}
        >
          {icon}
          {done ? doneLabel : children}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{confirmation.title}</DialogTitle>
          <DialogDescription>{confirmation.description}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button variant="ghost">{confirmation.keep}</Button>
          </DialogClose>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await action();
                if (res.ok) {
                  setDone(true);
                  setOpen(false);
                } else setError(res.error);
              })
            }
          >
            {confirmation.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
