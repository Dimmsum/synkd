'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Send, Trash2 } from 'lucide-react';
import { Button } from '@whosfree/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@whosfree/ui/components/dialog';
import { Input } from '@whosfree/ui/components/input';
import { deleteOfflineFriend } from '@/lib/actions/offline-friends';

/**
 * Delete an offline friend (FR-SOC-18), after saying what happens: their schedule goes straight
 * away and can't be brought back. Then back to Friends.
 */
export function DeleteOfflineFriendButton({ id, nickname }: { id: string; nickname: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  return (
    <Dialog onOpenChange={() => setError(undefined)}>
      <DialogTrigger asChild>
        <Button variant="outline" className="text-destructive">
          <Trash2 aria-hidden="true" />
          Delete {nickname}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {nickname}?</DialogTitle>
          <DialogDescription>
            Their schedule is deleted straight away, along with the nickname. This can&apos;t be
            undone.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Keep {nickname}</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await deleteOfflineFriend(id);
                if (res.ok) router.push('/friends');
                else setError(res.error);
              })
            }
          >
            <Trash2 aria-hidden="true" />
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Invite to whosfree (FR-SOC-17, J8 step 4): shares the viewer's own friend link (/add/<id>),
 * through the system share sheet where there is one, else copied. They can't be pinged, so this
 * is the action instead. Nothing about the offline friend goes in the message.
 */
export function InviteToWhosfreeButton({ link, nickname }: { link: string; nickname: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  async function share() {
    const data = {
      title: 'Join me on whosfree',
      text: 'Join me on whosfree so we can see when we’re both free.',
      url: link,
    };
    if (typeof navigator.share === 'function' && navigator.canShare?.(data) !== false) {
      try {
        await navigator.share(data);
        return;
      } catch (err) {
        // Closing the share sheet isn't an error.
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      setState('copied');
    } catch {
      setState('failed');
    }
  }
  return (
    <span className="inline-flex w-full flex-col gap-1 sm:w-auto">
      <Button onClick={share} className="w-full sm:w-auto">
        {state === 'copied' ? <Check aria-hidden="true" /> : <Send aria-hidden="true" />}
        {state === 'copied' ? 'Link copied' : `Invite ${nickname} to whosfree`}
      </Button>
      <span role="status" className="text-xs text-muted-foreground">
        {state === 'copied' ? (
          <>Send it to {nickname}. It opens your friend link.</>
        ) : state === 'failed' ? (
          <>Copy your friend link and send it to {nickname}:</>
        ) : null}
      </span>
      {state === 'failed' ? (
        <Input
          readOnly
          value={link}
          aria-label="Your friend link"
          className="font-mono text-[12.5px]"
          onFocus={(e) => e.currentTarget.select()}
        />
      ) : null}
    </span>
  );
}
