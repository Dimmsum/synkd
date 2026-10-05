// Catalog-level checks over the whole schema (NFR-SEC-2, D35, D41). These
// make every privilege and security definer function a deliberate, reviewed
// choice: adding a table, grant or function changes a snapshot below.

import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_GROUP_MAX_MEMBERS,
  DEFAULT_MEMBER_PERMISSIONS,
  DEFAULT_TIER,
  EVENT_CATEGORIES,
  ONBOARDING_STEPS,
  PING_REPLIES,
  PING_TEMPLATES,
  SOURCE_TYPES,
  TIERS,
} from '@synkd/shared';
import {
  GROUP_ERRORS,
  OFFLINE_FRIEND_ERRORS,
  PING_ERRORS,
  PUSH_SUBSCRIPTION_ERRORS,
  SCHEDULE_FILE_ERRORS,
} from '../src/index';
import { createTestDb, migrationFiles } from './harness/db';
import type { TestDb } from './harness/db';
import { addSource, addUser } from './harness/seed';

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.close());

const CLIENT_ROLES = ['anon', 'authenticated', 'service_role'] as const;

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.admin.query<T>(sql, params)).rows;
}

describe('migrations', () => {
  it('are named in the Supabase CLI format and apply cleanly to a fresh database', async () => {
    const files = await migrationFiles();
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const f of files) expect(f).toMatch(/\/\d{14}_[a-z0-9_]+\.sql$/);
    // createTestDb() in beforeAll applied them all; spot-check the result.
    const tables = await rows<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' order by 1`,
    );
    expect(tables.map((t) => t.tablename)).toEqual([
      'availability_prefs',
      'blocks',
      'events',
      'friendships',
      'group_members',
      'groups',
      'invites',
      'offline_friends',
      'parse_jobs',
      'pings',
      'push_subscriptions',
      'rate_limits',
      'schedule_files',
      'sources',
      'status_overrides',
      'storage_removals',
      'users',
      'visibility_rules',
    ]);
  });
});

describe('row-level security', () => {
  it('is enabled on every table in public', async () => {
    const off = await rows<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`,
    );
    expect(off).toEqual([]);
  });

  it('there are no views or materialized views that could bypass it', async () => {
    const views = await rows(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'private') and c.relkind in ('v', 'm')`,
    );
    expect(views).toEqual([]);
  });

  it('every policy applies to authenticated only (anon has no policies)', async () => {
    const policies = await rows<{
      tablename: string;
      policyname: string;
      roles: string[];
      cmd: string;
    }>(
      `select tablename, policyname, roles, cmd from pg_policies where schemaname = 'public'
       order by tablename, policyname`,
    );
    for (const p of policies) expect(p.roles).toEqual(['authenticated']);
    expect(policies.map((p) => `${p.tablename}.${p.policyname} (${p.cmd})`)).toEqual([
      'availability_prefs.availability_prefs_select_own (SELECT)',
      'availability_prefs.availability_prefs_update_own (UPDATE)',
      'blocks.blocks_select_blocker (SELECT)',
      'events.events_delete_own (DELETE)',
      'events.events_insert_own (INSERT)',
      'events.events_select_own (SELECT)',
      'events.events_update_own (UPDATE)',
      'friendships.friendships_select_party (SELECT)',
      'group_members.group_members_select_own (SELECT)',
      'groups.groups_select_member (SELECT)',
      'offline_friends.offline_friends_select_own (SELECT)',
      'parse_jobs.parse_jobs_select_own (SELECT)',
      'pings.pings_select_party (SELECT)',
      'push_subscriptions.push_subscriptions_select_own (SELECT)',
      'schedule_files.schedule_files_select_own (SELECT)',
      'sources.sources_delete_own (DELETE)',
      'sources.sources_insert_own (INSERT)',
      'sources.sources_select_own (SELECT)',
      'sources.sources_update_own (UPDATE)',
      'status_overrides.status_overrides_select_own (SELECT)',
      'users.users_select_own (SELECT)',
      'users.users_update_own (UPDATE)',
      'visibility_rules.visibility_rules_select_own (SELECT)',
      'visibility_rules.visibility_rules_update_own (UPDATE)',
    ]);
  });
});

