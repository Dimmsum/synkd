-- WF-026, WF-027, WF-030 (rest), WF-032, WF-035, WF-037 (files part), WF-127
-- (uploads for offline friends): uploaded schedule files, parse jobs and the
-- Storage removal queue (PRD §8.5 "Schedule parse", §9 `scheduleFiles` and
-- `parseJobs`; FR-IMP-1, FR-IMP-13, FR-IMP-14, FR-IMP-15, FR-IMP-16,
-- FR-IMP-19, FR-ADM-4, NFR-SEC-6, NFR-SEC-9, NFR-SEC-11, NFR-REL-2,
-- NFR-REL-4, D35, D38, D41, D44, D46).
--
-- The pipeline (D46: no worker; the Next.js server does the work):
--   1. create_schedule_upload (user)   a schedule_files row with a
--      server-chosen Storage path `<users.id>/<file id>`; the server signs an
--      upload URL for it and the browser uploads straight to the private
--      `schedule-files` bucket. An identical pending file (same sha256, same
--      target) is reused instead, so nothing is uploaded twice.
--   2. start_parse_job (user)          a `queued` parse job: 5 a day
--      (FR-IMP-19, offline friends' too), or the pending job of the same file
--      for free (WF-035). Retrying a failed job requeues it (one attempt).
--   3. claim_parse_job (server)        queued → processing with a lease and
--      attempt counter; the server downloads, sniffs, converts (in memory
--      only) and runs one model call (WF-024 §7);
--   4. complete_parse_job (server)     processing → needs_review with the
--      draft, or fail_parse_job: back to queued with backoff, or failed after
--      PARSE_JOB_MAX_ATTEMPTS (3) runs or a failure no retry can fix;
--   5. confirm_parse_job (user)        commit_schedule (WF-030) plus, in the
--      same transaction: the job becomes `committed`, its draft and the
--      file's row are deleted (D38), and the Storage path is returned so the
--      server removes the object straight away.
--   list_due_parse_jobs and expire_schedule_files (server) are the sweep's
--   (cron) halves: re-dispatch queued jobs whose backoff has passed and
--   processing jobs whose lease ran out (a crash or timeout, NFR-REL-4), and
--   delete files past `delete_at` (7 days, FR-ADM-4) with their jobs.
--
-- Storage objects can't be removed inside a SQL transaction, so every deleted
-- schedule_files row (confirm, delete, expiry, an offline friend or the
-- account being deleted) queues its path in `storage_removals` (a trigger).
-- The server removes the object straight after its own deletes and clears the
-- entry; the sweep retries whatever is left (claim_storage_removals /
-- finish_storage_removals), so a failed removal is never forgotten (D38).
--
-- Access (D41): users read their own schedule_files and parse_jobs under RLS
-- (owner-only, like offline friends) and write only through the functions
-- here. The server-side functions are executable by service_role only. No
-- function returns or logs anything from a file or a draft other than to the
-- file's owner (NFR-SEC-11). Realtime: `parse_job_changed`
-- (PARSE_JOB_CHANGED_EVENT in @whosfree/shared) with an empty payload on the
-- owner's private `user:<users.id>` channel whenever one of their uploads or
-- jobs changes; clients re-read under RLS.
--
-- Errors (DB_ERROR and SCHEDULE_FILE_ERRORS in packages/backend/src): WF001
-- no account; P0002 'Upload not found' / 'Parse job not found' /
-- 'Offline friend not found'; P0001 'Too many pending uploads'; WF403 the
-- job isn't ready to confirm (detail: its status); PT429 rate limited (detail
-- action 'schedule_upload' or 'parse'; commit_schedule's own 'commit_schedule'
-- on confirm); 22023 a bad argument; plus commit_schedule's WF401/WF402.

