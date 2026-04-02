import { describe, expect, it } from 'vitest';
import { resolveDynamicTranslationMode } from './policy.js';

describe('translation policy', () => {
  it('keeps local privacy mode unchanged', () => {
    expect(resolveDynamicTranslationMode({
      requestedMode: 'local_private',
      visibility: 'thread_reply',
      sourceText: 'hello',
    })).toBe('local_private');
  });

  it('prefers optimized mode for writer and story surfaces', () => {
    expect(resolveDynamicTranslationMode({
      requestedMode: 'server_default',
      visibility: 'writer_input',
      sourceText: 'short text',
    })).toBe('server_optimized');

    expect(resolveDynamicTranslationMode({
      requestedMode: 'server_default',
      visibility: 'story_synopsis',
      sourceText: 'short text',
    })).toBe('server_optimized');
  });

  it('switches to optimized for longer public text', () => {
    const longText = 'x'.repeat(400);
    expect(resolveDynamicTranslationMode({
      requestedMode: 'server_default',
      visibility: 'inline_post',
      sourceText: longText,
    })).toBe('server_optimized');
  });
});
