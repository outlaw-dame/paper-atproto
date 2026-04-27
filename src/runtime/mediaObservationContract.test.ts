import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  clampMediaConfidence,
  mediaObservationEnvelopeSchema,
  parseMediaObservationEnvelope,
  selectMediaInterpretationMode,
  summarizeMediaObservationQuality,
  type MediaObservationEnvelope,
} from './mediaObservationContract';

function envelope(overrides: Partial<MediaObservationEnvelope> = {}): MediaObservationEnvelope {
  return {
    schemaVersion: 1,
    mediaId: 'at://did:example:alice/app.bsky.embed.images/123',
    mediaKind: 'image',
    observationKind: 'literal_scene',
    literalObservations: ['A screenshot-like image is visible.'],
    extractedText: [],
    inferredContext: [],
    uncertaintyFlags: [],
    confidence: 0.92,
    requiresFallback: false,
    reasonCodes: ['media_observation_high_confidence'],
    ...overrides,
  };
}

describe('media observation contract', () => {
  it('accepts strict valid media observation envelopes', () => {
    const input = envelope();
    expect(parseMediaObservationEnvelope(input)).toEqual(input);
  });

  it('rejects random strings, extra fields, invalid reason codes, and invalid confidence', () => {
    expect(() => parseMediaObservationEnvelope('random')).toThrow(z.ZodError);
    expect(() => parseMediaObservationEnvelope({ ...envelope(), extra: 'not-allowed' })).toThrow(z.ZodError);
    expect(() => parseMediaObservationEnvelope({ ...envelope(), reasonCodes: ['random_string'] })).toThrow(z.ZodError);
    expect(() => parseMediaObservationEnvelope({ ...envelope(), uncertaintyFlags: ['random_flag'] })).toThrow(z.ZodError);
    expect(() => parseMediaObservationEnvelope({ ...envelope(), confidence: 1.1 })).toThrow(z.ZodError);
    expect(() => parseMediaObservationEnvelope({ ...envelope(), confidence: -0.1 })).toThrow(z.ZodError);
  });

  it('bounds observation strings and media identifiers', () => {
    expect(() => parseMediaObservationEnvelope(envelope({ mediaId: '../escape' }))).toThrow(z.ZodError);
    expect(() => parseMediaObservationEnvelope(envelope({ literalObservations: ['x'.repeat(241)] }))).toThrow(z.ZodError);
    expect(() => parseMediaObservationEnvelope(envelope({ extractedText: Array.from({ length: 25 }, (_, index) => `text ${index}`) }))).toThrow(z.ZodError);
  });

  it('clamps non-finite and out-of-range confidence values for derived summaries', () => {
    expect(clampMediaConfidence(Number.NaN)).toBe(0);
    expect(clampMediaConfidence(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampMediaConfidence(-1)).toBe(0);
    expect(clampMediaConfidence(2)).toBe(1);
    expect(clampMediaConfidence(0.42)).toBe(0.42);
  });

  it('selects normal mode only for high-confidence observations without uncertainty', () => {
    expect(selectMediaInterpretationMode(envelope({ confidence: 0.9, requiresFallback: false, uncertaintyFlags: [] }))).toBe('normal');
  });

  it('selects descriptive fallback for uncertain OCR, chart, meme, model-disagreement, or claim-support cases', () => {
    expect(selectMediaInterpretationMode(envelope({ observationKind: 'ocr', uncertaintyFlags: ['ocr_low_confidence'], confidence: 0.8 }))).toBe('descriptive_fallback');
    expect(selectMediaInterpretationMode(envelope({ mediaKind: 'chart', observationKind: 'chart_parse', uncertaintyFlags: ['chart_axes_uncertain'], confidence: 0.8 }))).toBe('descriptive_fallback');
    expect(selectMediaInterpretationMode(envelope({ observationKind: 'meme_context', uncertaintyFlags: ['meme_context_uncertain'], confidence: 0.8 }))).toBe('descriptive_fallback');
    expect(selectMediaInterpretationMode(envelope({ uncertaintyFlags: ['model_disagreement'], confidence: 0.8 }))).toBe('descriptive_fallback');
    expect(selectMediaInterpretationMode(envelope({ observationKind: 'claim_support', uncertaintyFlags: ['claim_support_uncertain'], confidence: 0.8 }))).toBe('descriptive_fallback');
  });

  it('selects minimal fallback for missing, unsupported, or insufficiently sampled media', () => {
    expect(selectMediaInterpretationMode(envelope({ uncertaintyFlags: ['media_not_loaded'], confidence: 0.9 }))).toBe('minimal_fallback');
    expect(selectMediaInterpretationMode(envelope({ uncertaintyFlags: ['unsupported_media_type'], confidence: 0.9 }))).toBe('minimal_fallback');
    expect(selectMediaInterpretationMode(envelope({ mediaKind: 'video', observationKind: 'video_keyframes', uncertaintyFlags: ['video_sample_insufficient'], confidence: 0.9 }))).toBe('minimal_fallback');
  });

  it('downgrades required fallback with very low confidence to minimal fallback', () => {
    expect(selectMediaInterpretationMode(envelope({ confidence: 0.34, requiresFallback: true }))).toBe('minimal_fallback');
    expect(selectMediaInterpretationMode(envelope({ confidence: 0.5, requiresFallback: true }))).toBe('descriptive_fallback');
  });

  it('summarizes empty observation sets as insufficient media context', () => {
    expect(summarizeMediaObservationQuality([])).toEqual({
      schemaVersion: 1,
      mode: 'minimal_fallback',
      confidence: 0,
      requiresFallback: true,
      primaryReasonCodes: ['media_observation_insufficient'],
      uncertaintyFlags: ['media_not_loaded'],
    });
  });

  it('summarizes multiple observations by the most conservative mode and minimum confidence', () => {
    const summary = summarizeMediaObservationQuality([
      envelope({ confidence: 0.91, reasonCodes: ['media_observation_high_confidence'] }),
      envelope({
        mediaKind: 'screenshot',
        observationKind: 'ocr',
        confidence: 0.62,
        requiresFallback: true,
        uncertaintyFlags: ['ocr_low_confidence'],
        reasonCodes: ['ocr_low_confidence'],
      }),
    ]);

    expect(summary).toEqual({
      schemaVersion: 1,
      mode: 'descriptive_fallback',
      confidence: 0.62,
      requiresFallback: true,
      primaryReasonCodes: ['media_observation_high_confidence', 'ocr_low_confidence'],
      uncertaintyFlags: ['ocr_low_confidence'],
    });
  });
});
