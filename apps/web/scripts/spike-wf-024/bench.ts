// SPIKE (WF-024): measures the spike converter on the generated fixtures. Each case runs in a
// fresh Node process so its peak RSS (the number that matters against Vercel's 2 GB) is clean.
//
// Run from apps/web with Node ≥ 22.18 (type stripping), after fixtures.ts:
//   node scripts/spike-wf-024/bench.ts [fixturesDir]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const say = (s: string) => process.stdout.write(`${s}\n`);
const round = (n: number) => Math.round(n);

interface CaseResult {
  file: string;
  concurrency: number;
  ok: boolean;
  error?: string;
  inputMb?: number;
  pages?: number;
  outDims?: string;
  outKb?: number;
  coldMs?: number;
  initMs?: number;
  warmMs?: number;
  /** Process CPU time (user + system) per conversion, best of three warm rounds. */
  cpuMs?: number;
  perPageMs?: number;
  peakRssMb?: number;
  baselineRssMb?: number;
}

async function runOne(path: string, concurrency: number): Promise<CaseResult> {
  const { convertUpload, memorySnapshot } = await import('../../src/spike/wf-024/convert.ts');
  const bytes = new Uint8Array(readFileSync(path));
  const base: CaseResult = { file: basename(path), concurrency, ok: false };
  const baselineRssMb = memorySnapshot().rssMb;
  try {
    const t0 = performance.now();
    const cold = await convertUpload(bytes);
    const coldMs = performance.now() - t0;
    // Warm runs: `concurrency` conversions at once, as fluid compute may put several requests on
    // one instance. Best of three rounds, to filter out noise from other load on the machine.
    // CPU time is reported too: unlike wall time it barely moves when other processes compete
    // for the machine, and it is what Vercel bills as Active CPU.
    const rounds: number[] = [];
    const cpuRounds: number[] = [];
    for (let r = 0; r < 3; r++) {
      const t = performance.now();
      const c = process.cpuUsage();
      await Promise.all(Array.from({ length: concurrency }, () => convertUpload(bytes)));
      const { user, system } = process.cpuUsage(c);
      rounds.push(performance.now() - t);
      cpuRounds.push((user + system) / 1000 / concurrency);
    }
    const warmMs = Math.min(...rounds);
    const cpuMs = Math.min(...cpuRounds);
    const pages = cold.images.length;
    return {
      ...base,
      ok: true,
      inputMb: Math.round((bytes.byteLength / 1024 / 1024) * 100) / 100,
      pages,
      outDims: cold.images.map((i) => `${i.width}x${i.height}`)[0],
      outKb: round(cold.images.reduce((n, i) => n + i.bytes.byteLength, 0) / 1024),
      coldMs: round(coldMs),
      initMs: round(cold.initMs),
      warmMs: round(warmMs),
      cpuMs: round(cpuMs),
      perPageMs: round(warmMs / concurrency / pages),
      peakRssMb: memorySnapshot().maxRssMb,
      baselineRssMb,
    };
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error),
      peakRssMb: memorySnapshot().maxRssMb,
    };
  }
}

async function sharpDecodesHeic(path: string): Promise<string> {
  const { default: sharp } = await import('sharp');
  try {
    await sharp(readFileSync(path)).jpeg().toBuffer();
    return 'yes';
  } catch (error) {
    return `no (${error instanceof Error ? error.message.split('\n')[0] : 'error'})`;
  }
}

const args = process.argv.slice(2);
if (args[0] === '--one') {
  // Child mode: one case, JSON on stdout.
  const result = await runOne(args[1] ?? '', Number(args[2] ?? 1));
  process.stdout.write(JSON.stringify(result));
} else {
  const dir = args[0] ?? join(tmpdir(), 'whosfree-wf024');
  const self = fileURLToPath(import.meta.url);
  const cases: [string, number][] = [
    ['vector-1p.pdf', 1],
    ['vector-5p.pdf', 1],
    ['vector-6p.pdf', 1],
    ['scan-5p.pdf', 1],
    ['scan-5p.pdf', 3],
    ['photo-12mp.jpg', 1],
    ['photo-48mp.jpg', 1],
    ['photo-12mp.heic', 1],
    ['photo-12mp.heic', 3],
    ['photo-48mp.heic', 1],
    ['photo-48mp.heic', 3],
  ];
  say(`node ${process.version} ${process.platform}/${process.arch}\n`);
  say(
    '| file | conc. | input MB | pages | output | out KB | cold ms (init) | warm ms (best of 3) | CPU ms per file | per page ms | peak RSS MB |',
  );
  say('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [file, concurrency] of cases) {
    const path = join(dir, file);
    if (!existsSync(path)) {
      say(`| ${file} | ${concurrency} | missing | | | | | | | | |`);
      continue;
    }
    const raw = execFileSync(process.execPath, [self, '--one', path, String(concurrency)], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    const r = JSON.parse(raw) as CaseResult;
    say(
      r.ok
        ? `| ${r.file} | ${r.concurrency} | ${r.inputMb} | ${r.pages} | ${r.outDims} | ${r.outKb} | ${r.coldMs} (${r.initMs}) | ${r.warmMs} | ${r.cpuMs} | ${r.perPageMs} | ${r.peakRssMb} |`
        : `| ${r.file} | ${r.concurrency} | rejected: ${r.error} | | | | | | | | ${r.peakRssMb} |`,
    );
  }
  const heic = join(dir, 'photo-12mp.heic');
  if (existsSync(heic))
    say(`\nsharp (prebuilt libvips) decodes HEIC: ${await sharpDecodesHeic(heic)}`);
}