describe('table privileges (on top of Supabase’s grant-everything defaults)', () => {
  /** For a role: table -> privileges, with column-level INSERT/UPDATE shown as `UPDATE(col, …)`. */
  async function privilegesOf(role: string): Promise<Record<string, string[]>> {
    const tables = await rows<{ t: string }>(
      `select tablename as t from pg_tables where schemaname = 'public' order by 1`,
    );
    const out: Record<string, string[]> = {};
    for (const { t } of tables) {
      const privs: string[] = [];
      for (const p of [
        'SELECT',
        'INSERT',
        'UPDATE',
        'DELETE',
        'TRUNCATE',
        'REFERENCES',
        'TRIGGER',
      ]) {
        const [{ table }] = (await rows<{ table: boolean }>(
          `select has_table_privilege($1, $2, $3) as table`,
          [role, `public.${t}`, p],
        )) as [{ table: boolean }];
        if (table) {
          privs.push(p);
          continue;
        }
        if (p !== 'SELECT' && p !== 'INSERT' && p !== 'UPDATE') continue;
        // Column-level grants (has_column_privilege supports only these three).
        const [{ cols }] = (await rows<{ cols: string[] | null }>(
          `select array_agg(attname::text order by attnum) as cols from pg_attribute
           where attrelid = $2::regclass and attnum > 0 and not attisdropped
             and has_column_privilege($1, $2, attname, $3)`,
          [role, `public.${t}`, p],
        )) as [{ cols: string[] | null }];
        if (cols) privs.push(`${p}(${cols.join(', ')})`);
      }
      if (privs.length > 0) out[t] = privs;
    }
    return out;
  }

  it('anon has no privileges on any table', async () => {
    expect(await privilegesOf('anon')).toEqual({});
  });

  it('authenticated has exactly these privileges', async () => {
    expect(await privilegesOf('authenticated')).toEqual({
      users: ['SELECT', 'UPDATE(name, avatar_url, timezone, sharing_paused)'],
      friendships: ['SELECT'],
      blocks: ['SELECT'],
      groups: ['SELECT'],
      group_members: ['SELECT'],
      visibility_rules: ['SELECT', 'UPDATE(tier)'],
      sources: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
      events: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
      availability_prefs: ['SELECT', 'UPDATE(weekly, min_gap_minutes, count_all_day_events)'],
      status_overrides: ['SELECT'],
      offline_friends: ['SELECT'],
      push_subscriptions: ['SELECT'],
      // WF-092: no read_at / reply_read_at (no read receipts).
      pings: [
        'SELECT(id, sender_id, recipient_id, group_id, template, text, reply, reply_text, replied_at, expires_at, created_at)',
      ],
      // WF-026/027: no hash on files; no lease, model, cost or backoff on jobs.
      schedule_files: [
        'SELECT(id, user_id, offline_friend_id, storage_path, file_name, mime_type, size_bytes, pages, uploaded_at, delete_at, created_at)',
      ],
      parse_jobs: [
        'SELECT(id, user_id, file_id, status, draft, confidence, error, attempts, created_at, updated_at, committed_at)',
      ],
    });
  });
});

/**
 * Client-callable functions that are security definer: they read or write rows the caller can't
 * reach under RLS. Executable by `authenticated` only.
 */
