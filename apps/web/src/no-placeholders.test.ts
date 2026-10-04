// WF-134: nothing a real user can reach shows mock people, placeholder results or a success
// that didn't happen. Unbuilt features say they're coming (components/app/coming-soon.tsx), and
// their server actions return an error instead of `ok`.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('.', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path),
  text: readFileSync(path, 'utf8'),
}));

describe('no placeholders reach users (WF-134)', () => {
  it('finds the app source', () => {
    expect(files.some((f) => f.path.startsWith('app/'))).toBe(true);
  });

  it('nothing imports mock data', () => {
    const offenders = files.filter((f) => /from ['"][^'"]*\/mock(\/|['"])/.test(f.text));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it('no server action fakes latency and reports success', () => {
    const offenders = files.filter((f) => /\bmockDelay\b/.test(f.text));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it('an unbuilt server action (one marked TODO) never returns ok', () => {
    const offenders = files
      .filter((f) => f.path.startsWith('lib/actions/') && f.text.startsWith("'use server'"))
      .flatMap((f) =>
        // Each exported function body, up to the next top-level closing brace.
        [...f.text.matchAll(/^export async function (\w+)[\s\S]*?^\}/gm)]
          .filter(([body]) => /\/\/ TODO\(/.test(body) && /\breturn ok\b/.test(body))
          .filter(([body]) => !/\brpc\(|\.from\(/.test(body))
          .map(([, name]) => `${f.path}: ${name}`),
      );
    expect(offenders).toEqual([]);
  });
});
