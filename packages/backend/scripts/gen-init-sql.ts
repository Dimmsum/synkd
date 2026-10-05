// pnpm --filter @synkd/backend db:init           regenerate supabase/init.sql
// pnpm --filter @synkd/backend db:init --check   exit 1 if it is out of date

import { readFile, writeFile } from 'node:fs/promises';
import { INIT_SQL_PATH, buildInitSql } from './init-sql';

const generated = await buildInitSql();

if (process.argv.includes('--check')) {
  const current = await readFile(INIT_SQL_PATH, 'utf8').catch(() => '');
  if (current !== generated) {
    console.error('supabase/init.sql is out of date. Run: pnpm --filter @synkd/backend db:init');
    process.exitCode = 1;
  }
} else {
  await writeFile(INIT_SQL_PATH, generated);
}