const CLIENT_DEFINER_FUNCTIONS = [
  'accept_consent(text)',
  'accept_friend_request(uuid,integer)',
  'block_user(uuid)',
  'cancel_friend_request(uuid)',
  'clear_status()',
  'commit_schedule(jsonb,text,uuid)',
  'confirm_age(integer)',
  'confirm_parse_job(uuid,jsonb)',
  'create_friend_invite()',
  'create_group(text,text,integer)',
  'create_group_invite(uuid,timestamp with time zone,integer)',
  'create_offline_friend(text,text,boolean)',
  'create_schedule_upload(text,text,integer,text,uuid)',
  'current_user_id()',
  'decline_friend_request(uuid)',
  'delete_group(uuid)',
  'delete_offline_friend(uuid)',
  'delete_push_subscription(text)',
  'delete_schedule_upload(uuid)',
  'ensure_current_user(text,text,text)',
  'events_for_viewer(uuid,timestamp with time zone,timestamp with time zone)',
  'find_user_by_handle(text)',
  'get_friend_invite_summary(text)',
  'get_group_members(uuid)',
  'get_invite_summary(text)',
  'get_my_friend_invite()',
  'get_profile(uuid)',
  'join_group(text,integer)',
  'leave_group(uuid)',
  'list_blocked_users()',
  'list_friend_requests()',
  'list_friends()',
  'list_group_invites(uuid)',
  'list_inbox()',
  'list_my_groups()',
  'mark_pings_read(uuid[])',
  'now_for_viewer(timestamp with time zone,timestamp with time zone)',
  'preview_friend_invite(text)',
  'record_onboarding_step(text,boolean)',
  'regenerate_friend_invite()',
  'regenerate_group_invite(uuid)',
  'remove_group_member(uuid,uuid)',
  'reply_to_ping(uuid,text,text)',
  'request_friend_by_invite(text,integer)',
  'request_test_push()',
  'revoke_friend_invite()',
  'revoke_group_invite(uuid)',
  'save_push_subscription(text,text,text,text)',
  'send_friend_request(uuid,integer)',
  'send_friend_request_by_handle(text,integer)',
  'send_ping(uuid,text,text,boolean)',
  'set_group_member_permissions(uuid,uuid,boolean,boolean,boolean,boolean)',
  'set_handle(text)',
  'set_status(text,text,timestamp with time zone)',
  'start_parse_job(uuid)',
  'transfer_group_admin(uuid,uuid)',
  'unblock_user(uuid)',
  'unfriend(uuid)',
  'unread_ping_count()',
  'update_group(uuid,text,text)',
  'update_offline_friend(uuid,text,text)',
];

/** Client-callable functions that run as the caller, so RLS applies. `authenticated` only. */
const CLIENT_INVOKER_FUNCTIONS = [
  'account_status()',
  'current_consent_version()',
  'list_offline_friends()',
  'set_day_hours(text,text,text)',
];

/**
 * Server-only functions (WF-027, D46): security definer, executable by `service_role` only. The
 * Next.js server's parse route and sweep call them with the secret key; no user can.
 */
const SERVICE_FUNCTIONS = [
  'claim_parse_job(uuid,integer)',
  'claim_storage_removals(integer)',
  'complete_parse_job(uuid,integer,jsonb,text,text,numeric,numeric,integer)',
  'expire_schedule_files(integer)',
  'fail_parse_job(uuid,integer,text,boolean,text,text,numeric)',
  'finish_storage_removals(text[])',
  'list_due_parse_jobs(integer)',
];

/** The only functions callable without signing in: the /i/[code] invite page (FR-WEB-3). */
const ANON_FUNCTIONS = ['get_friend_invite_summary(text)', 'get_invite_summary(text)'];

/** Every function signed-in clients can call. */
const CLIENT_FUNCTIONS = [...CLIENT_DEFINER_FUNCTIONS, ...CLIENT_INVOKER_FUNCTIONS].sort();

