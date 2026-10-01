'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { DEFAULT_TIER, type Tier } from '@whosfree/shared';
import { Check, Copy, Search, UserPlus } from 'lucide-react';
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
import { Separator } from '@whosfree/ui/components/separator';
import { TierPicker } from '@whosfree/ui/components/tier-picker';
import { formatAgo } from '@whosfree/ui/lib/time';
import {
  cancelFriendRequest,
  findPersonByHandle,
  respondToFriendRequest,
  sendFriendRequestTo,
} from '@/lib/actions/social';
import { friendedHref } from '@/lib/offline-friends';
import type { FriendRequest, PublicPerson } from '@/lib/types';
import { ActionButton } from '@/components/app/action-buttons';

const firstName = (name: string) => name.split(' ')[0] ?? name;

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
                {r.person.handle ? `@${r.person.handle} · ` : null}
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
              <ActionButton
                action={() => cancelFriendRequest(r.id)}
                doneLabel="Cancelled"
                variant="ghost"
                ariaLabel={`Cancel your request to ${r.person.name}`}
              >
                Cancel
              </ActionButton>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AcceptDialog({ request }: { request: FriendRequest }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState<Tier>(DEFAULT_TIER);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const first = firstName(request.person.name);

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
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
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
                  router.replace(friendedHref(request.id), { scroll: false });
                } else setError(res.error);
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

type Message = { ok: boolean; text: string };

/**
 * Add a friend (FR-SOC-1): look them up by handle, pick what they'll see (FR-VIS-1, T1
 * preselected), then send. Or share your own friend link / QR code, which opens /add/<you>.
 */
export function AddFriendButton({ friendLink }: { friendLink: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState('');
  const [found, setFound] = useState<PublicPerson | null>(null);
  const [tier, setTier] = useState<Tier>(DEFAULT_TIER);
  const [message, setMessage] = useState<Message>();
  const [pending, startTransition] = useTransition();

  function reset() {
    setFound(null);
    setTier(DEFAULT_TIER);
    setMessage(undefined);
  }

  function lookUp() {
    reset();
    startTransition(async () => {
      const res = await findPersonByHandle(handle);
      if (!res.ok) setMessage({ ok: false, text: res.error });
      else if (!res.data.person) setMessage({ ok: false, text: 'We couldn’t find that person.' });
      else setFound(res.data.person);
    });
  }

  function send(person: PublicPerson) {
    startTransition(async () => {
      const first = firstName(person.name);
      let nowFriends: boolean;
      if (person.relationship === 'request_received') {
        // They already asked: accept, with the tier you picked (FR-VIS-1).
        const res = await respondToFriendRequest({ requestId: person.id, accept: true, tier });
        if (!res.ok) return setMessage({ ok: false, text: res.error });
        nowFriends = true;
      } else {
        const res = await sendFriendRequestTo(person.id, tier);
        if (!res.ok) return setMessage({ ok: false, text: res.error });
        nowFriends = res.data.status === 'accepted';
      }
      setFound(null);
      setHandle('');
      setMessage({
        ok: true,
        text: nowFriends ? `You and ${first} are now friends.` : `Request sent to ${first}.`,
      });
      if (nowFriends) router.replace(friendedHref(person.id), { scroll: false });
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus aria-hidden="true" />
          Add friend
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a friend</DialogTitle>
          <DialogDescription>
            Find them by handle. You choose what they see, and they choose what you see when they
            accept.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            lookUp();
          }}
        >
          <Label htmlFor="friend-handle">Their handle</Label>
          <div className="flex gap-2">
            <Input
              id="friend-handle"
              placeholder="@shanice"
              autoComplete="off"
              autoCapitalize="none"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
            <Button type="submit" variant="outline" disabled={pending || !handle.trim()}>
              <Search aria-hidden="true" />
              Find
            </Button>
          </div>
        </form>

        {found ? <FoundPerson person={found} tier={tier} onTier={setTier} /> : null}
        {message ? (
          <p
            role="status"
            className={message.ok ? 'text-sm text-status-free-ink' : 'text-sm text-destructive'}
          >
            {message.text}
          </p>
        ) : null}
        {found && (found.relationship === 'none' || found.relationship === 'request_received') ? (
          <DialogFooter>
            <Button disabled={pending} onClick={() => send(found)}>
              {found.relationship === 'request_received'
                ? `Accept ${firstName(found.name)}`
                : 'Send request'}
            </Button>
          </DialogFooter>
        ) : null}

        <Separator />
        <FriendLink link={friendLink} />
      </DialogContent>
    </Dialog>
  );
}

function FoundPerson({
  person,
  tier,
  onTier,
}: {
  person: PublicPerson;
  tier: Tier;
  onTier: (t: Tier) => void;
}) {
  const first = firstName(person.name);
  const note = {
    self: 'That’s you!',
    friend: null,
    request_sent: 'You’ve already sent them a request.',
    request_received: `${first} already asked to be friends. Accepting makes you friends now.`,
    none: null,
  }[person.relationship];
  return (
    <div className="flex flex-col gap-4 rounded-xl border p-3">
      <div className="flex items-center gap-3">
        <PersonAvatar name={person.name} hue={person.hue} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold">{person.name}</span>
          <span className="text-xs text-muted-foreground">@{person.handle}</span>
        </span>
        {person.relationship === 'friend' ? (
          <Link
            href={`/friends/${person.id}` as Route}
            className="text-sm font-semibold text-primary-ink underline-offset-2 hover:underline"
          >
            Already friends
          </Link>
        ) : null}
      </div>
      {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      {person.relationship === 'none' || person.relationship === 'request_received' ? (
        <TierPicker value={tier} onValueChange={onTier} label={`What ${first} will see`} />
      ) : null}
    </div>
  );
}

/**
 * The viewer's friend link and its QR code (FR-SOC-1): whoever opens it sees the viewer's name
 * and can send a request, choosing their own tier.
 */
function FriendLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <section aria-labelledby="friend-link-title" className="flex flex-col gap-3">
      <h3 id="friend-link-title" className="text-sm font-semibold">
        Or share your friend link
      </h3>
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <div className="rounded-xl border bg-white p-3">
          <QRCodeSVG value={link} size={128} title="QR code for your friend link" />
        </div>
        <div className="flex w-full min-w-0 flex-col gap-2">
          <p className="text-[13px] text-muted-foreground">
            Friends can scan this or open the link to send you a request.
          </p>
          <div className="flex gap-2">
            <Input
              readOnly
              value={link}
              aria-label="Your friend link"
              className="font-mono text-[12.5px]"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              }}
            >
              <Copy aria-hidden="true" />
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
