'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { DEFAULT_GROUP_MAX_MEMBERS } from '@synkd/shared';
import { Check, Plus } from 'lucide-react';
import { Button, buttonVariants } from '@synkd/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@synkd/ui/components/dialog';
import { Input } from '@synkd/ui/components/input';
import { Label } from '@synkd/ui/components/label';
import { cn } from '@synkd/ui/lib/utils';
import { createGroup } from '@/lib/actions/social';

export const GROUP_EMOJIS = [
  '🏠',
  '📚',
  '🏐',
  '⚽',
  '🎮',
  '🍗',
  '⛪',
  '🎶',
  '💼',
  '🏋️',
  '🎲',
  '🌴',
];

/** Create a group (FR-SOC-2). The creator becomes its admin (FR-SOC-7). */
export function NewGroupDialog({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(GROUP_EMOJIS[0] ?? '🏠');
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setCreated(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden="true" />
          New group
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        {created ? (
          <div role="status" className="flex flex-col items-center gap-3 py-4 text-center">
            <span className="text-4xl" aria-hidden="true">
              {emoji}
            </span>
            <DialogTitle>{name} is ready</DialogTitle>
            <DialogDescription>
              You&apos;re the admin. Make an invite link to bring people in.
            </DialogDescription>
            <Check aria-hidden="true" className="size-6 text-status-free-ink" />
            <Link
              href={`/groups/${created}/settings#invite` as Route}
              onClick={() => setOpen(false)}
              className={buttonVariants({ className: 'w-full' })}
            >
              Invite people
            </Link>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(undefined);
              startTransition(async () => {
                const res = await createGroup({ name, emoji });
                if (res.ok) setCreated(res.data.groupId);
                else setError(res.error);
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>New group</DialogTitle>
              <DialogDescription>
                Up to {DEFAULT_GROUP_MAX_MEMBERS} people. Joining a group doesn&apos;t make people
                friends, and each member picks what the group sees.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="group-name">Name</Label>
              <Input
                id="group-name"
                maxLength={40}
                placeholder="Flat 4"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Emoji</legend>
              <div className="grid grid-cols-6 gap-2">
                {GROUP_EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    aria-pressed={emoji === e}
                    aria-label={`Use ${e}`}
                    onClick={() => setEmoji(e)}
                    className={cn(
                      'flex aspect-square min-h-11 items-center justify-center rounded-xl border text-xl',
                      emoji === e
                        ? 'border-primary bg-primary-soft ring-2 ring-primary/40'
                        : 'bg-card',
                    )}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </fieldset>
            {error ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={pending || !name.trim()}>
                Create group
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
