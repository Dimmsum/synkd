// Eval CLI (WF-022). Run from the repo root:
//
//   pnpm --filter @whosfree/parser eval --model google/gemini-2.5-flash --prompt v1
//   pnpm --filter @whosfree/parser eval:compare [a.json b.json]
//
// See packages/parser/eval/README.md. Prints aggregate numbers only; per-sample detail goes to
// the result file (NFR-SEC-11). The API key comes from OPENROUTER_API_KEY in the environment or
// the repo's root .env, and is only ever sent to OpenRouter (NFR-SEC-8).
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { modelMediaType } from '../media';
import { PDF_ENGINES, type PdfEngine } from '../openrouter';
import { loadPrompt } from '../prompt';
import { compareResults, parseResultFile, summarizeResult } from './compare';
import { resultFileName } from './results';
import { DEFAULT_CONCURRENCY, loadSamples, runEval } from './runner';

const PACKAGE_DIR = fileURLToPath(new URL('../../', import.meta.url));
const REPO_DIR = resolve(PACKAGE_DIR, '../..');
/** PRD §8.2 and WF-020: real samples live here, and the folder is gitignored. */
export const DEFAULT_SAMPLES_DIR = join(REPO_DIR, 'evals/schedules');
/** Gitignored. */
export const DEFAULT_RESULTS_DIR = join(PACKAGE_DIR, 'eval/results');

const USAGE = `Usage:
  eval --model <openrouter-model-id> [--prompt v1] [options]
  eval:check [--samples <dir>]                      (validates the eval set, no model calls)
  eval:compare [<baseline.json> <candidate.json>]   (no files: the two newest results)

Run options:
  --samples <dir>       Samples folder (default: evals/schedules at the repo root)
  --out <dir>           Results folder (default: packages/parser/eval/results)
  --concurrency <n>     Requests in flight (default: ${DEFAULT_CONCURRENCY})
  --timeout <seconds>   Per-request timeout (default: 120)
  --pdf-engine <name>   ${PDF_ENGINES.join(' | ')} (default: OpenRouter's choice)
  --strict-schema       Ask for strict JSON-schema output
  --allow-non-zdr       Also route to endpoints without zero data retention
  --keep-output         Store each model output (contains titles) in the result file`;

export interface CliIo {
  env: Record<string, string | undefined>;
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
}

class UsageError extends Error {}

function positiveInt(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1)
    throw new UsageError(`--${name} must be a whole number above 0`);
  return n;
}

async function run(args: string[], io: CliIo): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      model: { type: 'string' },
      prompt: { type: 'string', default: 'v1' },
      samples: { type: 'string' },
      out: { type: 'string' },
      concurrency: { type: 'string' },
      timeout: { type: 'string' },
      'pdf-engine': { type: 'string' },
      'strict-schema': { type: 'boolean', default: false },
      'allow-non-zdr': { type: 'boolean', default: false },
      'keep-output': { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (!values.model)
    throw new UsageError('--model is required, e.g. --model google/gemini-2.5-flash');
  const pdfEngine = values['pdf-engine'];
  if (pdfEngine !== undefined && !(PDF_ENGINES as readonly string[]).includes(pdfEngine)) {
    throw new UsageError(`--pdf-engine must be one of: ${PDF_ENGINES.join(', ')}`);
  }
  const apiKey = io.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new UsageError(
      'OPENROUTER_API_KEY is not set. Put it in the root .env or export it (WF-013).',
    );
  }
  const at = (p: string) => (isAbsolute(p) ? p : resolve(io.cwd, p));
  const samplesDir = values.samples ? at(values.samples) : DEFAULT_SAMPLES_DIR;
  const outDir = values.out ? at(values.out) : DEFAULT_RESULTS_DIR;

  const result = await runEval(
    {
      model: values.model,
      prompt: await loadPrompt(values.prompt),
      samplesDir,
      concurrency: positiveInt(values.concurrency, 'concurrency', DEFAULT_CONCURRENCY),
      timeoutMs: positiveInt(values.timeout, 'timeout', 120) * 1000,
      ...(pdfEngine ? { pdfEngine: pdfEngine as PdfEngine } : {}),
      zdr: !values['allow-non-zdr'],
      strictSchema: values['strict-schema'],
      keepOutput: values['keep-output'],
    },
    {
      apiKey,
      ...(io.fetch ? { fetch: io.fetch } : {}),
      ...(io.now ? { clock: io.now } : {}),
      onProgress: (done, total) => io.stderr(`\r${done}/${total} samples`),
    },
  );
  io.stderr('\n');

  await mkdir(outDir, { recursive: true });
  const file = join(
    outDir,
    resultFileName(new Date(result.createdAt), result.run.model, result.run.promptVersion),
  );
  await writeFile(file, `${JSON.stringify(result, null, 2)}\n`);
  io.stdout(`${summarizeResult(result)}\n\nFull results: ${file}\n`);
}

