import { PARSE_PROMPT_VERSION } from '@whosfree/shared';
import { describe, expect, it } from 'vitest';
import { matchesMagicBytes, modelMediaType } from './media';
import { loadPrompt, makePrompt, PRODUCTION_PROMPT } from './prompt';

describe('prompts', () => {
  it('loads v1 with a stable hash', async () => {
    const prompt = await loadPrompt('v1');
    expect(prompt.version).toBe('v1');
    expect(prompt.text).toContain('"events"');
    expect(prompt.sha256).toBe(makePrompt('v1', prompt.text).sha256);
    expect(prompt.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tells the model to leave out locations and personal details (D35)', async () => {
    const { text } = await loadPrompt('v1');
    expect(text).toMatch(/Never include where something happens/);
    expect(text).toMatch(/Never include personal details/);
  });

  it('embeds prompts/<PARSE_PROMPT_VERSION>.md unchanged as the production prompt', async () => {
    // If this fails after editing the Markdown, regenerate src/prompt-text.ts from it (each line
    // JSON-quoted, joined with "\n") and bump PARSER_VERSION.
    const file = await loadPrompt(PARSE_PROMPT_VERSION);
    expect(PRODUCTION_PROMPT).toEqual(file);
  });

  it('v2 covers the layouts and patterns of WF-028 and keeps D35', () => {
    const { text } = PRODUCTION_PROMPT;
    expect(text).toMatch(/days as columns and the times as rows, or the days as rows/);
    expect(text).toMatch(/Week A or week 1 is odd/);
    expect(text).toMatch(/"weeks", "weeks"/);
    expect(text).toMatch(/suggestedPeriod/);
    expect(text).toMatch(/confidence/);
    expect(text).toMatch(/Never include where something happens/);
    expect(text).toMatch(/Never include personal details/);
  });

  it('rejects versions that could escape the prompts folder', async () => {
    await expect(loadPrompt('../package')).rejects.toThrow(/Invalid prompt version/);
    await expect(loadPrompt('v1/../../x')).rejects.toThrow(/Invalid prompt version/);
  });

  it('fails for a version that has no file', async () => {
    await expect(loadPrompt('v999')).rejects.toThrow();
  });
});

describe('media', () => {
  it('maps extensions to model media types, with HEIC needing conversion', () => {
    expect(modelMediaType('jpg')).toBe('image/jpeg');
    expect(modelMediaType('pdf')).toBe('application/pdf');
    expect(modelMediaType('heic')).toBeNull();
  });

  it('checks magic bytes', () => {
    const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
    expect(matchesMagicBytes(webp, 'image/webp')).toBe(true);
    expect(matchesMagicBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg')).toBe(true);
    expect(matchesMagicBytes(new TextEncoder().encode('%PDF-1.7'), 'application/pdf')).toBe(true);
    expect(matchesMagicBytes(new TextEncoder().encode('%PDF-1.7'), 'image/png')).toBe(false);
    expect(matchesMagicBytes(new Uint8Array([]), 'image/jpeg')).toBe(false);
  });
});
