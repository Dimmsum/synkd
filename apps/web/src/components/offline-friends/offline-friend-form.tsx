'use client';

import { useId, useState, useTransition } from 'react';
import Link from 'next/link';
import { MAX_OFFLINE_FRIENDS, OFFLINE_FRIEND_NICKNAME_MAX_LENGTH } from '@whosfree/shared';
import { Lock, PenLine, Pencil, Upload, UserRoundPlus } from 'lucide-react';
import { Button, buttonVariants } from '@whosfree/ui/components/button';
import { Checkbox } from '@whosfree/ui/components/checkbox';
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
import { cn } from '@whosfree/ui/lib/utils';
import { createOfflineFriend, updateOfflineFriend } from '@/lib/actions/offline-friends';
import { OFFLINE_FRIEND_LIMIT_MESSAGE } from '@/lib/offline-friends';
import {
  offlineFriendHref,
  offlineManualHref,
  offlineUploadHref,
} from '@/components/offline-friends/offline-friend-row';

/** Emoji to tell offline friends apart at a glance (optional). */
const EMOJIS = ['🙂', '😎', '🤓', '🎧', '📚', '⚽', '🎨', '🎮', '🌟', '🍕', '🐱', '🌸'];

/** Nickname and optional emoji: the only things stored about them (NFR-COMP-9). */
function NicknameFields({
  nickname,
  onNickname,
  emoji,
  onEmoji,
}: {
  nickname: string;
  onNickname: (v: string) => void;
  emoji: string | null;
  onEmoji: (v: string | null) => void;
}) {
  const id = useId();
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-nickname`}>Nickname</Label>
        <Input
          id={`${id}-nickname`}
          maxLength={OFFLINE_FRIEND_NICKNAME_MAX_LENGTH}
          placeholder="Tash"
          autoComplete="off"
          value={nickname}
          onChange={(e) => onNickname(e.target.value)}
          aria-describedby={`${id}-nickname-hint`}
        />
        <p id={`${id}-nickname-hint`} className="text-xs text-muted-foreground">
          Just a name you&apos;ll recognise. No contact details.
        </p>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Emoji (optional)</legend>
        <div className="grid grid-cols-7 gap-2">
          <button
            type="button"
            aria-pressed={emoji === null}
            onClick={() => onEmoji(null)}
            className={cn(
              'flex aspect-square min-h-11 items-center justify-center rounded-xl border text-xs font-semibold',
              emoji === null
                ? 'border-primary bg-primary-soft ring-2 ring-primary/40'
                : 'bg-card text-body-foreground',
            )}
          >
            None
          </button>
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              aria-pressed={emoji === e}
              aria-label={`Use ${e}`}
              onClick={() => onEmoji(e)}
              className={cn(
                'flex aspect-square min-h-11 items-center justify-center rounded-xl border text-xl',
                emoji === e ? 'border-primary bg-primary-soft ring-2 ring-primary/40' : 'bg-card',
              )}
            >
              {e}
            </button>
          ))}
        </div>
      </fieldset>
    </>
  );
}

function FormError({ error }: { error: string | undefined }) {
  return error ? (
    <p role="alert" className="text-sm font-medium text-destructive">
      {error}
    </p>
  ) : null;
}

/**
 * Add a friend who isn't on whosfree (FR-SOC-14, J8 step 1): a nickname, an optional emoji and
 * the permission confirmation the database requires (FR-SOC-16). Then straight on to their
 * schedule: upload it or type it in. Disabled with the reason at the cap (FR-SOC-18).
 */
export function AddOfflineFriendButton({
  count,
  defaultOpen = false,
  variant = 'outline',
  className,
}: {
  /** How many offline friends the viewer has now. */
  count: number;
  defaultOpen?: boolean;
  variant?: 'outline' | 'default' | 'soft';
  className?: string;
}) {
  const atCap = count >= MAX_OFFLINE_FRIENDS;
  const [open, setOpen] = useState(defaultOpen && !atCap);
  const [nickname, setNickname] = useState('');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [permission, setPermission] = useState(false);
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<{ id: string; nickname: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const permissionId = useId();

  function reset() {
    setNickname('');
    setEmoji(null);
    setPermission(false);
    setError(undefined);
    setCreated(null);
  }

  if (atCap) {
    return (
      <span className={cn('inline-flex flex-col gap-1', className)}>
        <Button variant={variant} size="sm" disabled aria-describedby="offline-cap">
          <UserRoundPlus aria-hidden="true" />
          Add someone not on whosfree
        </Button>
        <span id="offline-cap" className="max-w-xs text-xs text-muted-foreground">
          {OFFLINE_FRIEND_LIMIT_MESSAGE}
        </span>
      </span>
    );
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
        <Button variant={variant} size="sm" className={className}>
          <UserRoundPlus aria-hidden="true" />
          Add someone not on whosfree
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        {created ? (
          <div role="status" className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{created.nickname} is added</DialogTitle>
              <DialogDescription>
                Now add their schedule. Upload a photo or PDF of their timetable, or type it in.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                href={offlineUploadHref(created.id)}
                className={buttonVariants({ className: 'w-full sm:flex-1' })}
              >
                <Upload aria-hidden="true" />
                Upload their timetable
              </Link>
              <Link
                href={offlineManualHref(created.id)}
                className={buttonVariants({ variant: 'outline', className: 'w-full sm:flex-1' })}
              >
                <PenLine aria-hidden="true" />
                Type it in
              </Link>
            </div>
            <Link
              href={offlineFriendHref(created.id)}
              onClick={() => setOpen(false)}
              className={buttonVariants({ variant: 'ghost', className: 'w-full' })}
            >
              Later
            </Link>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(undefined);
              startTransition(async () => {
                const res = await createOfflineFriend({
                  nickname,
                  emoji,
                  permissionConfirmed: permission,
                });
                if (res.ok) setCreated({ id: res.data.id, nickname: nickname.trim() });
                else setError(res.error);
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Add someone who isn&apos;t on whosfree</DialogTitle>
              <DialogDescription>
                Add a friend&apos;s timetable to see when they&apos;re free, before they join.
              </DialogDescription>
            </DialogHeader>
            <NicknameFields
              nickname={nickname}
              onNickname={setNickname}
              emoji={emoji}
              onEmoji={setEmoji}
            />
            <p className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2.5 text-xs text-body-foreground">
              <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              Only you can see them and their schedule. They&apos;re never shown to anyone else or
              linked to an account.
            </p>
            <div className="flex items-start gap-3">
              <Checkbox
                id={permissionId}
                checked={permission}
                onCheckedChange={(v) => setPermission(v === true)}
                className="mt-0.5"
              />
              <Label htmlFor={permissionId} className="text-sm leading-5 font-medium">
                I have their permission to add their schedule
              </Label>
            </div>
            <FormError error={error} />
            <DialogFooter>
              <Button type="submit" disabled={pending || !nickname.trim() || !permission}>
                Add {nickname.trim() || 'them'}
              </Button>
            </DialogFooter>
            <p className="text-xs text-muted-foreground">
              Up to {MAX_OFFLINE_FRIENDS} people. You have {count}.
            </p>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Change an offline friend's nickname or emoji (FR-SOC-18). */
export function EditOfflineFriendButton({
  friend,
}: {
  friend: { id: string; nickname: string; emoji: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [nickname, setNickname] = useState(friend.nickname);
  const [emoji, setEmoji] = useState<string | null>(friend.emoji);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setNickname(friend.nickname);
          setEmoji(friend.emoji);
          setError(undefined);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full sm:w-auto">
          <Pencil aria-hidden="true" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(undefined);
            startTransition(async () => {
              const res = await updateOfflineFriend(friend.id, { nickname, emoji });
              if (res.ok) setOpen(false);
              else setError(res.error);
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit {friend.nickname}</DialogTitle>
            <DialogDescription>Only you see this nickname.</DialogDescription>
          </DialogHeader>
          <NicknameFields
            nickname={nickname}
            onNickname={setNickname}
            emoji={emoji}
            onEmoji={setEmoji}
          />
          <FormError error={error} />
          <DialogFooter>
            <Button type="submit" disabled={pending || !nickname.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