/** Internal helpers in `private`: not security definer, not callable by clients. */
const PRIVATE_FUNCTIONS = [
  'private.assert_group_admin_in_sync(uuid)',
  'private.assign_generated_handle(uuid)',
  'private.authorize_group(uuid,uuid,text)',
  'private.authorize_invite_change(invites,uuid)',
  'private.check_event_offline_friend()',
  'private.check_parse_draft(jsonb)',
  'private.check_tier(integer)',
  'private.clean_file_name(text)',
  'private.clean_group_emoji(text)',
  'private.clean_group_name(text)',
  'private.clean_offline_friend_nickname(text)',
  'private.clean_ping_text(text)',
  'private.clean_push_device_label(text)',
  'private.clean_schedule_period(jsonb)',
  'private.close_active_status(uuid)',
  'private.connections(uuid)',
  'private.consume_rate_limit(uuid,text,integer,interval)',
  'private.create_default_availability_prefs()',
  'private.delete_friend_rules(uuid,uuid)',
  'private.drop_membership(uuid,uuid)',
  'private.epoch_ms(timestamp with time zone)',
  'private.find_friend_invite(text)',
  'private.group_admin_in_sync_trigger()',
  'private.handle_base(text)',
  'private.insert_group_invite(uuid,uuid,timestamp with time zone,integer)',
  'private.invite_status(invites)',
  'private.is_blocked(uuid,uuid)',
  'private.local_to_utc(timestamp without time zone,text)',
  'private.lock_group(uuid)',
  'private.lock_invite_for_member(uuid,uuid)',
  'private.lock_pair(uuid,uuid)',
  'private.lock_user(uuid)',
  'private.new_invite_code()',
  'private.normalize_handle(text)',
  'private.ping_status(uuid,timestamp with time zone)',
  'private.protect_age_confirmation()',
  'private.protect_source_offline_friend()',
  'private.purge_expired_rate_limits()',
  'private.purge_expired_status_overrides(interval)',
  'private.purge_old_pings(interval)',
  'private.queue_schedule_file_removals()',
  'private.redacted_events(uuid,smallint,timestamp with time zone,timestamp with time zone)',
  'private.relationship(uuid,uuid)',
  'private.require_user()',
  'private.resolve_tier(uuid,uuid)',
  'private.schedule_check_keys(jsonb,text[],text)',
  'private.schedule_date(jsonb,text)',
  'private.schedule_event_row(jsonb,integer,date,date,text)',
  'private.schedule_time(jsonb,text)',
  'private.send_friend_request(uuid,uuid,integer)',
  'private.set_friend_rule(uuid,uuid,smallint)',
  'private.signal_blocks_changed()',
  'private.signal_connections_of(uuid[])',
  'private.signal_friendships_changed()',
  'private.signal_group_members_changed()',
  'private.signal_inbox_changed(uuid[])',
  'private.signal_now_changed(uuid[])',
  'private.signal_owner_rows_changed()',
  'private.signal_parse_job_changed(uuid[])',
  'private.signal_user_changed()',
  'private.signal_visibility_rules_changed()',
  'private.to_friend_invite(invites)',
  'private.to_group_invite(invites,uuid)',
  'private.try_consume_rate_limit(uuid,text,integer,interval)',
  'private.validate_user_timezone()',
  'private.validate_weekly_hours()',
  'private.visible_overrides(uuid,smallint,timestamp with time zone,timestamp with time zone)',
  'private.visible_profile(uuid,uuid)',
  'private.visible_sources(uuid,smallint,timestamp with time zone,timestamp with time zone)',
];

/**
 * The only security definer functions in `private`: the Realtime signal triggers (WF-064), which
 * fire for client writes under RLS and must read other users' connections and write
 * realtime.messages, and the group admin check (WF-043), a deferred trigger that fires at commit
 * whatever role Postgres fires it as. They return `trigger`, so they can't be called directly.
 */
const PRIVATE_DEFINER_TRIGGER_FUNCTIONS = [
  'private.group_admin_in_sync_trigger()',
  'private.signal_blocks_changed()',
  'private.signal_friendships_changed()',
  'private.signal_group_members_changed()',
  'private.signal_owner_rows_changed()',
  'private.signal_user_changed()',
  'private.signal_visibility_rules_changed()',
];

