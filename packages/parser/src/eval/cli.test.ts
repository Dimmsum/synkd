import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { completion, jsonResponse, PNG_BYTES, SAMPLE_DRAFT } from '../testing';
import { main, type CliIo } from './cli';
import { EvalResult } from './results';

let dir: string;
let samples: string;
let out: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wf-cli-'));
  samples = join(dir, 'samples');
  out = join(dir, 'results');
  await mkdir(samples);
  await writeFile(join(samples, 'one.png'), PNG_BYTES);
  await writeFile(join(samples, 'one.expected.json'), JSON.stringify(SAMPLE_DRAFT));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function io(
  env: Record<string, string | undefined> = { OPENROUTER_API_KEY: 'sk-test' },
  when = '2026-09-30T12:00:00Z',
) {
  let stdout = '';
  let stderr = '';
  let calls = 0;
  const value: CliIo = {
    env,
    cwd: dir,
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
    fetch: (async () => {
      calls++;
      return jsonResponse(completion(JSON.stringify(SAMPLE_DRAFT)));
    }) as typeof globalThis.fetch,
    now: () => new Date(when),
  };
  return { io: value, out: () => ({ stdout, stderr, calls }) };
}

describe('eval CLI', () => {
  it('refuses to run without an API key, before any request', async () => {
    const t = io({});
    expect(await main(['run', '--model', 'test/model', '--samples', 'samples'], t.io)).toBe(1);
    expect(t.out().stderr).toContain('OPENROUTER_API_KEY is not set');
    expect(t.out().calls).toBe(0);
  });

  it('requires --model and rejects unknown options and commands', async () => {
    const t = io();
    expect(await main(['run'], t.io)).toBe(1);
    expect(t.out().stderr).toContain('--model is required');
    expect(await main(['run', '--model', 'm', '--nope'], t.io)).toBe(1);
    expect(await main(['launch'], t.io)).toBe(1);
    expect(await main(['run', '--model', 'm', '--concurrency', '0'], t.io)).toBe(1);
    expect(await main(['run', '--model', 'm', '--pdf-engine', 'magic'], t.io)).toBe(1);
    expect(t.out().calls).toBe(0);
  });

  it('writes a result file and prints aggregate numbers only', async () => {
    const t = io();
    const code = await main(
      [
        'run',
        '--model',
        'test/model',
        '--prompt',
        'v1',
        '--samples',
        'samples',
        '--out',
        'results',
      ],
      t.io,
    );
    expect(code).toBe(0);
    const files = await readdir(out);
    expect(files).toEqual(['2026-09-30T12-00-00Z-test_model-v1.json']);
    const result = EvalResult.parse(JSON.parse(await readFile(join(out, files[0]!), 'utf8')));
    expect(result.run.promptVersion).toBe('v1');
    expect(result.summary.scores.acceptance).toBe(1);
    const { stdout, stderr } = t.out();
    expect(stdout).toContain('Acceptance (≤ 3 edits)');
    expect(stdout).toContain('100.0%');
    expect(stdout + stderr).not.toContain(SAMPLE_DRAFT.events[0]!.title);
  });

  it('accepts a leading -- from pnpm', async () => {
    const t = io();
    expect(
      await main(
        ['run', '--', '--model', 'test/model', '--samples', 'samples', '--out', 'results'],
        t.io,
      ),
    ).toBe(0);
  });

  it('checks the eval set without calling a model or needing a key', async () => {
    await writeFile(join(samples, 'two.heic'), new Uint8Array([0, 0, 0, 24]));
    await writeFile(join(samples, 'two.expected.json'), JSON.stringify(SAMPLE_DRAFT));
    const t = io({});
    expect(await main(['check', '--samples', 'samples'], t.io)).toBe(0);
    expect(t.out().stdout).toBe(
      '2 samples OK (2 expected events), 1 HEIC/HEIF will be skipped until converted\n',
    );
    expect(t.out().calls).toBe(0);

    await writeFile(join(samples, 'three.png'), PNG_BYTES);
    expect(await main(['check', '--samples', 'samples'], t.io)).toBe(1);
    expect(t.out().stderr).toContain('three: no .expected.json file');
  });

  it('compares the two newest results when given no files', async () => {
    const first = io(undefined, '2026-09-30T12:00:00Z');
    await main(['run', '--model', 'a/model', '--samples', 'samples', '--out', 'results'], first.io);
    const second = io(undefined, '2026-09-30T13:00:00Z');
    await main(
      ['run', '--model', 'b/model', '--samples', 'samples', '--out', 'results'],
      second.io,
    );

    const t = io();
    expect(await main(['compare', '--out', 'results'], t.io)).toBe(0);
    const { stdout } = t.out();
    expect(stdout).toMatch(/^A: a\/model/);
    expect(stdout).toContain('B: b/model');
    expect(stdout).toContain('| Event F1');
    expect(stdout).toContain('| one ');
  });

  it('compares two named files and rejects files that are not results', async () => {
    await writeFile(join(dir, 'junk.json'), '{"hello": 1}');
    const t = io();
    expect(await main(['compare', 'junk.json', 'junk.json'], t.io)).toBe(1);
    expect(t.out().stderr).toContain('is not an eval result file');
    expect(await main(['compare', 'only-one.json'], t.io)).toBe(1);
  });
});
