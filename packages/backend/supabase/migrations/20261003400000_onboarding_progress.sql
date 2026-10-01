-- WF-068: onboarding progress (J1, FR-WEB-5).
--
-- Every onboarding step after sign-up can be skipped and picked up later, and
-- people who finished onboarding must not be sent back into it, on any device.
-- Most of what the flow needs is already real data (a confirmed schedule is a
-- `sources` row, a pending invite is the wf_invite cookie, push is per device),
-- but two things aren't:
--
--   onboarding_steps  the steps the user has done or skipped, so "Continue" on
--                     available hours (whose default row exists from sign-up)
--                     and "Skip for now" on any step are remembered. Exactly
--                     ONBOARDING_STEPS from @whosfree/shared.
--   onboarded_at      when the user reached the end of the flow (the last step's
--                     Continue or Skip). Steps enabled later (Google Calendar,
--                     WF-080) don't pull finished users back in.
--
-- Clients can't write either column (WF-003 column grants); record_onboarding_step()
-- sets them, with the server's clock.
--
-- Everyone who signed up before this migration went through the earlier flow,
-- so they count as onboarded.

alter table public.users
  add column onboarding_steps text[] not null default '{}'
    constraint users_onboarding_steps_check
    check (onboarding_steps <@ array['hours', 'schedule', 'calendar', 'sharing', 'install']::text[]),
  add column onboarded_at timestamptz;

comment on column public.users.onboarding_steps is
  'WF-068: onboarding steps done or skipped (ONBOARDING_STEPS in @whosfree/shared). Written only by record_onboarding_step().';
comment on column public.users.onboarded_at is
  'WF-068: when the user reached the end of onboarding; null while it is unfinished. Written only by record_onboarding_step().';

update public.users set onboarded_at = pg_catalog.now() where consent_at is not null;

-- ---------------------------------------------------------------------------
-- public.record_onboarding_step(step, finish): marks `step` done or skipped
-- for the caller; with `finish`, also records that onboarding is over (kept
-- at the first time). Idempotent. An unknown step is refused (22023).
--
-- security definer because clients can't write the onboarding columns.
-- ---------------------------------------------------------------------------
create function public.record_onboarding_step(step text, finish boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_user();
begin
  if record_onboarding_step.step is null
    or not (record_onboarding_step.step = any (array['hours', 'schedule', 'calendar', 'sharing', 'install']))
  then
    raise exception 'Unknown onboarding step'
      using errcode = '22023';
  end if;

  update public.users u
  set
    onboarding_steps = case
      when record_onboarding_step.step = any (u.onboarding_steps) then u.onboarding_steps
      else pg_catalog.array_append(u.onboarding_steps, record_onboarding_step.step)
    end,
    onboarded_at = case
      when coalesce(record_onboarding_step.finish, false) then coalesce(u.onboarded_at, pg_catalog.now())
      else u.onboarded_at
    end
  where u.id = me;
end;
$$;

comment on function public.record_onboarding_step(text, boolean) is
  'WF-068: records an onboarding step as done or skipped for the caller, and optionally that onboarding is finished.';

revoke all on function public.record_onboarding_step(text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.record_onboarding_step(text, boolean) to authenticated;