describe('functions', () => {
  it('the private schema holds exactly the internal helpers; only trigger functions are definer', async () => {
    const fns = await rows<{ fn: string; definer: boolean; returns: string }>(
      `select p.oid::regprocedure::text as fn, p.prosecdef as definer,
              p.prorettype::regtype::text as returns
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' order by 1`,
    );
    expect(fns.map((f) => f.fn)).toEqual(PRIVATE_FUNCTIONS);
    const definers = fns.filter((f) => f.definer);
    expect(definers.map((f) => f.fn)).toEqual(PRIVATE_DEFINER_TRIGGER_FUNCTIONS);
    for (const f of definers)
      expect({ fn: f.fn, returns: f.returns }).toEqual({ fn: f.fn, returns: 'trigger' });
  });

  it('every security definer function pins search_path to empty', async () => {
    const definers = await rows<{ fn: string; config: string[] | null }>(
      `select p.oid::regprocedure::text as fn, p.proconfig as config
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and p.prosecdef
       order by p.oid::regprocedure::text collate "C"`,
    );
    expect(definers.map((d) => d.fn)).toEqual(
      [
        ...CLIENT_DEFINER_FUNCTIONS,
        ...SERVICE_FUNCTIONS,
        ...PRIVATE_DEFINER_TRIGGER_FUNCTIONS,
      ].sort(),
    );
    for (const d of definers) expect(d.config).toEqual(['search_path=""']);
  });

  it('every function of ours pins search_path', async () => {
    const loose = await rows(
      `select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private')
         and not coalesce(p.proconfig @> array['search_path=""'], false)`,
    );
    expect(loose).toEqual([]);
  });

  it('clients can execute only CLIENT_FUNCTIONS, anon only ANON_FUNCTIONS, the secret key only SERVICE_FUNCTIONS', async () => {
    for (const role of CLIENT_ROLES) {
      const callable = await rows<{ fn: string }>(
        `select p.oid::regprocedure::text as fn from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('public', 'private')
           and has_function_privilege($1, p.oid, 'EXECUTE')
           and has_schema_privilege($1, n.oid, 'USAGE')
         order by 1`,
        [role],
      );
      expect({ role, callable: callable.map((c) => c.fn) }).toEqual({
        role,
        callable:
          role === 'authenticated'
            ? CLIENT_FUNCTIONS
            : role === 'anon'
              ? ANON_FUNCTIONS
              : SERVICE_FUNCTIONS,
      });
    }
  });

  it('no client role can use the private schema', async () => {
    for (const role of CLIENT_ROLES) {
      const [row] = await rows<{ usage: boolean }>(
        `select has_schema_privilege($1, 'private', 'USAGE') as usage`,
        [role],
      );
      expect({ role, usage: row?.usage }).toEqual({ role, usage: false });
    }
  });
});

describe('GROUP_ERRORS, OFFLINE_FRIEND_ERRORS, PUSH_SUBSCRIPTION_ERRORS, PING_ERRORS and SCHEDULE_FILE_ERRORS (src/index.ts) match what the migrations raise', () => {
  it('every message is raised somewhere, verbatim', async () => {
    const sql = (await Promise.all((await migrationFiles()).map((f) => readFile(f, 'utf8')))).join(
      '\n',
    );
    for (const message of [
      ...Object.values(GROUP_ERRORS),
      ...Object.values(OFFLINE_FRIEND_ERRORS),
      ...Object.values(PUSH_SUBSCRIPTION_ERRORS),
      ...Object.values(PING_ERRORS),
      ...Object.values(SCHEDULE_FILE_ERRORS),
    ])
      expect({ message, raised: sql.includes(`'${message.replaceAll("'", "''")}'`) }).toEqual({
        message,
        raised: true,
      });
  });
});

