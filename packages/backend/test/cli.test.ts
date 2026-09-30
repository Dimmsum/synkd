// Checks with the real Supabase CLI (no Docker: PGlite served over TCP).

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { TYPES_PATH, generateTypes, servePglite, supabaseCli } from '../scripts/generate-types';
import { migrationFiles } from './harness/db';

describe('Supabase CLI', () => {
  it('`supabase db push` applies every migration to a fresh database', async () => {
    const pg = await PGlite.create();
    try {
      await pg.exec(await readFile(join(import.meta.dirname, 'harness/supabase-shim.sql'), 'utf8'));
      await servePglite(pg, (url) => supabaseCli(['db', 'push', '--db-url', url, '--yes']));
      const { rows } = await pg.query<{ version: string }>(
        `select version from supabase_migrations.schema_migrations order by version`,
      );
      const expected = (await migrationFiles()).map((f) => /(\d{14})_[^/]+$/.exec(f)?.[1]);
      expect(rows.map((r) => r.version)).toEqual(expected);
    } finally {
      await pg.close();
    }
  }, 120_000);

  it('src/database.types.ts is up to date (run `pnpm --filter @whosfree/backend db:types`)', async () => {
    const committed = await readFile(TYPES_PATH, 'utf8');
    expect(await generateTypes()).toBe(committed);
  }, 120_000);
});