-- ---------------------------------------------------------------------------
-- schedule_files (PRD §9 `scheduleFiles`). Rows are deleted, not flagged, when
-- the file goes (D38), so there is no `deletedAt`.
-- ---------------------------------------------------------------------------
create table public.schedule_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  -- WF-127: the upload is this offline friend's timetable (D44). Same
  -- composite key as sources/events, so it can only be the owner's.
  offline_friend_id uuid,
  -- `<users.id>/<id>` in the `schedule-files` bucket, chosen by
  -- create_schedule_upload. No file name or extension in it.
  storage_path text not null unique check (
    storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  -- The name the user picked, so they recognise it in Pending uploads
  -- (SCHEDULE_FILE_NAME_MAX_LENGTH). Deleted with the row; never logged.
  file_name text not null check (
    char_length(file_name) between 1 and 120 and file_name !~ '[[:cntrl:]]'
  ),
  -- SCHEDULE_FILE_MIME_TYPES in @whosfree/shared: what the browser declared.
  -- The server goes by the magic bytes, never this (NFR-SEC-6).
  mime_type text not null check (
    mime_type in (
      'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'
    )
  ),
  -- SCHEDULE_FILE_MAX_BYTES (10 MB, FR-IMP-1). The bucket enforces it too.
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  -- Lowercase hex SHA-256 of the uploaded bytes, as the browser computed it;
  -- the server checks it on download. Used to reuse a pending job (WF-035).
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- Page count, once the server has read the file (1 for images).
  pages smallint check (pages between 1 and 5),
  uploaded_at timestamptz not null default now(),
  -- uploaded_at + SCHEDULE_FILE_RETENTION_DAYS (7): the fallback deletion
  -- date for files that are never confirmed (FR-IMP-15, D38).
  delete_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint schedule_files_offline_friend_same_user foreign key (offline_friend_id, user_id)
    references public.offline_friends (id, user_id) on delete cascade,
  constraint schedule_files_delete_after_upload check (delete_at > uploaded_at)
);
create index schedule_files_user_id_sha256_idx on public.schedule_files (user_id, sha256);
create index schedule_files_delete_at_idx on public.schedule_files (delete_at);
create index schedule_files_offline_friend_id_idx on public.schedule_files (offline_friend_id)
  where offline_friend_id is not null;

comment on table public.schedule_files is
  'Uploaded schedule files that are not confirmed yet (PRD §9, WF-026). Owner-only under RLS; written by create_schedule_upload, start_parse_job, confirm_parse_job, delete_schedule_upload and expire_schedule_files. Deleted on confirm or 7 days after upload (D38); every deletion queues the Storage object in storage_removals.';

-- ---------------------------------------------------------------------------
-- parse_jobs (PRD §9 `parseJobs`). One job per file. A committed job keeps
-- its bookkeeping (model, cost, parser version) but no draft and no file.
-- ---------------------------------------------------------------------------
create table public.parse_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  -- Deleting the file (delete, expiry, offline friend deleted) deletes the
  -- job and its draft (FR-IMP-15). confirm_parse_job clears it first.
  file_id uuid unique references public.schedule_files (id) on delete cascade,
  -- PARSE_JOB_STATUSES in @whosfree/shared.
  status text not null default 'queued' check (
    status in ('queued', 'processing', 'needs_review', 'committed', 'failed')
  ),
  -- The parser's ParseDraft (validated and scrubbed on the server, D35).
  draft jsonb check (
    draft is null or (jsonb_typeof(draft) = 'object' and octet_length(draft::text) <= 262144)
  ),
  -- Mean confidence of the draft's events.
  confidence numeric(4, 3) check (confidence between 0 and 1),
  -- PARSE_ERROR_CODES in @whosfree/shared. A code only, never content.
  error text check (
    error is null or error in (
      'unsupported_file', 'file_too_large', 'too_many_pages', 'image_too_large',
      'unreadable_file', 'file_missing', 'no_schedule_found', 'parse_failed', 'timed_out'
    )
  ),
  parser_version text check (char_length(parser_version) <= 60),
  -- The OpenRouter model that answered the last run.
  model text check (char_length(model) <= 120),
  -- Runs claimed since the job was (re)queued by the user (NFR-REL-2).
  attempts smallint not null default 0 check (attempts between 0 and 10),
  -- What all runs of this job cost, in USD (R6, NFR-COST-1).
  cost_usd numeric(10, 6) not null default 0 check (cost_usd >= 0),
  -- A queued job runs from this time on (backoff after a failed run).
  next_attempt_at timestamptz not null default now(),
  -- While processing: when the run is presumed dead and may be retried.
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  committed_at timestamptz,
  constraint parse_jobs_file_unless_committed check ((status = 'committed') = (file_id is null)),
  constraint parse_jobs_draft_when_ready check ((draft is not null) = (status = 'needs_review')),
  constraint parse_jobs_error_when_failed check ((error is not null) = (status = 'failed')),
  constraint parse_jobs_lease_when_processing check (
    (lease_until is not null) = (status = 'processing')
  ),
  constraint parse_jobs_committed_at check ((committed_at is not null) = (status = 'committed'))
);
create index parse_jobs_user_id_idx on public.parse_jobs (user_id);
create index parse_jobs_due_idx on public.parse_jobs (status, next_attempt_at)
  where status in ('queued', 'processing');

