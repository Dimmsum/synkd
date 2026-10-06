'use client';

import { useId, useState, useTransition } from 'react';
import { PING_TEMPLATES, PING_TEXT_MAX_LENGTH, type PingTemplate } from '@synkd/shared';
import { CircleCheck, Send } from 'lucide-react';
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
import { Label } from '@synkd/ui/components/label';
import { Textarea } from '@synkd/ui/components/textarea';
import { cn } from '@synkd/ui/lib/utils';
import { sendPing } from '@/lib/actions/pings';
import { pingCharsLeft, pingPolicy } from '@/lib/ping-rules';
import type { PresenceStatus } from '@/lib/types';

export type PingTarget =
  | { kind: 'person'; id: string; name: string; status: PresenceStatus; statusLabel: string }
  | { kind: 'group'; id: string; name: string; freeCount: number };

/**
 * Ping someone (J3, WF-092): a template, up to 140 characters of plain text, or both.
 * Free people get pinged straight away; busy/away need a confirmation; do-not-disturb and
 * paused can't be pinged (FR-PING-1). A group ping goes to every free member (FR-PING-5).
 */
export function PingButton({
  target,
  variant = 'soft',
  size = 'sm',
  className,
  label = 'Ping',
}: {
  target: PingTarget;
  variant?: 'default' | 'soft' | 'outline';
  size?: 'sm' | 'default';
  className?: string;
  label?: string;
}) {
  const policy = target.kind === 'person' ? pingPolicy(target.status) : 'allowed';
  const [open, setOpen] = useState(false);

  if (policy === 'blocked') {
    // Visible but disabled, with the reason in the accessible name.
    return (
      <Button
        variant="outline"
        size={size}
        disabled
        className={className}
        aria-label={`Can't ping ${target.name}: ${target.kind === 'person' ? target.statusLabel : ''}`}
      >
        <Send aria-hidden="true" />
        {label}
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={variant}
          size={size}
          className={className}
          aria-label={`${label} ${target.name}`}
        >
          <Send aria-hidden="true" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        {open ? <PingForm target={target} needsConfirm={policy === 'confirm'} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PingForm({ target, needsConfirm }: { target: PingTarget; needsConfirm: boolean }) {
  const id = useId();
  const [template, setTemplate] = useState<PingTemplate>();
  const [text, setText] = useState('');
  const [confirmed, setConfirmed] = useState(!needsConfirm);
  const [error, setError] = useState<string>();
  // The server is the authority (FR-PING-1): if it says they aren't free after all, it asks
  // "Ping anyway?" here, and the answer resends with `confirmed`.
  const [serverConfirm, setServerConfirm] = useState<string>();
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const left = pingCharsLeft(text);
  const canSend = (template || text.trim()) && left >= 0;

  function send(confirm = needsConfirm) {
    setError(undefined);
    setServerConfirm(undefined);
    startTransition(async () => {
      const res = await sendPing({
        to: target.kind === 'person' ? { personId: target.id } : { groupId: target.id },
        template,
        text: text.trim() || undefined,
        confirmed: confirm,
      });
      if (res.ok) setSent(true);
      else if (res.needsConfirmation) setServerConfirm(res.error);
      else setError(res.error);
    });
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center" role="status">
        <CircleCheck aria-hidden="true" className="size-10 text-status-free-ink" />
        <DialogTitle>Ping sent</DialogTitle>
        <DialogDescription>
          {target.kind === 'group'
            ? `Sent to the free members of ${target.name}. Replies show up in your inbox.`
            : `We'll let you know when ${target.name.split(' ')[0]} replies.`}
        </DialogDescription>
      </div>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {target.kind === 'group' ? `Ping ${target.name}` : `Ping ${target.name.split(' ')[0]}`}
        </DialogTitle>
        <DialogDescription>
          {target.kind === 'group'
            ? `Goes to the ${target.freeCount} ${target.freeCount === 1 ? 'person' : 'people'} free right now.`
            : target.statusLabel}
        </DialogDescription>
      </DialogHeader>

      {!confirmed ? (
        <div className="flex flex-col gap-4">
          <p className="rounded-xl bg-status-soon-soft p-3 text-sm text-status-soon-ink">
            {target.name.split(' ')[0]} isn&apos;t free right now. Ping anyway?
          </p>
          <DialogFooter>
            <Button onClick={() => setConfirmed(true)}>Yes, ping anyway</Button>
          </DialogFooter>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Quick message</legend>
            <div className="flex flex-wrap gap-2">
              {PING_TEMPLATES.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={template === t}
                  onClick={() => setTemplate(template === t ? undefined : t)}
                  className={cn(
                    'min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors',
                    template === t
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'bg-card text-body-foreground hover:bg-accent',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-text`}>Add a note (optional)</Label>
            <Textarea
              id={`${id}-text`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder="Patty run? Meet by the gate in 10"
              aria-describedby={`${id}-count`}
              aria-invalid={left < 0}
            />
            <p
              id={`${id}-count`}
              className={cn(
                'text-right text-xs',
                left < 0 ? 'font-semibold text-destructive' : 'text-muted-foreground',
              )}
              aria-live="polite"
            >
              {left >= 0
                ? `${left} of ${PING_TEXT_MAX_LENGTH} characters left`
                : `${-left} over the ${PING_TEXT_MAX_LENGTH}-character limit`}
            </p>
          </div>
          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
          {serverConfirm ? (
            <p
              role="alert"
              className="rounded-xl bg-status-soon-soft p-3 text-sm text-status-soon-ink"
            >
              {serverConfirm}
            </p>
          ) : null}
          <DialogFooter>
            {serverConfirm ? (
              <Button onClick={() => send(true)} disabled={!canSend || pending}>
                <Send aria-hidden="true" />
                Yes, ping anyway
              </Button>
            ) : (
              <Button onClick={() => send()} disabled={!canSend || pending}>
                <Send aria-hidden="true" />
                Send ping
              </Button>
            )}
          </DialogFooter>
        </div>
      )}
    </>
  );
}