describe('triggers', () => {
  it('are exactly these (the admin-sync ones are deferred constraint triggers)', async () => {
    const triggers = await rows<{ t: string; deferred: boolean }>(
      `select c.relname || '.' || t.tgname as t, t.tginitdeferred as deferred
       from pg_trigger t join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and not t.tgisinternal order by 1`,
    );
    expect(triggers).toEqual([
      { t: 'availability_prefs.availability_prefs_signal_now_update', deferred: false },
      { t: 'availability_prefs.availability_prefs_validate_weekly', deferred: false },
      { t: 'blocks.blocks_signal_now_delete', deferred: false },
      { t: 'blocks.blocks_signal_now_insert', deferred: false },
      { t: 'events.events_check_offline_friend', deferred: false },
      { t: 'events.events_signal_now_delete', deferred: false },
      { t: 'events.events_signal_now_insert', deferred: false },
      { t: 'events.events_signal_now_update', deferred: false },
      { t: 'friendships.friendships_signal_now_delete', deferred: false },
      { t: 'friendships.friendships_signal_now_insert', deferred: false },
      { t: 'friendships.friendships_signal_now_update', deferred: false },
      { t: 'group_members.group_members_admin_in_sync_delete', deferred: true },
      { t: 'group_members.group_members_admin_in_sync_insert', deferred: true },
      { t: 'group_members.group_members_admin_in_sync_update', deferred: true },
      { t: 'group_members.group_members_signal_now_delete', deferred: false },
      { t: 'group_members.group_members_signal_now_insert', deferred: false },
      { t: 'groups.groups_admin_in_sync', deferred: true },
      { t: 'schedule_files.schedule_files_queue_removal', deferred: false },
      { t: 'sources.sources_protect_offline_friend', deferred: false },
      { t: 'sources.sources_signal_now_delete', deferred: false },
      { t: 'sources.sources_signal_now_insert', deferred: false },
      { t: 'sources.sources_signal_now_update', deferred: false },
      { t: 'status_overrides.status_overrides_signal_now_delete', deferred: false },
      { t: 'status_overrides.status_overrides_signal_now_insert', deferred: false },
      { t: 'status_overrides.status_overrides_signal_now_update', deferred: false },
      { t: 'users.users_create_default_availability_prefs', deferred: false },
      { t: 'users.users_protect_age_confirmation', deferred: false },
      { t: 'users.users_signal_now_update', deferred: false },
      { t: 'users.users_validate_timezone', deferred: false },
      { t: 'visibility_rules.visibility_rules_signal_now_delete', deferred: false },
      { t: 'visibility_rules.visibility_rules_signal_now_insert', deferred: false },
      { t: 'visibility_rules.visibility_rules_signal_now_update', deferred: false },
    ]);
  });

  it('every Now signal trigger is an AFTER statement trigger (WF-064)', async () => {
    const loose = await rows<{ t: string }>(
      `select c.relname || '.' || t.tgname as t
       from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where t.tgname like '%_signal_now_%'
         and (t.tgtype & 1 = 1 or t.tgtype & 2 = 2)`,
    );
    // tgtype bit 0 = FOR EACH ROW, bit 1 = BEFORE.
    expect(loose).toEqual([]);
  });
});

describe('Realtime channel policies (WF-064)', () => {
  it('realtime.messages has exactly one policy: authenticated users receive their own channel', async () => {
    const policies = await rows<{ policyname: string; roles: string[]; cmd: string }>(
      `select policyname, roles, cmd from pg_policies where schemaname = 'realtime'
       order by policyname`,
    );
    expect(policies).toEqual([
      { policyname: 'whosfree_user_channel_receive_own', roles: ['authenticated'], cmd: 'SELECT' },
    ]);
  });
});

describe('no location data anywhere (D35)', () => {
  it('no column in public or private looks like a location', async () => {
    const cols = await rows<{ c: string }>(
      `select table_name || '.' || column_name as c from information_schema.columns
       where table_schema in ('public', 'private')
         and column_name ~* '(location|room|address|place|venue|geo|lat|lng|lon)'`,
    );
    // Reviewed false positives: "temp-lat-e" is the ping template (WF-092), not a latitude.
    const reviewed = new Set(['pings.template']);
    expect(cols.filter(({ c }) => !reviewed.has(c))).toEqual([]);
  });
});

