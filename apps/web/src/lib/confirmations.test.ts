import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONFIRM } from './confirmations';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(path);
    return e.name.endsWith('.tsx') ? [path] : [];
  });
}

/** The actions WF-135 found running on one tap. */
const HARD_TO_UNDO = ['removeFriend', 'blockFriend', 'transferAdmin', 'leaveGroup', 'deleteGroup'];

describe('hard-to-undo actions ask first (WF-135)', () => {
  const files = tsxFiles(SRC).map((path) => ({
    path: relative(SRC, path),
    text: readFileSync(path, 'utf8'),
  }));
  const calls = (tag: string, name: string) =>
    files.filter((f) =>
      [...f.text.matchAll(new RegExp(`<${tag}\\b([\\s\\S]*?)</${tag}>`, 'g'))].some(([block]) =>
        block.includes(`action={() => ${name}(`),
      ),
    );

  it.each(HARD_TO_UNDO)('%s never runs straight from a button', (name) => {
    expect(calls('ActionButton', name).map((f) => f.path)).toEqual([]);
    expect(calls('ConfirmActionButton', name).length).toBeGreaterThan(0);
  });

  it('says what happens and who it affects', () => {
    expect(CONFIRM.removeFriend('Alice Brown')).toMatchObject({
      title: 'Remove Alice?',
      keep: 'Keep Alice',
      confirm: 'Remove',
    });
    expect(CONFIRM.block('Alice Brown').description).toMatch(/aren’t told/);
    expect(CONFIRM.makeAdmin('Ben').description).toMatch(/Only Ben can make you the admin again/);
    expect(CONFIRM.leaveGroup('Flat 4').title).toBe('Leave Flat 4?');
    expect(CONFIRM.deleteGroup('Flat 4')).toMatchObject({
      title: 'Delete Flat 4?',
      keep: 'Keep Flat 4',
    });
    expect(CONFIRM.deleteGroup('Flat 4').description).toMatch(/every member.*can’t be undone/);
  });
});
