// supabase/init.sql must stay in step with the migrations, and set up the same schema.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INIT_SQL_PATH, buildInitSql } from '../scripts/init-sql';
import { applySchema } from './harness/db';

const SHIM_PATH = join(import.meta.dirname, 'harness', 'supabase-shim.sql');

// Everything a migration can create that clients or RLS depend on.
const CATALOG = `
  select 'table ' || schemaname || '.' || tablename || ' rls=' || rowsecurity::text as item
  from pg_tables where schemaname in ('public', 'private')
  union all
  select 'function ' || p.oid::regprocedure::text || ' definer=' || p.prosecdef::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
  union all
  select 'policy ' || schemaname || '.' || tablename || '.' || policyname
  from pg_policies where schemaname in ('public', 'private')
  union all
  select 'trigger ' || tgrelid::regclass::text || '.' || tgname
  from pg_trigger where not tgisinternal
  union all
  select 'grant ' || grantee || ' ' || table_schema || '.' || table_name || ' ' || privilege_type
  from information_schema.role_table_grants
  where table_schema in ('public', 'private') and grantee in ('anon', 'authenticated')
  order by 1`;

describe('supabase/init.sql', () => {
  let fromMigrations: PGlite;
  let fromInit: PGlite;

  // Two cold databases (initdb each, without the shared template), while the other test
  // files compete for CPU: allow more than the default hook timeout.
  beforeAll(async () => {
    fromMigrations = await PGlite.create();
    await applySchema(fromMigrations);
    fromInit = await PGlite.create();
    await fromInit.exec(await readFile(SHIM_PATH, 'utf8'));
    await fromInit.exec(await readFile(INIT_SQL_PATH, 'utf8'));
  }, 180_000);

  afterAll(async () => {
    await fromMigrations.close();
    await fromInit.close();
  });

  it('is up to date (run `pnpm --filter @synkd/backend db:init`)', async () => {
    expect(await readFile(INIT_SQL_PATH, 'utf8')).toBe(await buildInitSql());
  });

  it('sets up exactly the same schema as applying the migrations one by one', async () => {
    const catalog = async (pg: PGlite) =>
      (await pg.query<{ item: string }>(CATALOG)).rows.map((r) => r.item);
    const expected = await catalog(fromMigrations);
    expect(expected.length).toBeGreaterThan(0);
    expect(await catalog(fromInit)).toEqual(expected);
  });
});
