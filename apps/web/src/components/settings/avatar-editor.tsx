'use client';

import { useRef, useState, useTransition } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { AVATAR_UPLOAD_MAX_BYTES, AVATAR_UPLOAD_TYPES } from '@whosfree/shared';
import { Avatar, AvatarFallback, AvatarImage } from '@whosfree/ui/components/avatar';
import { Button } from '@whosfree/ui/components/button';
import { initialsOf, personColor } from '@whosfree/ui/components/person-avatar';
import { removeAvatar, uploadAvatar } from '@/lib/actions/avatar';
import { shrinkForUpload } from '@/lib/avatars/shrink';

/**
 * The profile photo with "Change photo" and "Remove photo" (FR-AUTH-2, WF-040). The browser
 * shrinks the photo to a square first; the server checks it, strips everything but the pixels
 * (no location, D35) and stores a small copy. Friends see it unless one of you blocked the other.
 */
export function AvatarEditor({
  name,
  handle,
  hue,
  avatarUrl,
  photoFromGoogle,
}: {
  name: string;
  handle: string;
  hue: number;
  avatarUrl: string | null;
  photoFromGoogle: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(avatarUrl);
  const [fromGoogle, setFromGoogle] = useState(photoFromGoogle);
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const [pending, start] = useTransition();

  function upload(file: File) {
    setMessage(undefined);
    start(async () => {
      const blob = await shrinkForUpload(file);
      if (blob.size > AVATAR_UPLOAD_MAX_BYTES) {
        setMessage({ ok: false, text: 'That photo is too big. Try a smaller one.' });
        return;
      }
      const form = new FormData();
      form.set('photo', blob, 'photo');
      const res = await uploadAvatar(form);
      if (!res.ok) return setMessage({ ok: false, text: res.error });
      setUrl(res.data.url);
      setFromGoogle(false);
      setMessage({ ok: true, text: 'Photo updated' });
    });
  }

  return (
    <div className="mb-5 flex flex-wrap items-center gap-4">
      {/* Decorative: the name is right next to it. */}
      <Avatar aria-hidden="true" className="size-18">
        {url ? <AvatarImage src={url} alt="" referrerPolicy="no-referrer" /> : null}
        <AvatarFallback
          className="text-xl font-bold text-white"
          style={{ background: personColor(hue) }}
        >
          {initialsOf(name)}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <p className="truncate text-lg font-bold">{name}</p>
          <p className="text-sm text-muted-foreground">{handle ? `@${handle}` : 'No handle yet'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            accept={AVATAR_UPLOAD_TYPES.join(',')}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (file) upload(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => input.current?.click()}
          >
            <Camera aria-hidden="true" />
            {url ? 'Change photo' : 'Add a photo'}
          </Button>
          {url ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setMessage(undefined);
                  const res = await removeAvatar();
                  if (!res.ok) return setMessage({ ok: false, text: res.error });
                  setUrl(null);
                  setFromGoogle(false);
                  setMessage({ ok: true, text: 'Photo removed' });
                })
              }
            >
              <Trash2 aria-hidden="true" />
              Remove photo
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground" role="status">
          {pending
            ? 'Saving…'
            : message
              ? null
              : fromGoogle
                ? 'Your photo comes from Google. You can replace it.'
                : 'JPEG, PNG or WebP. We keep a small square copy and nothing else from the file.'}
          {!pending && message ? (
            <span className={message.ok ? 'text-status-free-ink' : 'text-destructive'}>
              {message.text}
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );
}
