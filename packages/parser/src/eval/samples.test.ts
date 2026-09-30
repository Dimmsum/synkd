import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverSamples, ExpectedDraft, loadExpected } from './samples';

const EXAMPLE_DIR = fileURLToPath(new URL('../../eval/example/', import.meta.url));

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wf-samples-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const touch = async (rel: string, content = '') => {
  await mkdir(join(dir, rel, '..'), { recursive: true });
  await writeFile(join(dir, rel), content);
};

describe('discoverSamples', () => {
  it('pairs files with expected files, groups by first folder, and sorts by id', async () => {
    await touch('uni/uwi-01.png');
    await touch('uni/uwi-01.expected.json');
    await touch('roster/shop-01.PDF');
    await touch('roster/shop-01.expected.json');
    await touch('photo.jpeg');
    await touch('photo.expected.json');
    await touch('README.md');
    await touch('.DS_Store');
    const { samples, problems } = await discoverSamples(dir);
    expect(problems).toEqual([]);
    expect(samples.map((s) => [s.id, s.group, s.ext])).toEqual([
      ['photo', null, 'jpeg'],
      ['roster/shop-01', 'roster', 'pdf'],
      ['uni/uwi-01', 'uni', 'png'],
    ]);
  });

  it('reports schedules without expected files, and expected files without schedules', async () => {
    await touch('a.png');
    await touch('b.expected.json');
    const { samples, problems } = await discoverSamples(dir);
    expect(samples).toEqual([]);
    expect(problems).toEqual([
      'a: no .expected.json file next to it',
      'b.expected.json: no schedule file with the same name',
    ]);
  });

  it('reports two schedules sharing one expected file', async () => {
    await touch('a.png');
    await touch('a.jpg');
    await touch('a.expected.json');
    const { samples, problems } = await discoverSamples(dir);
    expect(samples).toHaveLength(1);
    expect(problems).toHaveLength(1);
  });

  it('finds the committed synthetic example', async () => {
    const { samples, problems } = await discoverSamples(EXAMPLE_DIR);
    expect(problems).toEqual([]);
    expect(samples.map((s) => s.id)).toEqual(['synthetic-week']);
  });
});

describe('expected files', () => {
  it('validates the committed example against ParseDraft', async () => {
    const draft = await loadExpected(join(EXAMPLE_DIR, 'synthetic-week.expected.json'));
    expect(draft.events).toHaveLength(4);
    expect(draft.events.every((e) => e.confidence === 1)).toBe(true);
    expect(draft.suggestedPeriod?.exceptions).toHaveLength(1);
  });

  it('defaults confidence to 1 but keeps a given one', () => {
    const base = {
      title: 'X',
      category: 'class',
      start: '09:00',
      end: '10:00',
      when: { kind: 'date', date: '2026-10-01' },
    };
    const draft = ExpectedDraft.parse({ events: [base, { ...base, confidence: 0.4 }] });
    expect(draft.events.map((e) => e.confidence)).toEqual([1, 0.4]);
  });

  it('strips location fields and notes (D35)', () => {
    const draft = ExpectedDraft.parse({
      notes: 'photo of a printed sheet',
      events: [
        {
          title: 'X',
          category: 'class',
          start: '09:00',
          end: '10:00',
          when: { kind: 'date', date: '2026-10-01' },
          location: 'Room 5',
        },
      ],
    });
    expect(JSON.stringify(draft)).not.toMatch(/location|Room 5|notes/);
  });

  it('names the file and the problems, but not the contents, when invalid', async () => {
    await touch(
      'bad.expected.json',
      JSON.stringify({ events: [{ title: 'Private Title', start: '25:00' }] }),
    );
    const err = await loadExpected(join(dir, 'bad.expected.json')).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('bad.expected.json');
    expect((err as Error).message).toContain('events.0.start');
    expect((err as Error).message).not.toContain('Private Title');
  });

  it("doesn't quote the file when the JSON itself is broken", async () => {
    await touch('broken.expected.json', '{"events": [ Private Title ]}');
    const err = await loadExpected(join(dir, 'broken.expected.json')).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/not valid JSON$/);
  });
});
