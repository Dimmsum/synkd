// Test harness: an in-process Postgres (PGlite) with a Supabase stand-in and
// every migration applied, plus helpers to run queries as a given API role.
//
// Only for tests and type generation. Production runs on real Supabase.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { Transaction } from '@electric-sql/pglite';

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..');
export const MIGRATIONS_DIR = join(PACKAGE_ROOT, 'supabase', 'migrations');
const SHIM_PATH = join(import.meta.dirname, 'supabase-shim.sql');

/** Migration files in the order the Supabase CLI applies them (by timestamp prefix). */
export async function migrationFiles(): Promise<string[]> {
  const names = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d{14}_.+\.sql$/.test(f));
  return names.sort().map((f) => join(MIGRATIONS_DIR, f));
}

/** Installs the Supabase shim, then applies every migration in order. */
export async function applySchema(pg: PGlite): Promise<void> {
  await pg.exec(await readFile(SHIM_PATH, 'utf8'));
  for (const file of await migrationFiles()) {
    try {
      await pg.exec(await readFile(file, 'utf8'));
    } catch (error) {
      throw new Error(`Migration failed: ${file}`, { cause: error });
    }
  }
}

type Row = Record<string, unknown>;

/** A request context: one API role plus (optionally) a verified JWT's claims. */
export interface Session {
  /** Runs one statement inside its own transaction as this role. */
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs several statements in one transaction as this role, like one API request. */
  run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
}

/** The roles Supabase's Data API switches to per request (from the JWT `role` claim). */
type ApiRole = 'anon' | 'authenticated' | 'service_role';

export interface TestDb {
  /** Superuser connection (like the `postgres` role in migrations). Use only for seeding and assertions. */
  readonly admin: PGlite;
  /** A signed-in Clerk user. The token's `sub` is `clerkId`; there may or may not be a `users` row for it. */
  asUser(clerkId: string): Session;
  /** A request with only the anon key (no user token). */
  asAnon(): Session;
  /** The service-role key (server-side only; bypasses RLS). */
  asService(): Session;
  /** Deletes all rows from every table in `public`, keeping the schema. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

function session(pg: PGlite, role: ApiRole, claims: Record<string, unknown>): Session {
  const run = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    pg.transaction(async (tx) => {
      // Same as what PostgREST does per request: SET LOCAL ROLE and the JWT claims.
      await tx.query(
        `select set_config('role', $1, true), set_config('request.jwt.claims', $2, true)`,
        [role, JSON.stringify(claims)],
      );
      return fn(tx);
    });
  return {
    run,
    query: <T extends Row = Row>(sql: string, params: unknown[] = []) =>
      run(async (tx) => (await tx.query<T>(sql, params)).rows),
  };
}

/**
 * Path to an empty PGlite data directory saved by the Vitest global setup.
 * Starting from it skips initdb; when unset, a new database is initialised.
 */
export const TEMPLATE_ENV = 'WHOSFREE_PGLITE_EMPTY_DATADIR';

async function emptyDatabase(): Promise<PGlite> {
  const template = process.env[TEMPLATE_ENV];
  if (!template) return PGlite.create();
  return PGlite.create({ loadDataDir: new Blob([await readFile(template)]) });
}

/** Creates a fresh in-memory database with the shim and all migrations applied. */
export async function createTestDb(): Promise<TestDb> {
  const pg = await emptyDatabase();
  await applySchema(pg);
  const tables = (
    await pg.query<{ name: string }>(
      `select format('%I.%I', schemaname, tablename) as name from pg_tables where schemaname = 'public'`,
    )
  ).rows.map((r) => r.name);

  return {
    admin: pg,
    asUser: (clerkId) =>
      session(pg, 'authenticated', {
        sub: clerkId,
        role: 'authenticated',
        iss: 'https://clerk.test',
      }),
    asAnon: () => session(pg, 'anon', { role: 'anon' }),
    asService: () => session(pg, 'service_role', { role: 'service_role' }),
    reset: async () => {
      if (tables.length > 0) await pg.exec(`truncate ${tables.join(', ')} cascade`);
    },
    close: () => pg.close(),
  };
}
