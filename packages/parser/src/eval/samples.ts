// Finding eval samples on disk and loading their expected drafts (WF-020, WF-022).
//
// Layout: every schedule file `<name>.<pdf|png|jpg|jpeg|webp|heic|heif>` sits next to a
// hand-written `<name>.expected.json`. Samples can be grouped in sub-folders (e.g. `uni/`,
// `roster/`); the first folder becomes the sample's group in the results.
import { ParseDraft } from '@whosfree/shared';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { z } from 'zod';
import { isScheduleFileExtension, type ScheduleFileExtension } from '../media';

export const EXPECTED_SUFFIX = '.expected.json';

export interface SampleRef {
  /** Path from the samples folder without the extension, `/`-separated, e.g. `uni/uwi-01`. */
  id: string;
  /** First folder under the samples folder, or `null` for samples at the top level. */
  group: string | null;
  filePath: string;
  ext: ScheduleFileExtension;
  expectedPath: string;
}

export interface Discovery {
  samples: SampleRef[];
  /** Files that look like samples but can't be used, e.g. a schedule without an expected file. */
  problems: string[];
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

/** Lists the samples under `dir`, sorted by id. */
export async function discoverSamples(dir: string): Promise<Discovery> {
  const files = await walk(dir);
  const fileSet = new Set(files);
  const samples: SampleRef[] = [];
  const problems: string[] = [];
  const claimedExpected = new Set<string>();

  for (const filePath of files) {
    const rel = relative(dir, filePath).split(sep).join('/');
    if (rel.endsWith(EXPECTED_SUFFIX)) continue;
    const dot = rel.lastIndexOf('.');
    const ext = dot === -1 ? '' : rel.slice(dot + 1).toLowerCase();
    if (!isScheduleFileExtension(ext)) continue; // READMEs, notes, consent records, etc.
    const id = rel.slice(0, dot);
    const expectedPath = filePath.slice(0, filePath.length - ext.length - 1) + EXPECTED_SUFFIX;
    if (!fileSet.has(expectedPath)) {
      problems.push(`${id}: no ${EXPECTED_SUFFIX} file next to it`);
      continue;
    }
    if (claimedExpected.has(expectedPath)) {
      problems.push(`${id}: another file with the same name already uses this ${EXPECTED_SUFFIX}`);
      continue;
    }
    claimedExpected.add(expectedPath);
    const slash = id.indexOf('/');
    samples.push({
      id,
      group: slash === -1 ? null : id.slice(0, slash),
      filePath,
      ext,
      expectedPath,
    });
  }

  for (const filePath of files) {
    if (filePath.endsWith(EXPECTED_SUFFIX) && !claimedExpected.has(filePath)) {
      const rel = relative(dir, filePath).split(sep).join('/');
      problems.push(`${rel}: no schedule file with the same name`);
    }
  }

  samples.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  problems.sort();
  return { samples, problems };
}

/**
 * An expected draft is a `ParseDraft`. `confidence` may be left out of hand-written events
 * and defaults to 1. Unknown keys (e.g. `notes`) are stripped; there is no location field (D35).
 */
export const ExpectedDraft = z.preprocess((raw) => {
  if (
    raw === null ||
    typeof raw !== 'object' ||
    !Array.isArray((raw as { events?: unknown }).events)
  ) {
    return raw;
  }
  const draft = raw as { events: unknown[] };
  return {
    ...draft,
    events: draft.events.map((e) =>
      e !== null && typeof e === 'object' && !('confidence' in e) ? { ...e, confidence: 1 } : e,
    ),
  };
}, ParseDraft);

/** Reads and validates an expected file. Errors name the path and the schema problems only. */
export async function loadExpected(path: string): Promise<ParseDraft> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    // V8's JSON errors quote part of the input, which could include a title (NFR-SEC-11).
    throw new Error(`${path}: not valid JSON`);
  }
  const result = ExpectedDraft.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`${path}: doesn't match the ParseDraft schema (${issues})`);
  }
  return result.data;
}
