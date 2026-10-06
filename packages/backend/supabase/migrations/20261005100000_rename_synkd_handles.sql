-- WF-011 (D48): the app is now called synkd, so handles containing "synkd"
-- or "synked" (the spelling in the getsynked domain) are reserved in place of
-- "whosfree", and "whosfree" is no longer a reserved word.
--
--   * private.handle_base(name) strips "synkd" and "synked" instead of
--     "whosfree", so generated handles never contain them.
--   * Any existing handle containing them is replaced with a generated one
--     (before the new constraint, which would reject it).
--   * users_handle_not_reserved is recreated. The reserved list must still
--     match RESERVED_HANDLES in @synkd/shared exactly, and the substrings
--     RESERVED_HANDLE_SUBSTRINGS (test/profiles.test.ts compares them).
--
-- The internal identifiers whosfree.friend_pair (advisory lock key),
-- whosfree.now_signalled (transaction setting) and the Realtime policy
-- whosfree_user_channel_receive_own keep their names: nobody sees them.

-- ---------------------------------------------------------------------------
-- private.handle_base(name): as in 20261003700000_generated_handles.sql,
-- removing "synkd" and "synked".
-- ---------------------------------------------------------------------------
create or replace function private.handle_base(name text) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  base text := pg_catalog.regexp_replace(
    pg_catalog.lower(
      pg_catalog.translate(
        coalesce(handle_base.name, ''),
        'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÝýÿ',
        'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOOooooooUUUUuuuuYyy'
      )
    ),
    '[^a-z0-9]', '', 'g'
  );
begin
  -- Removing one occurrence can join the letters around it into another.
  while pg_catalog.strpos(base, 'synkd') > 0 or pg_catalog.strpos(base, 'synked') > 0 loop
    base := pg_catalog.replace(pg_catalog.replace(base, 'synkd', ''), 'synked', '');
  end loop;
  base := pg_catalog.left(pg_catalog.regexp_replace(base, '^[0-9]+', ''), 20);
  return coalesce(nullif(base, ''), 'user');
end;
$$;

-- ---------------------------------------------------------------------------
-- Existing handles that would now be reserved get a generated one.
-- ---------------------------------------------------------------------------
do $$
declare
  clashing uuid;
begin
  for clashing in
    select u.id from public.users u
    where strpos(lower(u.handle), 'synkd') > 0 or strpos(lower(u.handle), 'synked') > 0
    order by u.created_at, u.id
  loop
    update public.users u set handle = null where u.id = clashing;
    perform private.assign_generated_handle(clashing);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- users_handle_not_reserved: as in 20261001100100_profiles_and_handles.sql,
-- with the new substrings and without 'whosfree'.
-- ---------------------------------------------------------------------------
alter table public.users drop constraint users_handle_not_reserved;

alter table public.users
  add constraint users_handle_not_reserved check (
    handle is null or (
      strpos(lower(handle), 'synkd') = 0
      and strpos(lower(handle), 'synked') = 0
      and lower(handle) <> all (array[
        'about', 'account', 'accounts', 'admin', 'administrator', 'anon', 'anonymous',
        'api', 'app', 'auth', 'blog', 'calendar', 'contact', 'dashboard', 'email',
        'everyone', 'explore', 'friend', 'friends', 'group', 'groups', 'help', 'here',
        'home', 'i', 'import', 'inbox', 'invite', 'invites', 'legal', 'login', 'logout',
        'mail', 'me', 'mod', 'moderator', 'news', 'notifications', 'now', 'null',
        'official', 'onboarding', 'ping', 'pings', 'privacy', 'profile', 'register',
        'root', 'schedule', 'search', 'security', 'settings', 'share', 'sign_in',
        'sign_up', 'signin', 'signup', 'staff', 'status', 'support', 'system', 'team',
        'terms', 'undefined', 'upload', 'user', 'users', 'webhook', 'webhooks', 'www'
      ]::text[])
    )
  );
