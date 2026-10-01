import { describe, expect, it } from 'vitest';
import { checkFile, jpegName, scaledSize, scheduleFileType } from './upload-file';

describe('scheduleFileType', () => {
  it('uses the declared type, else the extension (HEIC often has no type)', () => {
    expect(scheduleFileType({ name: 'a.pdf', type: 'application/pdf' })).toBe('application/pdf');
    expect(scheduleFileType({ name: 'IMG_1234.HEIC', type: '' })).toBe('image/heic');
    expect(scheduleFileType({ name: 'shot.jpeg', type: '' })).toBe('image/jpeg');
    expect(scheduleFileType({ name: 'notes.txt', type: 'text/plain' })).toBeNull();
    expect(scheduleFileType({ name: 'page.html', type: '' })).toBeNull();
  });
});

describe('checkFile (FR-IMP-1)', () => {
  it('accepts schedule types up to 10 MB', () => {
    expect(checkFile({ name: 'a.pdf', size: 1024, type: 'application/pdf' })).toBeUndefined();
    expect(checkFile({ name: 'a.png', size: 10 * 1024 * 1024, type: 'image/png' })).toBeUndefined();
    expect(checkFile({ name: 'a.png', size: 10 * 1024 * 1024 + 1, type: 'image/png' })).toMatch(
      /over 10 MB/,
    );
    expect(checkFile({ name: 'a.gif', size: 10, type: 'image/gif' })).toMatch(/won’t work/);
    expect(checkFile({ name: 'a.png', size: 0, type: 'image/png' })).toMatch(/empty/);
  });
});

describe('scaledSize (NFR-PERF-6)', () => {
  it('shrinks a 4000 px photo to 2000 px on the long edge and never enlarges', () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(scaledSize(3024, 4032)).toEqual({ width: 1500, height: 2000 });
    expect(scaledSize(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(scaledSize(100_000, 10)).toEqual({ width: 2000, height: 1 });
  });
});

describe('jpegName', () => {
  it('swaps the extension', () => {
    expect(jpegName('IMG_1234.HEIC')).toBe('IMG_1234.jpg');
    expect(jpegName('Screenshot 2026-09-30.png')).toBe('Screenshot 2026-09-30.jpg');
    expect(jpegName('.png')).toBe('schedule.jpg');
  });
});
