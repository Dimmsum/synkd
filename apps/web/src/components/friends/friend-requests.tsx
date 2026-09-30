'use client';

import { useState, useTransition } from 'react';
import { DEFAULT_TIER, type Tier } from '@whosfree/shared';
import { Check, UserPlus } from 'lucide-react';
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
import { Input } from '@whosfree/ui/components/input';
import { Label } from '@whosfree/ui/components/label';
import { PersonAvatar } from '@whosfree/ui/components/person-avatar';
import { TierPicker } from '@whosfree/ui/components/tier-picker';
import { formatAgo } from '@whosfree/ui/lib/time';
import { respondToFriendRequest, sendFriendRequest } from '@/lib/actions/social';
import type { FriendRequest } from '@/lib/types';
import { ActionButton } from '@/components/app/action-buttons';

/**
 * Incoming and outgoing friend requests (FR-SOC-1). Accepting asks what they'll see
 * first, with Free/Busy preselected (FR-VIS-1, D20).
 */
export function FriendRequests({ requests, now }: { requests: FriendRequest[]; now: string }) {
  if (!requests.length) return null;
  return (
    <section aria-labelledby="requests-title" className="rounded-2xl border bg-card p-4 md:p-5">
      <h2 id="requests-title" className="mb-3 text-[15px] font-semibold">
        Friend requests
      </h2>
      <ul className="flex flex-col gap-3">
        {requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3">
            <PersonAvatar name={r.person.name} hue={r.person.hue} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold">{r.person.name}</span>
              <span className="text-xs text-muted-foreground">
                @{r.person.handle} ·{' '}
                {r.direction === 'incoming' ? 'Sent you a request' : 'Waiting for them'} ·{' '}
                {formatAgo(r.sentAt, now)}
              </span>
            </span>
            {r.direction === 'incoming' ? (
              <span className="flex gap-2">
                <AcceptDialog request={r} />
                <ActionButton
                  action={() => respondToFriendRequest({ requestId: r.id, accept: false })}
                  doneLabel="Ignored"
                  variant="outline"
                >
                  Ignore
                </ActionButton>
              </span>
            ) : (
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                Pending
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AcceptDialog({ request }: { request: FriendRequest }) {
  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState<Tier>(DEFAULT_TIER);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const first = request.person.name.split(' ')[0];

  if (done) {
    return (
      <span className="flex min-h-11 items-center gap-1 text-sm font-semibold text-status-free-ink md:min-h-9">
        <Check aria-hidden="true" className="size-4" /> Friends
      </span>
    );
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Accept</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>What can {first} see?</DialogTitle>
          <DialogDescription>You can change this any time.</DialogDescription>
        </DialogHeader>
        <TierPicker value={tier} onValueChange={setTier} label={`What ${first} sees`} />
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await respondToFriendRequest({
                  requestId: request.id,
                  accept: true,
                  tier,
                });
                if (res.ok) {
                  setDone(true);
                  setOpen(false);
                }
              })
            }
          >
            Accept {first}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Add a friend by handle (FR-SOC-1). Invite link and QR code come later. */
export function AddFriendButton() {
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const [pending, startTransition] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setMessage(undefined);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus aria-hidden="true" />
          Add friend
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a friend</DialogTitle>
          <DialogDescription>
            Send a request by handle. They choose what you see when they accept, and you choose what
            they see.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const res = await sendFriendRequest(handle);
              setMessage(
                res.ok
                  ? { ok: true, text: `Request sent to @${handle.replace(/^@/, '')}.` }
                  : { ok: false, text: res.error },
              );
            });
          }}
        >
          <Label htmlFor="friend-handle">Their handle</Label>
          <Input
            id="friend-handle"
            placeholder="@shanice"
            autoComplete="off"
            autoCapitalize="none"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
          />
          {message ? (
            <p
              role="status"
              className={message.ok ? 'text-sm text-status-free-ink' : 'text-sm text-destructive'}
            >
              {message.text}
            </p>
          ) : null}
          {/* TODO(WF-042): QR code and personal invite link. */}
          <DialogFooter>
            <Button type="submit" disabled={pending || !handle.trim()}>
              Send request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