describe('database constraints match @synkd/shared', () => {
  it('events.category accepts exactly EVENT_CATEGORIES', async () => {
    const u = await addUser(db, `user_cat_${Date.now()}`);
    const s = await addSource(db, u);
    const insert = (category: string) =>
      db.admin.query(
        `insert into public.events (user_id, source_id, category, starts_at, ends_at)
         values ($1, $2, $3, now(), now() + interval '1 hour')`,
        [u, s, category],
      );
    for (const c of EVENT_CATEGORIES) await insert(c);
    await expect(insert('location')).rejects.toThrow(/events_category_check/);
  });

  it('pings.template and pings.reply accept exactly PING_TEMPLATES and PING_REPLIES', async () => {
    const a = await addUser(db, `user_ping_a_${Date.now()}`);
    const b = await addUser(db, `user_ping_b_${Date.now()}`);
    const insert = (template: string, reply: string | null) =>
      db.admin.query(
        `insert into public.pings (sender_id, recipient_id, template, reply, replied_at, expires_at)
         values ($1, $2, $3, $4, case when $4::text is null then null else now() end,
                 now() + interval '2 hours')`,
        [a, b, template, reply],
      );
    for (const t of PING_TEMPLATES) await insert(t, null);
    for (const r of PING_REPLIES) await insert(PING_TEMPLATES[0], r);
    await expect(insert('Wanna fight?', null)).rejects.toThrow(/pings_template_check/);
    await expect(insert(PING_TEMPLATES[0], 'Nah')).rejects.toThrow(/pings_reply_check/);
  });

  it('users.onboarding_steps accepts exactly ONBOARDING_STEPS (WF-068)', async () => {
    const u = await addUser(db, `user_onb_${Date.now()}`);
    const set = (steps: string[]) =>
      db.admin.query(`update public.users set onboarding_steps = $2 where id = $1`, [u, steps]);
    await set([...ONBOARDING_STEPS]);
    await expect(set(['hours', 'tour'])).rejects.toThrow(/users_onboarding_steps_check/);
  });

  it('sources.type accepts exactly SOURCE_TYPES', async () => {
    const u = await addUser(db, `user_src_${Date.now()}`);
    for (const t of SOURCE_TYPES) await addSource(db, u, { type: t });
    await expect(addSource(db, u, { type: 'ics' as never })).rejects.toThrow(/sources_type_check/);
  });

  it('visibility_rules.tier accepts exactly TIERS and defaults to DEFAULT_TIER', async () => {
    const [def] = await rows<{ d: string }>(
      `select column_default as d from information_schema.columns
       where table_name = 'visibility_rules' and column_name = 'tier'`,
    );
    expect(def?.d).toBe(String(DEFAULT_TIER));
    const u = await addUser(db, `user_tier_${Date.now()}`);
    const insert = (tier: number) =>
      db.admin.query(
        `insert into public.visibility_rules (owner_id, target_type, target_id, tier)
         values ($1, 'group', gen_random_uuid(), $2)`,
        [u, tier],
      );
    for (const t of TIERS) await insert(t);
    for (const bad of [0, 4])
      await expect(insert(bad)).rejects.toThrow(/visibility_rules_tier_check/);
  });

  it('groups.max_members and member permissions default as in shared (D17, D26)', async () => {
    const admin = await addUser(db, `user_grp_${Date.now()}`);
    const member = await addUser(db, `user_grp_member_${Date.now()}`);
    const { g, m } = await db.admin.transaction(async (tx) => {
      const {
        rows: [g],
      } = await tx.query<{ id: string; max_members: number }>(
        `insert into public.groups (name, admin_id) values ('G', $1) returning id, max_members`,
        [admin],
      );
      await tx.query(
        `insert into public.group_members (group_id, user_id, role) values ($1, $2, 'admin')`,
        [g?.id, admin],
      );
      const {
        rows: [m],
      } = await tx.query(
        `insert into public.group_members (group_id, user_id) values ($1, $2)
         returning can_invite as invite, can_manage_members as "manageMembers",
                   can_edit_group as "editGroup", can_group_ping as "groupPing", role`,
        [g?.id, member],
      );
      return { g, m };
    });
    expect(g?.max_members).toBe(DEFAULT_GROUP_MAX_MEMBERS);
    expect(m).toEqual({ ...DEFAULT_MEMBER_PERMISSIONS, role: 'member' });
  });
});