comment on table public.parse_jobs is
  'Schedule parse jobs (PRD §9, WF-027): queued → processing → needs_review → committed, or failed. Owner-only under RLS; written only by the parse functions. The draft is deleted on confirm or with the file (D38).';

-- ---------------------------------------------------------------------------
-- storage_removals: Storage objects still to remove (D38). Server-side only.
-- ---------------------------------------------------------------------------
create table public.storage_removals (
  storage_path text primary key check (char_length(storage_path) <= 200),
  bucket text not null default 'schedule-files' check (bucket = 'schedule-files'),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index storage_removals_next_attempt_at_idx on public.storage_removals (next_attempt_at);

comment on table public.storage_removals is
  'Storage objects of deleted schedule_files rows that still have to be removed (D38). Filled by a trigger, drained by the server and the sweep (claim_storage_removals/finish_storage_removals). Clients have no access.';

-- ---------------------------------------------------------------------------
-- Privileges and RLS. Owners read their own files and jobs (not the lease,
-- hash, model or cost columns). Nobody writes directly. storage_removals is
-- server-only. service_role keeps Supabase's default access.
-- ---------------------------------------------------------------------------
alter table public.schedule_files enable row level security;
alter table public.parse_jobs enable row level security;
alter table public.storage_removals enable row level security;

revoke all on table public.schedule_files, public.parse_jobs, public.storage_removals
  from anon, authenticated;
grant select (
  id, user_id, offline_friend_id, storage_path, file_name, mime_type, size_bytes, pages,
  uploaded_at, delete_at, created_at
) on table public.schedule_files to authenticated;
grant select (
  id, user_id, file_id, status, draft, confidence, error, attempts, created_at, updated_at,
  committed_at
) on table public.parse_jobs to authenticated;

create policy schedule_files_select_own on public.schedule_files
  for select to authenticated
  using (user_id = (select public.current_user_id()));

create policy parse_jobs_select_own on public.parse_jobs
  for select to authenticated
  using (user_id = (select public.current_user_id()));

-- ---------------------------------------------------------------------------
-- Every deleted file queues its Storage object for removal, whatever deleted
-- it (D38). Runs as whoever deletes: the functions below (definer) or a
-- cascade from users / offline_friends.
-- ---------------------------------------------------------------------------
create function private.queue_schedule_file_removals() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.storage_removals (storage_path)
  select o.storage_path from old_rows o
  on conflict (storage_path) do nothing;
  return null;
end;
$$;

revoke all on function private.queue_schedule_file_removals() from public;

create trigger schedule_files_queue_removal
  after delete on public.schedule_files
  referencing old table as old_rows
  for each statement execute function private.queue_schedule_file_removals();

-- ---------------------------------------------------------------------------
-- private.signal_parse_job_changed(recipients): sends `parse_job_changed`
-- with an empty payload to each recipient's private channel. Called by the
-- functions below (security definer). realtime.send() never raises.
-- ---------------------------------------------------------------------------
create function private.signal_parse_job_changed(recipients uuid[]) returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  recipient uuid;
begin
  for recipient in
    select distinct r.id
    from unnest(signal_parse_job_changed.recipients) as r (id)
    where r.id is not null
    order by r.id
  loop
    perform realtime.send('{}'::jsonb, 'parse_job_changed', 'user:' || recipient::text, true);
  end loop;
end;
$$;

revoke all on function private.signal_parse_job_changed(uuid[]) from public;

-- ---------------------------------------------------------------------------
-- private.clean_file_name(raw): the last path segment, control characters
-- removed, trimmed and cut to 120 characters; 'Schedule' when nothing is
-- left. Never raises, so a strange name can't block an upload.
-- ---------------------------------------------------------------------------
create function private.clean_file_name(raw text) returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(
      pg_catalog.left(
        pg_catalog.btrim(
          pg_catalog.regexp_replace(
            pg_catalog.regexp_replace(coalesce(raw, ''), '^.*[\\/]', ''),
            '[[:cntrl:]]', '', 'g'
          )
        ),
        120
      ),
      ''
    ),
    'Schedule'
  )
$$;

revoke all on function private.clean_file_name(text) from public;

-- ---------------------------------------------------------------------------
-- private.check_parse_draft(draft): the stored draft has the ParseDraft
-- shape at the top and event level, with no unknown keys anywhere it is
-- checked (D35: no location, room or anything else). The server validates
-- it with zod first; this is the database's own guard. Raises WF401.
-- ---------------------------------------------------------------------------
create function private.check_parse_draft(draft jsonb) returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  event jsonb;
  n integer;
