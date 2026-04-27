import { describe, expect, it } from 'vitest';
import { adaptMediaObservations, hasUsableMediaObservations } from './mediaObservationAdapter';
import type { MediaObservationEnvelope } from './mediaObservationContract';

function envelope(overrides: Partial<MediaObservationEnvelope> = {}): MediaObservationEnvelope {
  return {
    schemaVersion: 1,
    mediaId: 'at://did:example:alice/app.bsky.embed.images/123',
    mediaKind: 'image',
    observationKind: 'literal_scene',
    literalObservations: ['A high-confidence image observation.'],
    extractedText: [],
    inferredContext: [],
    uncertaintyFlags: [],
    confidence: 0.91,
    requiresFallback: false,
    reasonCodes: ['media_observation_high_confidence'],
    ...overrides,
  };
}

describe('media observation adapter', () => {
  it('normalizes nullish and empty input into minimal fallback quality', () => {
    expect(adaptMediaObservations(null)).toEqual({
      schemaVersion: 1,
      observations: [],
      quality: {
        schemaVersion: 1,
        mode: 'minimal_fallback',
        confidence: 0,
        requiresFallback: true,
        primaryReasonCodes: ['media_observation_insufficient'],
        uncertaintyFlags: ['media_not_loaded'],
      },
      dropped: [],
    });

    expect(adaptMediaObservations(undefined).observations).toEqual([]);
    expect(adaptMediaObservations([]).quality.mode).toBe('minimal_fallback');
  });

  it('accepts a single valid media observation object', () => {
    const input = envelope();
    const result = adaptMediaObservations(input);

    expect(result.observations).toEqual([input]);
    expect(result.quality.mode).toBe('normal');
    expect(result.quality.confidence).toBe(0.91);
    expect(result.dropped).toEqual([]);
    expect(hasUsableMediaObservations(result)).toBe(true);
  });

  it('accepts arrays and drops invalid candidates with safe issue summaries', () => {
    const valid = envelope({ mediaId: 'media-1' });
    const invalid = { ...envelope({ mediaId: '../escape' }) };
    const result = adaptMediaObservations([valid, invalid, 'random']);

    expect(result.observations).toEqual([valid]);
    expect(result.dropped).toHaveLength(2);
    expect(result.dropped[0]).toMatchObject({ index: 1, reason: 'invalid_schema' });
    expect(result.dropped[0].issues.join(' ')).toContain('mediaId');
    expect(result.dropped[1]).toMatchObject({ index: 2, reason: 'invalid_schema' });
    expect(result.dropped[1].issues.join(' ')).toContain('<root>');
  });

  it('summarizes valid observations using the most conservative quality mode', () => {
    const result = adaptMediaObservations([
      envelope({ mediaId: 'media-1', confidence: 0.94 }),
      envelope({
        mediaId: 'media-2',
        mediaKind: 'screenshot',
        observationKind: 'ocr',
        confidence: 0.54,
        requiresFallback: true,
        uncertaintyFlags: ['ocr_low_confidence'],
        reasonCodes: ['ocr_low_confidence'],
      }),
    ]);

    expect(result.quality).toEqual({
      schemaVersion: 1,
      mode: 'descriptive_fallback',
      confidence: 0.54,
      requiresFallback: true,
      primaryReasonCodes: ['media_observation_high_confidence', 'ocr_low_confidence'],
      uncertaintyFlags: ['ocr_low_confidence'],
    });
    expect(hasUsableMediaObservations(result)).toBe(true);
  });

  it('marks minimal fallback results as not usable for rich media interpretation', () => {
    const result = adaptMediaObservations(envelope({
      mediaKind: 'unknown',
      observationKind: 'literal_scene',
      uncertaintyFlags: ['unsupported_media_type'],
      confidence: 0.9,
      requiresFallback: true,
      reasonCodes: ['unsupported_media_type'],
    }));

    expect(result.quality.mode).toBe('minimal_fallback');
    expect(hasUsableMediaObservations(result)).toBe(false);
  });

  it('caps candidate processing and records overflow drops without validating unbounded input', () => {
    const candidates = Array.from({ length: 35 }, (_, index) => envelope({ mediaId: `media-${index}` }));
    const result = adaptMediaObservations(candidates);

    expect(result.observations).toHaveLength(32);
    expect(result.dropped).toEqual([
      { index: 32, reason: 'input_limit_exceeded', issues: ['Too many media observation candidates were supplied.'] },
      { index: 33, reason: 'input_limit_exceeded', issues: ['Too many media observation candidates were supplied.'] },
      { index: 34, reason: 'input_limit_exceeded', issues: ['Too many media observation candidates were supplied.'] },
    ]);
  });
});
