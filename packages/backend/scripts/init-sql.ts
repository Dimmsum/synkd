// Builds supabase/init.sql: every migration in supabase/migrations, in order, in one transaction.
// The owner applies migrations by hand (Supabase SQL editor or psql), so init.sql sets up a fresh
// project in one step. Used by scripts/gen-init-sql.ts (db:init) and test/init-sql.test.ts.

import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { migrationFiles } from '../test/harness/db';

export const INIT_SQL_PATH = join(import.meta.dirname, '..', 'supabase', 'init.sql');

/** Returns the contents of supabase/init.sql, built from the migration files. */
export async function buildInitSql(): Promise<string> {
  const files = await migrationFiles();
  const names = files.map((f) => basename(f));
  const sections = await Promise.all(
    files.map(async (file) => {
      const sql = (await readFile(file, 'utf8')).trimEnd();
      return `-- ${'='.repeat(92)}\n-- ${basename(file)}\n-- ${'='.repeat(92)}\n\n${sql}\n`;
    }),
  );
  const header = [
    '-- synkd: the full database schema, for a NEW, EMPTY Supabase project.',
    '--',
    '-- GENERATED from supabase/migrations by `pnpm --filter @synkd/backend db:init`.',
    '-- Do not edit by hand: change or add a migration, then regenerate. A test fails if this',
    '-- file is out of date.',
    '--',
    '-- How to apply:',
    '--   * New project: run this whole file once (SQL editor or psql). It is one transaction,',
    '--     so if anything fails, nothing is applied.',
    '--   * Existing project: do NOT rerun this file. Apply only the migration files newer than',
    '--     the last one you applied, in filename order, from supabase/migrations.',
    '--',
    `-- Includes ${names.length} migrations (latest last):`,
    ...names.map((n) => `--   ${n}`),
    '',
    'begin;',
    '',
  ].join('\n');
  return `${header}\n${sections.join('\n')}\ncommit;\n`;
}
