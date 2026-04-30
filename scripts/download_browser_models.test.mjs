import { describe, expect, it } from 'vitest';

import { parseArgs, resolveModels } from './download_browser_models.mjs';

function modelKeys(models) {
  return models.map((model) => model.key);
}

describe('download_browser_models profiles', () => {
  it('defaults to the minimal embeddings-only core profile', () => {
    const models = resolveModels(parseArgs([]));

    expect(modelKeys(models)).toEqual(['embeddings']);
  });

  it('keeps balanced staging free of large local generation and multimodal models', () => {
    const models = resolveModels(parseArgs(['--profile', 'balanced']));

    expect(modelKeys(models)).toEqual(['embeddings', 'tone', 'toxicity', 'sentiment']);
    expect(modelKeys(models)).not.toContain('smollm3_3b');
    expect(modelKeys(models)).not.toContain('qwen35_2b_mm');
  });

  it('requires explicit premium staging for large browser model experiments', () => {
    const models = resolveModels(parseArgs(['--profile', 'premium']));

    expect(modelKeys(models)).toEqual([
      'embeddings',
      'image_captioning',
      'tone',
      'toxicity',
      'sentiment',
      'smollm3_3b',
      'qwen35_2b_mm',
    ]);
  });
});
