-- WF-137: in-app feedback and bug reports (FR-WEB-10, NFR-SEC-1, NFR-SEC-2,
-- NFR-SEC-9, NFR-SEC-11, D41).
--
-- A signed-in user sends a short message ("Something's broken", "Idea or
-- request", "Something else") from the "Send feedback" form in the app shell
-- or the error page. It lands here for the team to read and triage.
--
-- Who can read what:
--   - Clients write only through submit_feedback below, which takes the
--     author from current_user_id(). They can't read feedback back, their own
--     included: there is no policy and no select grant.
--   - The team reads and triages rows in the Supabase dashboard (table editor
--     or SQL editor), which bypasses RLS. `status` is for that triage and is
--     never shown to users.
--
-- Data minimisation (NFR-SEC-1): the page path (no query string or hash,
-- which can hold invite codes), a coarse device label such as "Safari on
-- iPhone" (no raw user agent, no IP), and whether the app was installed. The
-- message is free text the user wrote; like ping text it must never be
-- logged (NFR-SEC-11). Deleting the account deletes its feedback.
--
-- Errors: WF001 no account for this sign-in, 22023 bad argument, PT429 rate
-- limited (FEEDBACK_PER_DAY in @synkd/shared, 10 a day).

-- ---------------------------------------------------------------------------
-- feedback
-- ---------------------------------------------------------------------------
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  kind text not null check (kind in ('bug', 'idea', 'other')),
  -- 1–2000 characters of plain text (FEEDBACK_MESSAGE_MAX_LENGTH).
  message text not null check (char_length(message) between 1 and 2000),
  -- e.g. /groups/<uuid>/settings (FEEDBACK_PAGE_MAX_LENGTH).
  page text check (page is null or (char_length(page) <= 200 and page ~ '^/[^[:space:]?#]*$')),
  device_label text check (device_label is null or char_length(device_label) between 1 and 60),
  -- Opened from the installed PWA (display-mode: standalone) rather than a browser tab.
  installed boolean not null default false,
  -- The user said we may contact them about it (their Clerk email, via clerk_id).
  can_contact boolean not null default false,
  -- Triage, set by the team in the dashboard.
  status text not null default 'new'
    check (status in ('new', 'seen', 'planned', 'done', 'wont_fix')),
  created_at timestamptz not null default now()
);
create index feedback_status_created_at_idx on public.feedback (status, created_at desc);
create index feedback_user_id_idx on public.feedback (user_id);

comment on table public.feedback is
  'In-app feedback and bug reports (WF-137, FR-WEB-10). Written by submit_feedback only; no client can read it. The team triages it in the dashboard (status). Never log message.';

-- ---------------------------------------------------------------------------
-- private.clean_feedback_message(raw): trimmed, CRLF turned into LF, 1–2000
-- characters with no control characters except tab and newline.
-- ---------------------------------------------------------------------------
create function private.clean_feedback_message(raw text) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text := nullif(
    pg_catalog.regexp_replace(
      pg_catalog.replace(raw, E'\r\n', E'\n'), '^\s+|\s+$', '', 'g'
    ),
    ''
  );
begin
  if cleaned is null
    or pg_catalog.char_length(cleaned) > 2000
    or cleaned ~ '[\u0001-\u0008\u000B-\u001F\u007F]'
  then
    raise exception 'Feedback must be 1 to 2000 characters of plain text' using errcode = '22023';
  end if;
  return cleaned;
end;
$$;

revoke all on function private.clean_feedback_message(text) from public;

-- ---------------------------------------------------------------------------
-- submit_feedback(kind, message, page, device_label, installed, can_contact):
-- stores feedback from the caller and returns its id.
-- ---------------------------------------------------------------------------
create function public.submit_feedback(
  kind text,
  message text,
  page text default null,
  device_label text default null,
  installed boolean default false,
  can_contact boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_user();
  clean_message text := private.clean_feedback_message(submit_feedback.message);
  clean_page text := nullif(pg_catalog.btrim(submit_feedback.page), '');
  clean_label text := private.clean_push_device_label(submit_feedback.device_label);
  new_id uuid;
begin
  if submit_feedback.kind is null
    or not (submit_feedback.kind = any (array['bug', 'idea', 'other']))
  then
    raise exception 'Unknown feedback kind' using errcode = '22023';
  end if;

  if clean_page is not null
    and (pg_catalog.char_length(clean_page) > 200 or clean_page !~ '^/[^[:space:]?#]*$')
  then
    raise exception 'Invalid page' using errcode = '22023';
  end if;

  -- NFR-SEC-9: FEEDBACK_PER_DAY (@synkd/shared). Raises PT429 with the retry
  -- time in the detail. Calls that fail validation above don't count.
  perform private.consume_rate_limit(me, 'feedback', 10, interval '1 day');

  insert into public.feedback (user_id, kind, message, page, device_label, installed, can_contact)
  values (
    me,
    submit_feedback.kind,
    clean_message,
    clean_page,
    clean_label,
    coalesce(submit_feedback.installed, false),
    coalesce(submit_feedback.can_contact, false)
  )
  returning feedback.id into new_id;

  return new_id;
end;
$$;

comment on function public.submit_feedback(text, text, text, text, boolean, boolean) is
  'WF-137: stores in-app feedback from the caller (FR-WEB-10). Rate limited to 10 a day.';

revoke all on function public.submit_feedback(text, text, text, text, boolean, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_feedback(text, text, text, text, boolean, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges and RLS: no client reads or writes the table directly.
-- service_role keeps Supabase's default access (the dashboard and scripts).
-- ---------------------------------------------------------------------------
alter table public.feedback enable row level security;

revoke all on table public.feedback from anon, authenticated;
