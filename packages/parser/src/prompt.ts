// Versioned extraction prompts. Each version is a file in `packages/parser/prompts/<version>.md`.
// A result records the version and a hash of the text, so an edited prompt can't pass as the old one.
// v1 stays as it was for eval comparability; production uses PRODUCTION_PROMPT (prompt-core.ts).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePrompt, type Prompt } from './prompt-core';

export { makePrompt, PRODUCTION_PROMPT, type Prompt } from './prompt-core';

export const PROMPTS_DIR = fileURLToPath(new URL('../prompts/', import.meta.url));

const VERSION_RE = /^v\d+[a-z0-9-]*$/;

/** Loads `prompts/<version>.md`. Versions look like `v1`, `v2`, `v2-terse`. */
export async function loadPrompt(version: string, dir: string = PROMPTS_DIR): Promise<Prompt> {
  if (!VERSION_RE.test(version)) {
    throw new Error(`Invalid prompt version "${version}". Expected something like "v1".`);
  }
  const text = await readFile(join(dir, `${version}.md`), 'utf8');
  return makePrompt(version, text.trim());
}
