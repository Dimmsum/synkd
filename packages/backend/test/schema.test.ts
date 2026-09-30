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
  SOURCE_TYPES,
  TIERS,
} from '@whosfree/shared';
import { GROUP_ERRORS } from '../src/index';
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
      'blocks',
      'events',
      'friendships',
      'group_members',
      'groups',
      'invites',
      'sources',
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
      'blocks.blocks_select_blocker (SELECT)',
      'events.events_delete_own (DELETE)',
      'events.events_insert_own (INSERT)',
      'events.events_select_own (SELECT)',
      'events.events_update_own (UPDATE)',
      'friendships.friendships_select_party (SELECT)',
      'group_members.group_members_select_own (SELECT)',
      'groups.groups_select_member (SELECT)',
      'sources.sources_delete_own (DELETE)',
      'sources.sources_insert_own (INSERT)',
      'sources.sources_select_own (SELECT)',
      'sources.sources_update_own (UPDATE)',
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
    });
  });
});

/** Signed-in entry points (WF-041, WF-043, WF-044, WF-045, WF-047). Each is a security definer. */
const AUTHENTICATED_FUNCTIONS = [
  'create_group(text,text,integer)',
  'create_group_invite(uuid,timestamp with time zone,integer)',
  'current_user_id()',
  'delete_group(uuid)',
  'events_for_viewer(uuid,timestamp with time zone,timestamp with time zone)',
  'get_group_members(uuid)',
  'get_invite_summary(text)',
  'join_group(text,integer)',
  'leave_group(uuid)',
  'list_group_invites(uuid)',
  'list_my_groups()',
  'regenerate_group_invite(uuid)',
  'remove_group_member(uuid,uuid)',
  'revoke_group_invite(uuid)',
  'set_group_member_permissions(uuid,uuid,boolean,boolean,boolean,boolean)',
  'transfer_group_admin(uuid,uuid)',
  'update_group(uuid,text,text)',
];

/** The only function callable without signing in: the /i/[code] invite page (FR-WEB-3). */
const ANON_FUNCTIONS = ['get_invite_summary(text)'];

describe('functions', () => {
  it('every security definer function pins search_path to empty', async () => {
    const definers = await rows<{ fn: string; config: string[] | null }>(
      `select p.oid::regprocedure::text as fn, p.proconfig as config
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and p.prosecdef order by 1`,
    );
    expect(definers.map((d) => d.fn)).toEqual(AUTHENTICATED_FUNCTIONS);
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

  it('no private helper is security definer (they run inside the definer entry points)', async () => {
    const definers = await rows(
      `select p.oid::regprocedure::text from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and p.prosecdef`,
    );
    expect(definers).toEqual([]);
  });

  it('clients can execute only the entry points above (anon: ANON_FUNCTIONS only)', async () => {
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
      const expected = { authenticated: AUTHENTICATED_FUNCTIONS, anon: ANON_FUNCTIONS };
      expect({ role, callable: callable.map((c) => c.fn) }).toEqual({
        role,
        callable: role === 'service_role' ? [] : expected[role],
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

describe('GROUP_ERRORS (src/index.ts) matches what the migrations raise', () => {
  it('every message is raised somewhere, verbatim', async () => {
    const sql = (await Promise.all((await migrationFiles()).map((f) => readFile(f, 'utf8')))).join(
      '\n',
    );
    for (const message of Object.values(GROUP_ERRORS))
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
      { t: 'group_members.group_members_admin_in_sync_delete', deferred: true },
      { t: 'group_members.group_members_admin_in_sync_insert', deferred: true },
      { t: 'group_members.group_members_admin_in_sync_update', deferred: true },
      { t: 'groups.groups_admin_in_sync', deferred: true },
      { t: 'users.users_validate_timezone', deferred: false },
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
    expect(cols).toEqual([]);
  });
});

describe('database constraints match @whosfree/shared', () => {
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
