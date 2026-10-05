// Vitest global setup: run Postgres's initdb once (it takes ~2 s in PGlite)
// and save the empty data directory, so each test file can start from a copy
// instead of repeating it. Each file still installs the Supabase shim and
// applies every migration itself.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { TEMPLATE_ENV } from './db';

export default async function setup(): Promise<() => Promise<void>> {
  const dir = await mkdtemp(join(tmpdir(), 'synkd-pglite-'));
  const file = join(dir, 'empty-datadir.tar');
  const pg = await PGlite.create();
  const dump = await pg.dumpDataDir('none');
  await pg.close();
  await writeFile(file, new Uint8Array(await dump.arrayBuffer()));
  process.env[TEMPLATE_ENV] = file;
  return async () => {
    await rm(dir, { recursive: true, force: true });
  };
}
