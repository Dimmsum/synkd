import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  AVATAR_BUCKET,
  AVATAR_SIZE_PX,
  AVATAR_STORED_MAX_BYTES,
  AVATAR_UPLOAD_TYPES,
} from '@whosfree/shared';
import { avatarObjectPath, isAvatarObjectName, isStoredAvatarUrl } from './paths';
import { centreSquare } from './shrink';
import { sniffImageType } from './sniff';

vi.mock('server-only', () => ({}));
const { AvatarImageError, processAvatar } = await import('./image');
const { avatarStoreFrom, createAvatarStore } = await import('./store');

const USER = '11111111-1111-4111-8111-111111111111';
const SUPABASE = 'https://abc.supabase.co';

/** A 1200 × 800 photo with a camera's EXIF, including a GPS position. */
async function cameraPhoto(format: 'jpeg' | 'png' | 'webp' = 'jpeg'): Promise<Buffer> {
  return sharp({
    create: { width: 1200, height: 800, channels: 3, background: { r: 200, g: 80, b: 40 } },
  })
    .withExif({
      IFD0: { Make: 'PhoneCo', Model: 'Phone 15', Copyright: 'Kemar' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '18/1 0/1 0/1',
        GPSLongitudeRef: 'W',
        GPSLongitude: '76/1 47/1 0/1',
      },
    })
    .toFormat(format)
    .toBuffer();
}

describe('sniffImageType (WF-040)', () => {
  it('recognises JPEG, PNG and WebP by their first bytes', async () => {
    expect(sniffImageType(await cameraPhoto('jpeg'))).toBe('image/jpeg');
    expect(sniffImageType(await cameraPhoto('png'))).toBe('image/png');
    expect(sniffImageType(await cameraPhoto('webp'))).toBe('image/webp');
    expect(AVATAR_UPLOAD_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });

  it('rejects everything else, whatever the file is called', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    for (const bytes of [
      enc('GIF89a....'),
      enc('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      enc('%PDF-1.7'),
      enc('\u0000\u0000\u0000\u0018ftypheic'),
      enc('RIFF\u0000\u0000\u0000\u0000WAVEfmt '),
      new Uint8Array([0xff, 0xd8]),
      new Uint8Array(),
    ]) {
      expect(sniffImageType(bytes)).toBeNull();
    }
  });
});

describe('processAvatar (WF-040, D35)', () => {
  it('makes a small square WebP and drops all metadata, GPS included', async () => {
    const input = await cameraPhoto();
    const before = await sharp(input).metadata();
    expect(before.exif).toBeDefined(); // the test photo really has EXIF

    const out = await processAvatar(input);
    const meta = await sharp(out).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: AVATAR_SIZE_PX, height: AVATAR_SIZE_PX });
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(out.includes(Buffer.from('PhoneCo'))).toBe(false);
    expect(out.byteLength).toBeLessThanOrEqual(AVATAR_STORED_MAX_BYTES);
    expect(sniffImageType(out)).toBe('image/webp');
  });

  it('applies the EXIF orientation before dropping it', async () => {
    // A 300 × 100 image tagged "rotate 90°" is upright as 100 × 300: left half red, right blue.
    const wide = await sharp({
      create: { width: 300, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .composite([
        {
          input: {
            create: { width: 150, height: 100, channels: 3, background: { r: 0, g: 0, b: 255 } },
          },
          left: 150,
          top: 0,
        },
      ])
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const out = await processAvatar(wide);
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]] as [number, number, number];
    };
    // Rotated upright, the red half is on top and the blue half below.
    const [r1, , b1] = pixel(AVATAR_SIZE_PX / 2, 10);
    const [r2, , b2] = pixel(AVATAR_SIZE_PX / 2, AVATAR_SIZE_PX - 10);
    expect(r1).toBeGreaterThan(b1);
    expect(b2).toBeGreaterThan(r2);
  });

  it('refuses data that only looks like an image', async () => {
    const fake = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);
    await expect(processAvatar(fake)).rejects.toBeInstanceOf(AvatarImageError);
  });
});

