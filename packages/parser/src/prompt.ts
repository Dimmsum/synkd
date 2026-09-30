// Versioned extraction prompts. Each version is a file in `packages/parser/prompts/<version>.md`.
// A result records the version and a hash of the text, so an edited prompt can't pass as the old one.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Prompt {
  /** e.g. `v1`. Recorded as the parser version on eval results (and later on `parseJobs`, WF-027). */
  version: string;
  text: string;
  /** SHA-256 of `text`, hex. */
  sha256: string;
}

export const PROMPTS_DIR = fileURLToPath(new URL('../prompts/', import.meta.url));

const VERSION_RE = /^v\d+[a-z0-9-]*$/;

export function makePrompt(version: string, text: string): Prompt {
  return { version, text, sha256: createHash('sha256').update(text).digest('hex') };
}

/** Loads `prompts/<version>.md`. Versions look like `v1`, `v2`, `v2-terse`. */
export async function loadPrompt(version: string, dir: string = PROMPTS_DIR): Promise<Prompt> {
  if (!VERSION_RE.test(version)) {
    throw new Error(`Invalid prompt version "${version}". Expected something like "v1".`);
  }
  const text = await readFile(join(dir, `${version}.md`), 'utf8');
  return makePrompt(version, text.trim());
}
