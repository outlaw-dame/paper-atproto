import { describe, expect, it } from 'vitest';
import type { MediaObservationEnvelope, MediaObservationQuality } from './mediaObservationContract';
import {
  projectMediaObservationQuality,
  projectMediaObservations,
} from './mediaObservationProjection';

function envelope(overrides: Partial<MediaObservationEnvelope> = {}): MediaObservationEnvelope {
  return {
    schemaVersion: 1,
    mediaId: 'at://did:example:alice/app.bsky.embed.images/123',
    mediaKind: 'image',
    observationKind: 'literal_scene',
    literalObservations: ['A visible object appears in the image.'],
    extractedText: [],
    inferredContext: [],
    uncertaintyFlags: [],
    confidence: 0.92,
    requiresFallback: false,
    reasonCodes: ['media_observation_high_confidence'],
    ...overrides,
  };
}

function quality(overrides: Partial<MediaObservationQuality> = {}): MediaObservationQuality {
  return {
    schemaVersion: 1,
    mode: 'normal',
    confidence: 0.92,
    requiresFallback: false,
    primaryReasonCodes: ['media_observation_high_confidence'],
    uncertaintyFlags: [],
    ...overrides,
  };
}

describe('media observation projection', () => {
  it('projects high-confidence media observations as info severity', () => {
    const projection = projectMediaObservationQuality(quality(), 1);

    expect(projection).toMatchObject({
      schemaVersion: 1,
      sourceSchemaVersion: 1,
      mode: 'normal',
      severity: 'info',
      confidence: 0.92,
      summary: 'Media context is sufficiently supported for normal presentation.',
      evidence: {
        mediaCount: 1,
        uncertaintyFlags: [],
        primaryReasonCodes: ['media_observation_high_confidence'],
      },
    });
    expect(projection.factors).toEqual([
      {
        factorId: 'media.confidence',
        severity: 'info',
        reasonCode: 'media_observation_high_confidence',
        message: 'Media confidence is 0.92.',
      },
    ]);
  });

  it('projects descriptive fallback observations as caution with uncertainty factors', () => {
    const projection = projectMediaObservationQuality(
      quality({
        mode: 'descriptive_fallback',
        confidence: 0.62,
        requiresFallback: true,
        primaryReasonCodes: ['media_observation_high_confidence', 'ocr_low_confidence'],
        uncertaintyFlags: ['ocr_low_confidence'],
      }),
      2,
    );

    expect(projection.severity).toBe('caution');
    expect(projection.summary).toBe('Media context is partial or uncertain; describe visible evidence before making interpretations.');
    expect(projection.evidence).toEqual({
      mediaCount: 2,
      uncertaintyFlags: ['ocr_low_confidence'],
      primaryReasonCodes: ['media_observation_high_confidence', 'ocr_low_confidence'],
    });
    expect(projection.factors.map((factor) => factor.factorId)).toEqual([
      'media.confidence',
      'media.fallback_mode',
      'media.uncertainty_flags',
      'media.reason_codes',
    ]);
    expect(projection.factors.find((factor) => factor.factorId === 'media.uncertainty_flags')).toMatchObject({
      reasonCode: 'ocr_low_confidence',
      severity: 'caution',
    });
  });

  it('projects missing or minimal media context as high uncertainty', () => {
    const projection = projectMediaObservations([]);

    expect(projection).toMatchObject({
      mode: 'minimal_fallback',
      severity: 'high_uncertainty',
      confidence: 0,
      summary: 'Media context is insufficient; use only minimal, non-interpretive language.',
      evidence: {
        mediaCount: 0,
        uncertaintyFlags: ['media_not_loaded'],
        primaryReasonCodes: ['media_observation_insufficient'],
      },
    });
  });

  it('summarizes concrete envelopes without leaking raw observation text into evidence', () => {
    const projection = projectMediaObservations([
      envelope({
        literalObservations: ['Sensitive visible text that should not be copied to evidence.'],
        extractedText: ['Raw OCR should stay outside projection evidence.'],
        inferredContext: ['Raw inferred context should stay outside projection evidence.'],
      }),
    ]);

    expect(JSON.stringify(projection.evidence)).not.toContain('Sensitive visible text');
    expect(JSON.stringify(projection.evidence)).not.toContain('Raw OCR');
    expect(JSON.stringify(projection.evidence)).not.toContain('Raw inferred context');
    expect(projection.evidence).toEqual({
      mediaCount: 1,
      uncertaintyFlags: [],
      primaryReasonCodes: ['media_observation_high_confidence'],
    });
  });

  it('sanitizes invalid media counts and non-finite confidence conservatively', () => {
    const projection = projectMediaObservationQuality(
      quality({
        confidence: Number.NaN,
        mode: 'normal',
        requiresFallback: false,
        primaryReasonCodes: [],
      }),
      Number.NaN,
    );

    expect(projection.confidence).toBe(0);
    expect(projection.severity).toBe('high_uncertainty');
    expect(projection.summary).toBe('Media context is insufficient; use only minimal, non-interpretive language.');
    expect(projection.evidence.mediaCount).toBe(0);
    expect(projection.factors[0]).toEqual({
      factorId: 'media.confidence',
      severity: 'high_uncertainty',
      reasonCode: 'media_observation_partial',
      message: 'Media confidence is 0.00.',
    });
  });
});
