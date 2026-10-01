'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { DEFAULT_TIER, type Tier } from '@whosfree/shared';
import { Check, Copy, Link2, Link2Off, RefreshCw, Search, UserPlus } from 'lucide-react';
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
  createFriendInvite,
  findPersonByHandle,
  regenerateFriendInvite,
  respondToFriendRequest,
  revokeFriendInvite,
  sendFriendRequestTo,
} from '@/lib/actions/social';
import { friendedHref } from '@/lib/offline-friends';
import type { MyFriendInvite } from '@/lib/social/mappers';
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
 * preselected), then send. Or share a link / QR code: your friend invite link (/i/<code>, WF-042)
 * once you've made one, else your friend link, /add/<you>.
 */
export function AddFriendButton({
  friendLink,
  friendInvite,
}: {
  friendLink: string;
  friendInvite: MyFriendInvite | null;
}) {
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
        <FriendLink friendLink={friendLink} initialInvite={friendInvite} />
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
 * The link the viewer shares, and its QR code (FR-SOC-1). Their friend invite link (WF-042) when
 * they have one: it works for people who aren't on Who's Free yet (it's remembered through
 * sign-up) and can be replaced or turned off. Otherwise their friend link, /add/<id>, which
 * always works for people already signed in. Whoever opens either sees the viewer's name and
 * sends a request, choosing their own tier.
 */
function FriendLink({
  friendLink,
  initialInvite,
}: {
  friendLink: string;
  initialInvite: MyFriendInvite | null;
}) {
  const [invite, setInvite] = useState(initialInvite);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const link = invite?.url ?? friendLink;

  function run(
    action: () => Promise<
      { ok: true; invite: MyFriendInvite | null } | { ok: false; error: string }
    >,
  ) {
    setError(undefined);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) return setError(res.error);
      setInvite(res.invite);
      setCopied(false);
    });
  }

  return (
    <section aria-labelledby="friend-link-title" className="flex flex-col gap-3">
      <h3 id="friend-link-title" className="text-sm font-semibold">
        Or share {invite ? 'your invite link' : 'your friend link'}
      </h3>
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <div className="rounded-xl border bg-white p-3">
          <QRCodeSVG
            value={link}
            size={128}
            title={invite ? 'QR code for your invite link' : 'QR code for your friend link'}
          />
        </div>
        <div className="flex w-full min-w-0 flex-col gap-2">
          <p className="text-[13px] text-muted-foreground">
            {invite
              ? 'Anyone can scan this or open the link to send you a request, even if they’re new to Who’s Free.'
              : 'Friends can scan this or open the link to send you a request.'}
          </p>
          <div className="flex gap-2">
            <Input
              readOnly
              value={link}
              aria-label={invite ? 'Your invite link' : 'Your friend link'}
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
          {invite ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const res = await regenerateFriendInvite();
                    return res.ok ? { ok: true, invite: res.data.invite } : res;
                  })
                }
              >
                <RefreshCw aria-hidden="true" />
                New link
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const res = await revokeFriendInvite();
                    return res.ok ? { ok: true, invite: null } : res;
                  })
                }
              >
                <Link2Off aria-hidden="true" />
                Turn off
              </Button>
              <span className="text-xs text-muted-foreground">
                {invite.uses === 1 ? 'Used once' : `Used ${invite.uses} times`}
              </span>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const res = await createFriendInvite();
                  return res.ok ? { ok: true, invite: res.data.invite } : res;
                })
              }
            >
              <Link2 aria-hidden="true" />
              Make an invite link
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            {invite
              ? 'Making a new link, or turning it off, stops this one working.'
              : 'An invite link also works for people who aren’t on Who’s Free yet, and you can turn it off any time.'}
          </p>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