describe('avatar paths', () => {
  it('names each upload <user id>/<22 random characters>.webp', () => {
    const path = avatarObjectPath(USER, new Uint8Array(16).fill(7));
    expect(path).toMatch(new RegExp(`^${USER}/[A-Za-z0-9_-]{22}\\.webp$`));
    expect(isAvatarObjectName(path.split('/')[1] ?? '')).toBe(true);
    expect(() => avatarObjectPath(USER, new Uint8Array(8))).toThrow();
  });

  it('tells a stored photo from a Google one', () => {
    const stored = `${SUPABASE}/storage/v1/object/public/${AVATAR_BUCKET}/${USER}/x.webp`;
    expect(isStoredAvatarUrl(stored, SUPABASE)).toBe(true);
    expect(isStoredAvatarUrl(stored, `${SUPABASE}/`)).toBe(true);
    expect(isStoredAvatarUrl('https://lh3.googleusercontent.com/a/abc', SUPABASE)).toBe(false);
    expect(isStoredAvatarUrl(null, SUPABASE)).toBe(false);
    expect(isStoredAvatarUrl(stored, undefined)).toBe(false);
  });

  it('centreSquare crops the middle of the photo', () => {
    expect(centreSquare(1200, 800)).toEqual([200, 0, 800]);
    expect(centreSquare(800, 1200)).toEqual([0, 200, 800]);
    expect(centreSquare(500, 500)).toEqual([0, 0, 500]);
  });
});

describe('avatar store', () => {
  function fakeClient(objects: string[] = []) {
    const calls: { op: string; args: unknown[] }[] = [];
    const bucket = {
      upload: (...args: unknown[]) => {
        calls.push({ op: 'upload', args });
        return Promise.resolve({ error: null });
      },
      getPublicUrl: (path: string) => ({
        data: { publicUrl: `${SUPABASE}/storage/v1/object/public/${AVATAR_BUCKET}/${path}` },
      }),
      list: (...args: unknown[]) => {
        calls.push({ op: 'list', args });
        return Promise.resolve({ data: objects.map((name) => ({ name })), error: null });
      },
      remove: (...args: unknown[]) => {
        calls.push({ op: 'remove', args });
        return Promise.resolve({ error: null });
      },
    };
    const client = { storage: { from: (b: string) => (b === AVATAR_BUCKET ? bucket : null) } };
    return { client: client as unknown as Parameters<typeof avatarStoreFrom>[0], calls };
  }

  it('puts a WebP in the user’s own folder, never overwriting, cached for a year', async () => {
    const { client, calls } = fakeClient();
    const { path, url } = await avatarStoreFrom(client).put(USER, Buffer.from('webp'));
    expect(path.startsWith(`${USER}/`)).toBe(true);
    expect(url).toBe(`${SUPABASE}/storage/v1/object/public/${AVATAR_BUCKET}/${path}`);
    expect(calls[0]?.args[2]).toEqual({
      contentType: 'image/webp',
      cacheControl: String(365 * 24 * 60 * 60),
      upsert: false,
    });
  });

  it('removes the user’s other photos only', async () => {
    const { client, calls } = fakeClient(['a.webp', 'b.webp']);
    await avatarStoreFrom(client).removeAllExcept(USER, `${USER}/b.webp`);
    expect(calls.find((c) => c.op === 'remove')?.args[0]).toEqual([`${USER}/a.webp`]);

    const all = fakeClient(['a.webp']);
    await avatarStoreFrom(all.client).removeAllExcept(USER, null);
    expect(all.calls.find((c) => c.op === 'remove')?.args[0]).toEqual([`${USER}/a.webp`]);
  });

  it('is not configured without the Supabase URL and secret key, naming only the variables', () => {
    expect(createAvatarStore({})).toEqual({
      ok: false,
      problems: ['NEXT_PUBLIC_SUPABASE_URL is not set', 'SUPABASE_SECRET_KEY is not set'],
    });
    expect(createAvatarStore({ NEXT_PUBLIC_SUPABASE_URL: SUPABASE })).toEqual({
      ok: false,
      problems: ['SUPABASE_SECRET_KEY is not set'],
    });
  });
});
