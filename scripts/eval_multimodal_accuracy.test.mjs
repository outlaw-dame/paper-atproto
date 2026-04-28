import { describe, expect, it, vi } from 'vitest';

import {
  evaluateExample,
  probeInlineModelBackend,
  usesInlineFixtures,
} from './eval_multimodal_accuracy.mjs';

describe('eval multimodal accuracy helpers', () => {
  it('treats fallback-shaped responses as non-passing structural outputs', () => {
    const evaluation = evaluateExample(
      {
        id: 'fallback-case',
        expected: {
          entities: ['chart'],
          mediaType: 'chart',
          moderationAction: 'none',
          summaryMustContainAny: ['chart'],
          summaryMustNotContainAny: ['meme'],
        },
      },
      {
        mediaType: 'chart',
        mediaSummary: 'Media present — analysis unavailable.',
        candidateEntities: [],
        confidence: 0.15,
        cautionFlags: [],
        moderation: {
          action: 'none',
        },
      },
    );

    expect(evaluation.fallbackDetected).toBe(true);
    expect(evaluation.mediaTypePass).toBe(false);
    expect(evaluation.moderationActionPass).toBe(false);
    expect(evaluation.summaryMustContainPass).toBe(false);
    expect(evaluation.summaryMustNotContainPass).toBe(false);
  });

  it('checks moderation action accuracy on non-fallback outputs', () => {
    const evaluation = evaluateExample(
      {
        id: 'moderation-safe-case',
        expected: {
          entities: [],
          mediaType: 'photo',
          moderationAction: 'none',
          summaryMustContainAny: ['skyline'],
          summaryMustNotContainAny: ['chart'],
        },
      },
      {
        mediaType: 'photo',
        mediaSummary: 'A skyline photo with lit buildings.',
        candidateEntities: [],
        confidence: 0.83,
        cautionFlags: [],
        moderation: {
          action: 'none',
        },
      },
    );

    expect(evaluation.fallbackDetected).toBe(false);
    expect(evaluation.moderationActionPass).toBe(true);
  });

  it('detects inline fixture datasets', () => {
    expect(usesInlineFixtures([
      { request: { inlineImagePath: 'scripts/multimodal-fixtures/example.png' } },
      { request: { mediaUrl: 'https://example.com/image.png' } },
    ])).toBe(true);
    expect(usesInlineFixtures([
      { request: { mediaUrl: 'https://example.com/image.png' } },
    ])).toBe(false);
  });

  it('reports inline backend probe failures as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));

    await expect(probeInlineModelBackend('http://localhost:11434')).resolves.toEqual({
      baseUrl: 'http://localhost:11434',
      reachable: false,
      error: 'fetch failed',
    });

    vi.unstubAllGlobals();
  });
});
