import type { TranslationMode, TranslationVisibility } from './types.js';

export function resolveDynamicTranslationMode(input: {
  requestedMode: TranslationMode;
  visibility: TranslationVisibility;
  sourceText: string;
}): TranslationMode {
  if (input.requestedMode === 'local_private') return 'local_private';

  const textLength = input.sourceText.trim().length;

  if (input.visibility === 'writer_input' || input.visibility === 'story_synopsis') {
    return 'server_optimized';
  }

  if (input.visibility === 'entity_snippet') {
    return textLength > 280 ? 'server_optimized' : 'server_default';
  }

  if (input.visibility === 'thread_reply') {
    return textLength > 220 ? 'server_optimized' : 'server_default';
  }

  return textLength > 300 ? 'server_optimized' : 'server_default';
}
