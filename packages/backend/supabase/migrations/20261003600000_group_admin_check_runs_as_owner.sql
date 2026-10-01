-- Fix (WF-043): creating a group failed on hosted Supabase with 42501
-- (permission denied), although create_group itself is allowed.
--
-- The admin-in-sync checks on groups and group_members (20261001200000_groups.sql)
-- are deferred constraint triggers: they fire at commit, after create_group
-- (security definer) has returned. Their function was security invoker, so
-- whether it could reach private.assert_group_admin_in_sync depended on which
-- role Postgres fires the deferred event as. Where that's the API role
-- (`authenticated`), which has no USAGE on the private schema, every commit
-- that touches a group's admin row was refused: create_group and admin
-- transfers. Tests only passed because PGlite fires it as the function owner.
--
-- Running the trigger function as its owner makes the check independent of the
-- firing role, like the Realtime signal triggers (WF-064). It returns
-- `trigger`, so it still can't be called directly.

alter function private.group_admin_in_sync_trigger() security definer;