begin
  perform private.schedule_check_keys(draft, array['events', 'suggestedPeriod'], 'draft');
  if pg_catalog.jsonb_typeof(draft -> 'events') is distinct from 'array'
    or pg_catalog.jsonb_array_length(draft -> 'events') not between 1 and 200 then
    raise exception 'Invalid schedule: events must list 1 to 200 events' using errcode = 'WF401';
  end if;
  for event, n in
    select e.value, e.ordinality::integer - 1
    from pg_catalog.jsonb_array_elements(draft -> 'events') with ordinality as e
  loop
    perform private.schedule_check_keys(
      event,
      array['title', 'category', 'start', 'end', 'when', 'confidence'],
      pg_catalog.format('events[%s]', n)
    );
    perform private.schedule_check_keys(
      event -> 'when', array['kind', 'days', 'pattern', 'date'], pg_catalog.format('events[%s].when', n)
    );
  end loop;
  if draft ? 'suggestedPeriod' then
    perform private.schedule_check_keys(
      draft -> 'suggestedPeriod', array['start', 'end', 'exceptions'], 'suggestedPeriod'
    );
  end if;
end;
$$;

revoke all on function private.check_parse_draft(jsonb) from public;

-- ---------------------------------------------------------------------------
-- public.create_schedule_upload(file_name, mime_type, size_bytes, sha256,
-- offline_friend_id): registers an upload for the caller (or one of their
-- offline friends, WF-127) and returns where it goes.
--
-- Returns one row:
--   file_id       the schedule_files row
--   storage_path  the object path in the `schedule-files` bucket; the server
--                 signs an upload URL for exactly this path
--   job_id        the file's parse job, if it already has one
--   needs_upload  false when an identical pending file (same sha256 and
--                 target) is reused: don't upload, follow job_id (or call
--                 start_parse_job when it is null or failed)
--
-- At most MAX_PENDING_UPLOADS (10) unconfirmed files per user and
-- SCHEDULE_UPLOADS_PER_DAY (20) new uploads a day ('schedule_upload').
-- ---------------------------------------------------------------------------
create function public.create_schedule_upload(
  file_name text,
  mime_type text,
  size_bytes integer,
  sha256 text,
  offline_friend_id uuid default null
)
returns table (file_id uuid, storage_path text, job_id uuid, needs_upload boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- MAX_PENDING_UPLOADS, SCHEDULE_UPLOADS_PER_DAY, SCHEDULE_FILE_RETENTION_DAYS,
  -- SCHEDULE_FILE_MAX_BYTES and SCHEDULE_FILE_MIME_TYPES in @whosfree/shared.
  max_pending constant integer := 10;
  uploads_per_day constant integer := 20;
  mime_types constant text[] := array[
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'
  ];
  me uuid := private.require_user();
  target uuid := create_schedule_upload.offline_friend_id;
  hash text := pg_catalog.lower(pg_catalog.btrim(create_schedule_upload.sha256));
  existing record;
  new_id uuid := gen_random_uuid();
  new_path text;
begin
  if create_schedule_upload.mime_type is null
    or not (create_schedule_upload.mime_type = any (mime_types)) then
    raise exception 'Unsupported file type' using errcode = '22023';
  end if;
  if create_schedule_upload.size_bytes is null
    or create_schedule_upload.size_bytes not between 1 and 10485760 then
    raise exception 'File must be 1 byte to 10 MB' using errcode = '22023';
  end if;
  if hash is null or hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid file hash' using errcode = '22023';
  end if;
  if target is not null and not exists (
    select 1 from public.offline_friends o where o.id = target and o.user_id = me
  ) then
    raise exception 'Offline friend not found' using errcode = 'P0002';
  end if;

  -- Serialises this user's uploads, so the pending count and the reuse check
  -- can't race.
  perform 1 from public.users u where u.id = me for update;

  -- WF-035: the same file for the same person is still pending: reuse it.
  select f.id, f.storage_path, j.id as job_id
  into existing
  from public.schedule_files f
  left join public.parse_jobs j on j.file_id = f.id
  where f.user_id = me
    and f.sha256 = hash
    and f.offline_friend_id is not distinct from target
    and f.delete_at > pg_catalog.now()
  order by f.uploaded_at desc
  limit 1;
  if found then
    -- Without a job the earlier upload may never have finished: upload again.
    return query select existing.id, existing.storage_path, existing.job_id, existing.job_id is null;
    return;
  end if;

  if (
    select count(*) from public.schedule_files f
    where f.user_id = me and f.delete_at > pg_catalog.now()
  ) >= max_pending then
    raise exception 'Too many pending uploads'
      using errcode = 'P0001', hint = 'Confirm or delete a pending upload first.';
  end if;

  -- NFR-SEC-9: counted only when the row is created.
  perform private.consume_rate_limit(me, 'schedule_upload', uploads_per_day, interval '1 day');

  new_path := me::text || '/' || new_id::text;
  insert into public.schedule_files (
    id, user_id, offline_friend_id, storage_path, file_name, mime_type, size_bytes, sha256,
    uploaded_at, delete_at
  )
  values (
    new_id, me, target, new_path, private.clean_file_name(create_schedule_upload.file_name),
    create_schedule_upload.mime_type, create_schedule_upload.size_bytes, hash,
    pg_catalog.now(), pg_catalog.now() + interval '7 days'
  );

  perform private.signal_parse_job_changed(array[me]);
  return query select new_id, new_path, null::uuid, true;
end;
$$;

comment on function public.create_schedule_upload(text, text, integer, text, uuid) is
  'WF-026: registers an upload (or reuses an identical pending one, WF-035) for the caller or one of their offline friends; returns file_id, storage_path, job_id and needs_upload.';

revoke all on function public.create_schedule_upload(text, text, integer, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_schedule_upload(text, text, integer, text, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- public.start_parse_job(file_id): queues the parse of one of the caller's
-- pending uploads and returns the job id. Idempotent: a file whose job is
-- queued, processing or ready for review returns that job, and so does an
-- identical file (same sha256 and target) with such a job (the duplicate
-- file is dropped); neither uses an attempt. Otherwise one of the
-- PARSE_ATTEMPTS_PER_DAY (5) attempts is used ('parse', FR-IMP-19): a new
-- job, or a failed job requeued (FR-IMP-14 "retry").
-- ---------------------------------------------------------------------------
create function public.start_parse_job(file_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- PARSE_ATTEMPTS_PER_DAY in @whosfree/shared.
  parses_per_day constant integer := 5;
  me uuid := private.require_user();
  f public.schedule_files;
  job public.parse_jobs;
  twin uuid;
begin
  perform 1 from public.users u where u.id = me for update;

  select * into f
  from public.schedule_files s
  where s.id = start_parse_job.file_id and s.user_id = me and s.delete_at > pg_catalog.now();
  if not found then
    raise exception 'Upload not found' using errcode = 'P0002';
  end if;

  select * into job from public.parse_jobs j where j.file_id = f.id for update;
  if found and job.status in ('queued', 'processing', 'needs_review') then
    return job.id;
  end if;

  if job.id is null then
    select j.id into twin
    from public.parse_jobs j
    join public.schedule_files s on s.id = j.file_id
    where s.user_id = me
      and s.id <> f.id
      and s.sha256 = f.sha256
      and s.offline_friend_id is not distinct from f.offline_friend_id
      and s.delete_at > pg_catalog.now()
      and j.status in ('queued', 'processing', 'needs_review')
    limit 1;
    if twin is not null then
      delete from public.schedule_files s where s.id = f.id;
      perform private.signal_parse_job_changed(array[me]);
      return twin;
    end if;
  end if;

  -- Counted only when a parse is actually queued (a later error rolls it back).
  perform private.consume_rate_limit(me, 'parse', parses_per_day, interval '1 day');

  if job.id is not null then
    update public.parse_jobs j
    set status = 'queued', error = null, attempts = 0, next_attempt_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    where j.id = job.id;
  else
    insert into public.parse_jobs (user_id, file_id)
    values (me, f.id)
    returning * into job;
  end if;

  perform private.signal_parse_job_changed(array[me]);
  return job.id;
end;
$$;

comment on function public.start_parse_job(uuid) is
  'WF-027/WF-035: queues a parse of one of the caller''s pending uploads (5 a day), or returns the pending job of that file or an identical one. Returns the job id.';

revoke all on function public.start_parse_job(uuid) from public, anon, authenticated, service_role;
grant execute on function public.start_parse_job(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.claim_parse_job(job_id, lease_seconds): server only. Takes a job
-- that is due (queued past its backoff, or processing past its lease) for one
-- run: processing, attempts + 1, leased for `lease_seconds`. Returns the run's
-- inputs, or no row when the job isn't due or another run holds it
-- (idempotent dispatch). A job whose lease ran out after its last allowed run
-- becomes failed ('timed_out') instead.
-- ---------------------------------------------------------------------------
create function public.claim_parse_job(job_id uuid, lease_seconds integer default 330)
returns table (
  id uuid,
  attempt integer,
  storage_path text,
  mime_type text,
  size_bytes integer,
  sha256 text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- PARSE_JOB_MAX_ATTEMPTS in @whosfree/shared.
  max_attempts constant integer := 3;
  job public.parse_jobs;
begin
  if lease_seconds is null or lease_seconds not between 30 and 900 then
    raise exception 'lease_seconds must be 30 to 900' using errcode = '22023';
  end if;

  select * into job
  from public.parse_jobs j
  where j.id = claim_parse_job.job_id
  for update skip locked;
  if not found then
    return;
  end if;

  if job.status = 'processing' and job.lease_until < pg_catalog.now()
    and job.attempts >= max_attempts then
    update public.parse_jobs j
    set status = 'failed', error = 'timed_out', lease_until = null, updated_at = pg_catalog.now()
    where j.id = job.id;
    perform private.signal_parse_job_changed(array[job.user_id]);
    return;
  end if;

  if not (
    (job.status = 'queued' and job.next_attempt_at <= pg_catalog.now())
    or (job.status = 'processing' and job.lease_until < pg_catalog.now())
  ) then
    return;
  end if;

  update public.parse_jobs j
  set status = 'processing',
      attempts = j.attempts + 1,
      lease_until = pg_catalog.now() + pg_catalog.make_interval(secs => lease_seconds),
      updated_at = pg_catalog.now()
  where j.id = job.id
  returning * into job;

  perform private.signal_parse_job_changed(array[job.user_id]);
  return query
    select job.id, job.attempts::integer, f.storage_path, f.mime_type, f.size_bytes, f.sha256
    from public.schedule_files f
    where f.id = job.file_id;
end;
$$;

comment on function public.claim_parse_job(uuid, integer) is
  'WF-027 (server only): claims a due parse job for one run with a lease; no row if it isn''t due or is held.';

revoke all on function public.claim_parse_job(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_parse_job(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- public.complete_parse_job(job_id, attempt, draft, model, parser_version,
-- cost_usd, confidence, pages): server only. Stores a run's validated draft:
-- processing → needs_review. `attempt` is what claim_parse_job returned, so a
-- run that lost its lease can't overwrite a newer one: then nothing changes
-- and it returns false.
-- ---------------------------------------------------------------------------
create function public.complete_parse_job(
  job_id uuid,
  attempt integer,
  draft jsonb,
  model text,
  parser_version text,
  cost_usd numeric default null,
  confidence numeric default null,
  pages integer default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  job public.parse_jobs;
begin
  select * into job
  from public.parse_jobs j
  where j.id = complete_parse_job.job_id
  for update;
  if not found or job.status <> 'processing' or job.attempts <> complete_parse_job.attempt then
    return false;
  end if;

  perform private.check_parse_draft(complete_parse_job.draft);

  update public.parse_jobs j
  set status = 'needs_review',
      draft = complete_parse_job.draft,
      model = complete_parse_job.model,
      parser_version = complete_parse_job.parser_version,
      cost_usd = j.cost_usd + greatest(coalesce(complete_parse_job.cost_usd, 0), 0),
      confidence = complete_parse_job.confidence,
      error = null,
      lease_until = null,
      updated_at = pg_catalog.now()
  where j.id = job.id;

  update public.schedule_files f
  set pages = complete_parse_job.pages
  where f.id = job.file_id and complete_parse_job.pages between 1 and 5;

  perform private.signal_parse_job_changed(array[job.user_id]);
  return true;
end;
$$;

comment on function public.complete_parse_job(uuid, integer, jsonb, text, text, numeric, numeric, integer) is
  'WF-027 (server only): stores a run''s draft (needs_review). False when the run no longer holds the job.';

revoke all on function public.complete_parse_job(uuid, integer, jsonb, text, text, numeric, numeric, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_parse_job(uuid, integer, jsonb, text, text, numeric, numeric, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- public.fail_parse_job(job_id, attempt, error, retryable, model,
-- parser_version, cost_usd): server only. Records a failed run. A retryable
-- failure before the last allowed run goes back to queued with backoff (1
-- minute after the first run, 5 after the second, NFR-REL-2); anything else
-- becomes failed with `error` (a PARSE_ERROR_CODES code). Returns the new
-- status, or null when the run no longer holds the job.
-- ---------------------------------------------------------------------------
create function public.fail_parse_job(
  job_id uuid,
  attempt integer,
  error text,
  retryable boolean,
  model text default null,
  parser_version text default null,
  cost_usd numeric default null
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- PARSE_JOB_MAX_ATTEMPTS in @whosfree/shared.
  max_attempts constant integer := 3;
  job public.parse_jobs;
  new_status text;
begin
  select * into job
  from public.parse_jobs j
  where j.id = fail_parse_job.job_id
  for update;
  if not found or job.status <> 'processing' or job.attempts <> fail_parse_job.attempt then
    return null;
  end if;

  new_status := case
    when coalesce(fail_parse_job.retryable, false) and job.attempts < max_attempts then 'queued'
    else 'failed'
  end;

  update public.parse_jobs j
  set status = new_status,
      error = case when new_status = 'failed' then fail_parse_job.error end,
      next_attempt_at = case
        when new_status = 'queued'
          then pg_catalog.now() + case when job.attempts <= 1 then interval '1 minute' else interval '5 minutes' end
        else j.next_attempt_at
      end,
      model = coalesce(fail_parse_job.model, j.model),
      parser_version = coalesce(fail_parse_job.parser_version, j.parser_version),
      cost_usd = j.cost_usd + greatest(coalesce(fail_parse_job.cost_usd, 0), 0),
      lease_until = null,
      updated_at = pg_catalog.now()
  where j.id = job.id;

  perform private.signal_parse_job_changed(array[job.user_id]);
  return new_status;
end;
$$;

comment on function public.fail_parse_job(uuid, integer, text, boolean, text, text, numeric) is
  'WF-027 (server only): records a failed run: back to queued with backoff, or failed after 3 runs or a failure no retry can fix.';

revoke all on function public.fail_parse_job(uuid, integer, text, boolean, text, text, numeric)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_parse_job(uuid, integer, text, boolean, text, text, numeric)
  to service_role;

-- ---------------------------------------------------------------------------
-- public.list_due_parse_jobs(max_jobs): server only. Jobs the sweep should
-- dispatch: queued past their backoff, or processing past their lease
-- (NFR-REL-4). Oldest first.
-- ---------------------------------------------------------------------------
create function public.list_due_parse_jobs(max_jobs integer default 20)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select j.id
  from public.parse_jobs j
  where (j.status = 'queued' and j.next_attempt_at <= pg_catalog.now())
     or (j.status = 'processing' and j.lease_until < pg_catalog.now())
  order by coalesce(j.lease_until, j.next_attempt_at)
  limit greatest(1, least(coalesce(list_due_parse_jobs.max_jobs, 20), 100))
$$;

comment on function public.list_due_parse_jobs(integer) is
  'WF-027 (server only): ids of parse jobs due a run (backoff passed or lease expired).';

revoke all on function public.list_due_parse_jobs(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_due_parse_jobs(integer) to service_role;

-- ---------------------------------------------------------------------------
-- public.confirm_parse_job(job_id, draft): the user confirms a reviewed
-- schedule (FR-IMP-9, WF-030). In one transaction: commit_schedule saves the
-- (edited) draft for the upload's target, the caller or their offline friend
-- (WF-127); the job becomes `committed` without its draft; the file's row is
-- deleted (D38). Returns the new source and the Storage path, which the
-- server removes straight away (already queued in storage_removals in case
-- that fails). WF403 when the job isn't ready (detail: its status, e.g.
-- 'committed' after a double submit).
-- ---------------------------------------------------------------------------
create function public.confirm_parse_job(job_id uuid, draft jsonb)
returns table (source_id uuid, storage_path text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_user();
  job public.parse_jobs;
  f public.schedule_files;
  new_source uuid;
begin
  -- Same lock order as start_parse_job: the user, then the job.
  perform 1 from public.users u where u.id = me for update;

  select * into job
  from public.parse_jobs j
  where j.id = confirm_parse_job.job_id and j.user_id = me
  for update;
  if not found then
    raise exception 'Parse job not found' using errcode = 'P0002';
  end if;
  if job.status <> 'needs_review' then
    raise exception 'This schedule isn''t ready to confirm'
      using errcode = 'WF403', detail = job.status;
  end if;

  select * into f from public.schedule_files s where s.id = job.file_id;

  new_source := public.commit_schedule(confirm_parse_job.draft, 'upload', f.offline_friend_id);

  update public.parse_jobs j
  set status = 'committed', draft = null, file_id = null, committed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where j.id = job.id;
  delete from public.schedule_files s where s.id = f.id;

  perform private.signal_parse_job_changed(array[me]);
  return query select new_source, f.storage_path;
end;
$$;

comment on function public.confirm_parse_job(uuid, jsonb) is
  'WF-030: commits a reviewed parse (commit_schedule), marks the job committed and deletes its draft and file row in one transaction (D38). Returns source_id and the storage_path to remove.';

revoke all on function public.confirm_parse_job(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_parse_job(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- public.delete_schedule_upload(file_id): the user deletes a pending upload
-- now (FR-IMP-16, WF-032), with its job and draft. Returns the Storage path
-- for the server to remove straight away (queued in storage_removals too).
-- ---------------------------------------------------------------------------
create function public.delete_schedule_upload(file_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_user();
  path text;
begin
  delete from public.schedule_files f
  where f.id = delete_schedule_upload.file_id and f.user_id = me
  returning f.storage_path into path;
  if path is null then
    raise exception 'Upload not found' using errcode = 'P0002';
  end if;
  perform private.signal_parse_job_changed(array[me]);
  return path;
end;
$$;

comment on function public.delete_schedule_upload(uuid) is
  'WF-032: deletes one of the caller''s pending uploads with its parse job and draft; returns the Storage path to remove.';

revoke all on function public.delete_schedule_upload(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_schedule_upload(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.expire_schedule_files(max_files): server only, for the sweep
-- (FR-ADM-4, WF-037). Deletes unconfirmed files past delete_at (7 days),
-- with their jobs and drafts; their objects are queued for removal. Returns
-- how many it deleted.
-- ---------------------------------------------------------------------------
create function public.expire_schedule_files(max_files integer default 200)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  owners uuid[];
begin
  with expired as (
    delete from public.schedule_files f
    where f.id in (
      select e.id from public.schedule_files e
      where e.delete_at <= pg_catalog.now()
      order by e.delete_at
      limit greatest(1, least(coalesce(expire_schedule_files.max_files, 200), 1000))
      for update skip locked
    )
    returning f.user_id
  )
  select array_agg(e.user_id) into owners from expired e;

  perform private.signal_parse_job_changed(coalesce(owners, '{}'));
  return coalesce(pg_catalog.array_length(owners, 1), 0);
end;
$$;

comment on function public.expire_schedule_files(integer) is
  'WF-037 (server only): deletes unconfirmed schedule files past delete_at with their jobs; returns the count. Their Storage objects are queued for removal.';

revoke all on function public.expire_schedule_files(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.expire_schedule_files(integer) to service_role;

-- ---------------------------------------------------------------------------
-- public.claim_storage_removals(max_paths): server only. Storage objects due
-- for removal, each pushed back (2^attempts minutes, at most a day) so a
-- crashed or failing run is retried later rather than lost (D38).
-- public.finish_storage_removals(paths): server only. Forgets objects that
-- are gone. Returns how many it forgot.
-- ---------------------------------------------------------------------------
create function public.claim_storage_removals(max_paths integer default 100)
returns table (bucket text, storage_path text)
language sql
volatile
security definer
set search_path = ''
as $$
  update public.storage_removals r
  set attempts = r.attempts + 1,
      next_attempt_at = pg_catalog.now()
        + least(interval '1 minute' * power(2, least(r.attempts, 11)), interval '1 day')
  where r.storage_path in (
    select d.storage_path from public.storage_removals d
    where d.next_attempt_at <= pg_catalog.now()
    order by d.next_attempt_at
    limit greatest(1, least(coalesce(claim_storage_removals.max_paths, 100), 1000))
    for update skip locked
  )
  returning r.bucket, r.storage_path
$$;

comment on function public.claim_storage_removals(integer) is
  'D38 (server only): Storage objects due for removal, rescheduled with backoff until finish_storage_removals forgets them.';

revoke all on function public.claim_storage_removals(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_storage_removals(integer) to service_role;

create function public.finish_storage_removals(paths text[])
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.storage_removals r
    where r.storage_path = any (finish_storage_removals.paths)
    returning 1
  )
  select count(*)::integer from gone
$$;

comment on function public.finish_storage_removals(text[]) is
  'D38 (server only): forgets Storage objects that have been removed; returns how many.';

revoke all on function public.finish_storage_removals(text[])
  from public, anon, authenticated, service_role;
grant execute on function public.finish_storage_removals(text[]) to service_role;

-- ---------------------------------------------------------------------------
-- The private Storage bucket (NFR-SEC-6, FR-IMP-1): 10 MB per object and the
-- schedule media types only. No policies on storage.objects for it: clients
-- can neither list, read nor write it, and reach objects only through
-- short-lived signed URLs the server creates with the secret key. Skipped
-- where Storage doesn't exist (the PGlite test harness).
-- ---------------------------------------------------------------------------
do $$
begin
  if pg_catalog.to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'schedule-files', 'schedule-files', false, 10485760,
      array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif']
    )
    on conflict (id) do update
      set public = false,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
  end if;
end;
$$;
