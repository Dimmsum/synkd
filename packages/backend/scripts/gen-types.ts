// pnpm --filter @whosfree/backend db:types                 regenerate src/database.types.ts
// pnpm --filter @whosfree/backend db:types --check         exit 1 if it is out of date
// pnpm --filter @whosfree/backend db:types --db-url <url>  generate from a running database instead
//   (e.g. postgresql://postgres:postgres@127.0.0.1:54322/postgres after `supabase start`)

import { readFile, writeFile } from 'node:fs/promises';
import { TYPES_PATH, generateTypes } from './generate-types';

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--db-url');
const generated = await generateTypes(urlIndex >= 0 ? args[urlIndex + 1] : undefined);

if (args.includes('--check')) {
  const current = await readFile(TYPES_PATH, 'utf8').catch(() => '');
  if (current !== generated) {
    console.error(
      'src/database.types.ts is out of date. Run: pnpm --filter @whosfree/backend db:types',
    );
    process.exitCode = 1;
  }
} else {
  await writeFile(TYPES_PATH, generated);
}
