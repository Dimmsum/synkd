'use client';

import { useId, useState, useTransition } from 'react';
import { usePathname } from 'next/navigation';
import { FEEDBACK_MESSAGE_MAX_LENGTH, type FeedbackKind } from '@synkd/shared';
import { CircleCheck, MessageSquare, Send } from 'lucide-react';
import { Button } from '@synkd/ui/components/button';
import { Checkbox } from '@synkd/ui/components/checkbox';
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
import { RadioGroup, RadioGroupItem } from '@synkd/ui/components/radio-group';
import { Textarea } from '@synkd/ui/components/textarea';
import { cn } from '@synkd/ui/lib/utils';
import { standalone } from '@/components/pwa/install-store';
import { sendFeedback } from '@/lib/actions/feedback';
import { deviceLabel } from '@/lib/push/capability';

const KINDS: { value: FeedbackKind; label: string; placeholder: string }[] = [
  {
    value: 'bug',
    label: 'Something’s broken',
    placeholder: 'What were you doing, and what went wrong?',
  },
  {
    value: 'idea',
    label: 'Idea or request',
    placeholder: 'What would make synkd more useful for you?',
  },
  { value: 'other', label: 'Something else', placeholder: 'Tell us anything' },
];

/**
 * "Send feedback" (FR-WEB-10, WF-137): a short form for bug reports and ideas, opened from the
 * sidebar, the phone menu and the error page. Controlled, so the phone menu can close its drawer
 * and then open this.
 */
export function FeedbackDialog({
  open,
  onOpenChange,
  defaultKind = 'bug',
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultKind?: FeedbackKind;
  /** An optional `<DialogTrigger asChild>` child. */
  children?: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {children}
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        {open ? <FeedbackForm defaultKind={defaultKind} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/** A button that opens the feedback form. */
export function FeedbackButton({
  defaultKind,
  variant = 'ghost',
  className,
  children = (
    <>
      <MessageSquare aria-hidden="true" />
      Send feedback
    </>
  ),
}: {
  defaultKind?: FeedbackKind;
  variant?: 'ghost' | 'outline';
  className?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <FeedbackDialog open={open} onOpenChange={setOpen} defaultKind={defaultKind}>
      <DialogTrigger asChild>
        <Button variant={variant} className={className}>
          {children}
        </Button>
      </DialogTrigger>
    </FeedbackDialog>
  );
}

function FeedbackForm({ defaultKind }: { defaultKind: FeedbackKind }) {
  const id = useId();
  const pathname = usePathname();
  const [kind, setKind] = useState<FeedbackKind>(defaultKind);
  const [message, setMessage] = useState('');
  // Opt-in: contacting someone needs their say-so.
  const [canContact, setCanContact] = useState(false);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const left = FEEDBACK_MESSAGE_MAX_LENGTH - [...message.trim()].length;
  const canSend = message.trim() !== '' && left >= 0;

  function send() {
    setError(undefined);
    startTransition(async () => {
      const res = await sendFeedback({
        kind,
        message,
        // The path only: usePathname has no query string or hash (they can hold invite codes).
        page: pathname || null,
        device: deviceLabel(navigator.userAgent, navigator.maxTouchPoints ?? 0),
        installed: standalone(),
        canContact,
      });
      if (res.ok) setSent(true);
      else setError(res.error);
    });
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center" role="status">
        <CircleCheck aria-hidden="true" className="size-10 text-status-free-ink" />
        <DialogTitle>Thanks for telling us</DialogTitle>
        <DialogDescription>
          We read every message. It helps us decide what to fix and build next.
        </DialogDescription>
      </div>
    );
  }

  const placeholder = KINDS.find((k) => k.value === kind)?.placeholder;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Send feedback</DialogTitle>
        <DialogDescription>
          Found a bug or have an idea? synkd is new, and what you tell us shapes what we work on.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <RadioGroup
          aria-label="What kind of feedback?"
          value={kind}
          onValueChange={(v) => setKind(v as FeedbackKind)}
          className="gap-1.5"
        >
          {KINDS.map((k) => (
            <label
              key={k.value}
              htmlFor={`${id}-${k.value}`}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-soft/60"
            >
              <RadioGroupItem id={`${id}-${k.value}`} value={k.value} />
              <span className="text-sm font-medium">{k.label}</span>
            </label>
          ))}
        </RadioGroup>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-message`}>Your message</Label>
          <Textarea
            id={`${id}-message`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            placeholder={placeholder}
            aria-describedby={`${id}-count ${id}-note`}
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
            {left < 0
              ? `${-left} over the ${FEEDBACK_MESSAGE_MAX_LENGTH}-character limit`
              : left <= 200
                ? `${left} characters left`
                : null}
          </p>
          <p id={`${id}-note`} className="text-xs text-muted-foreground">
            We also note the page you’re on and your browser type (e.g. “Safari on iPhone”) to help
            us find bugs. Please don’t include anyone’s private details.
          </p>
        </div>

        <div className="flex items-start gap-3">
          <Checkbox
            id={`${id}-contact`}
            checked={canContact}
            onCheckedChange={(v) => setCanContact(v === true)}
            className="mt-0.5"
          />
          <Label htmlFor={`${id}-contact`} className="text-sm leading-5 font-medium">
            You can email me about this
          </Label>
        </div>

        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button onClick={send} disabled={!canSend || pending}>
            <Send aria-hidden="true" />
            {pending ? 'Sending…' : 'Send feedback'}
          </Button>
        </DialogFooter>
      </div>
    </>
  );
}
