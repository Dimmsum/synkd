'use client';

import { useId, useState, useTransition } from 'react';
import { PING_REPLIES, PING_TEXT_MAX_LENGTH, type PingReply } from '@synkd/shared';
import { Check, Ellipsis, Ban } from 'lucide-react';
import { Button } from '@synkd/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@synkd/ui/components/dropdown-menu';
import { Textarea } from '@synkd/ui/components/textarea';
import { cn } from '@synkd/ui/lib/utils';
import { blockPerson, replyToPing } from '@/lib/actions/pings';
import { pingCharsLeft } from '@/lib/ping-rules';

/** One-tap replies (FR-PING-4) or a short text reply, ≤ 140 characters. */
export function PingReplyBox({ pingId, disabled }: { pingId: string; disabled?: boolean }) {
  const id = useId();
  const [sent, setSent] = useState<string>();
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const left = pingCharsLeft(text);

  function send(reply?: PingReply) {
    setError(undefined);
    start(async () => {
      const res = await replyToPing({ pingId, reply, text: reply ? undefined : text });
      if (res.ok) setSent(reply ?? text.trim());
      else setError(res.error);
    });
  }

  if (sent) {
    return (
      <p
        role="status"
        className="flex items-center gap-1.5 text-sm font-medium text-status-free-ink"
      >
        <Check aria-hidden="true" className="size-4" />
        You replied: <span className="font-semibold break-words">{sent}</span>
      </p>
    );
  }
  if (disabled) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Quick replies">
        {PING_REPLIES.map((r) => (
          <Button
            key={r}
            size="sm"
            variant={r === "I'm down" ? 'default' : 'outline'}
            disabled={pending}
            onClick={() => send(r)}
          >
            {r}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={writing}
          onClick={() => setWriting((w) => !w)}
        >
          Write a reply
        </Button>
      </div>
      {writing ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-reply`} className="sr-only">
            Your reply
          </label>
          <Textarea
            id={`${id}-reply`}
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-describedby={`${id}-left`}
            aria-invalid={left < 0}
          />
          <div className="flex items-center justify-between gap-2">
            <span
              id={`${id}-left`}
              aria-live="polite"
              className={cn(
                'text-xs',
                left < 0 ? 'font-semibold text-destructive' : 'text-muted-foreground',
              )}
            >
              {left >= 0 ? `${left} of ${PING_TEXT_MAX_LENGTH} left` : `${-left} too many`}
            </span>
            <Button size="sm" disabled={pending || !text.trim() || left < 0} onClick={() => send()}>
              Send reply
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Block from a ping (FR-PING-8). Reporting comes with WF-095. */
export function PingMenu({
  // Kept for "Report ping" (WF-095).
  pingId: _pingId,
  personId,
  name,
}: {
  pingId: string;
  personId: string;
  name: string;
}) {
  const [done, setDone] = useState<string>();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`More options for ${name}'s ping`}>
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/* TODO(FR-PING-8, WF-095): "Report ping" (reportPing) once reports reach a moderation
              queue. Until then it isn't offered (WF-134). */}
          <DropdownMenuItem
            className="min-h-11 text-destructive"
            onSelect={async () => {
              const res = await blockPerson(personId);
              if (res.ok) setDone(`${name} is blocked. They won't be told.`);
            }}
          >
            <Ban aria-hidden="true" /> Block {name}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span role="status" className="sr-only">
        {done}
      </span>
      {done ? <p className="basis-full text-xs text-muted-foreground">{done}</p> : null}
    </>
  );
}
