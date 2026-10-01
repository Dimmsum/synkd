-- WF-040: the avatars Storage bucket, so users can replace the photo taken from
-- Google, or add one after email sign-up (FR-AUTH-2, FR-SOC-6, D35, D41, D43,
-- NFR-SEC-1, NFR-SEC-2).
--
-- Public bucket, server-only writes:
--
--   * Objects are named `<users.id>/<128-bit random code>.webp`, a new name for
--     every upload. The URL is stored in users.avatar_url, which other users
--     can only read through the block-aware functions (private.visible_profile
--     and the list functions that filter private.is_blocked). Someone blocked
--     either way never gets a URL for a photo uploaded after the block: they
--     can't list the bucket (no policies below) and can't guess the name.
--     Replacing or removing a photo deletes the old object, so an old URL stops
--     working too (subject to CDN caching).
--   * Why not a private bucket with signed URLs: every list that shows a face
--     (Now, friends, groups, inbox) would have to mint a URL per person per
--     render with the secret key, and the access rule would still be the same
--     block-aware functions. A signed URL only shortens how long an already
--     seen photo keeps working.
--   * Clients get no storage.objects policies for this bucket: no listing, no
--     upload, no update, no delete. Uploads come only from the web server (the
--     secret key, apps/web lib/avatars), after it has checked the file's magic
--     bytes and re-encoded it as a small square WebP without metadata (no EXIF,
--     so no GPS: D35). A client uploading directly could skip that.
--   * The bucket itself accepts only WebP up to AVATAR_STORED_MAX_BYTES
--     (@whosfree/shared, 256 KiB), as a second line of defence.
--
-- Storage only exists on Supabase. The test database (PGlite) has no `storage`
-- schema, so the bucket is created only when storage.buckets exists. Applying
-- this file again is safe: it resets the bucket's settings.
--
-- Owner check after applying: Storage → avatars shows "Public", a 256 KB
-- limit and image/webp only, and Storage → Policies lists no policy that
-- mentions the avatars bucket (or applies to every bucket).

do $$
begin
  if pg_catalog.to_regclass('storage.buckets') is null then
    raise notice 'storage.buckets not found: skipping the avatars bucket (not on Supabase)';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('avatars', 'avatars', true, 262144, array['image/webp'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
end
$$;
