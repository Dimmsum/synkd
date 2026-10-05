// A prompt and its hash. Kept apart from the file loader (prompt.ts) so the server's parse
// pipeline can use the embedded production prompt without importing `node:fs`.
import { createHash } from 'node:crypto';
import { PARSE_PROMPT_VERSION } from '@synkd/shared';
import { PROMPT_V3_TEXT } from './prompt-text';

export interface Prompt {
  /** e.g. `v1`. Recorded as the prompt version on eval results and in `parse_jobs.parser_version`. */
  version: string;
  text: string;
  /** SHA-256 of `text`, hex. */
  sha256: string;
}

export function makePrompt(version: string, text: string): Prompt {
  return { version, text, sha256: createHash('sha256').update(text).digest('hex') };
}

/** The prompt production parses use (PARSE_PROMPT_VERSION in @synkd/shared). */
export const PRODUCTION_PROMPT: Prompt = makePrompt(PARSE_PROMPT_VERSION, PROMPT_V3_TEXT);