/** Validates the eval set without calling any model: file pairs, expected JSON, magic bytes. */
async function check(args: string[], io: CliIo): Promise<void> {
  const { values } = parseArgs({ args, options: { samples: { type: 'string' } }, strict: true });
  const samplesDir = values.samples ? resolve(io.cwd, values.samples) : DEFAULT_SAMPLES_DIR;
  const samples = await loadSamples(samplesDir);
  const events = samples.reduce((n, s) => n + s.expected.events.length, 0);
  const unsupported = samples.filter((s) => modelMediaType(s.ref.ext) === null).length;
  io.stdout(
    `${samples.length} samples OK (${events} expected events)${unsupported ? `, ${unsupported} HEIC/HEIF will be skipped until converted` : ''}\n`,
  );
}

async function readResult(path: string) {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new UsageError(`Can't read ${path} as JSON`);
  }
  return parseResultFile(json, path);
}

async function compare(args: string[], io: CliIo): Promise<void> {
  const { positionals, values } = parseArgs({
    args,
    options: { out: { type: 'string' } },
    allowPositionals: true,
    strict: true,
  });
  const at = (p: string) => (isAbsolute(p) ? p : resolve(io.cwd, p));
  let files: string[];
  if (positionals.length === 2) {
    files = positionals.map(at);
  } else if (positionals.length === 0) {
    const dir = values.out ? at(values.out) : DEFAULT_RESULTS_DIR;
    const names = (await readdir(dir).catch(() => [] as string[]))
      .filter((n) => n.endsWith('.json'))
      .sort();
    if (names.length < 2) throw new UsageError(`Need two result files in ${dir} to compare`);
    files = names.slice(-2).map((n) => join(dir, n));
  } else {
    throw new UsageError('Give two result files, or none to compare the two newest');
  }
  const [a, b] = await Promise.all(files.map(readResult));
  io.stdout(`${compareResults(a!, b!)}\n`);
}

/** Returns the process exit code. */
export async function main(argv: string[], io: CliIo): Promise<number> {
  const [command, ...args] = argv;
  // `pnpm … eval -- --model x` passes the `--` through; parseArgs would treat the rest as positionals.
  const rest = args[0] === '--' ? args.slice(1) : args;
  try {
    if (command === 'run') await run(rest, io);
    else if (command === 'check') await check(rest, io);
    else if (command === 'compare') await compare(rest, io);
    else throw new UsageError(`Unknown command "${command ?? ''}"`);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.stderr(`${message}\n`);
    if (
      err instanceof UsageError ||
      (err instanceof Error && err.name === 'TypeError' && 'code' in err)
    ) {
      io.stderr(`\n${USAGE}\n`);
    }
    return 1;
  }
}

/**
 * OPENROUTER_API_KEY from the environment, or else from the repo's root .env. Only that one
 * variable is taken from the file; the other secrets in it stay out of this process.
 */
async function openRouterKey(): Promise<string | undefined> {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const content = await readFile(join(REPO_DIR, '.env'), 'utf8').catch(() => null);
  return content === null ? undefined : parseEnv(content).OPENROUTER_API_KEY || undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await main(process.argv.slice(2), {
    env: { OPENROUTER_API_KEY: process.argv[2] === 'run' ? await openRouterKey() : undefined },
    // pnpm runs scripts from the package folder; INIT_CWD is where the command was typed.
    cwd: process.env.INIT_CWD ?? process.cwd(),
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
  });
  process.exitCode = code;
}
