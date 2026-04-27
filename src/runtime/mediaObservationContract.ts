import { z } from 'zod';

export const MEDIA_OBSERVATION_SCHEMA_VERSION = 1 as const;

export const mediaKindSchema = z.enum([
  'image',
  'video',
  'gif',
  'screenshot',
  'chart',
  'document',
  'unknown',
]);

export const mediaObservationKindSchema = z.enum([
  'literal_scene',
  'ocr',
  'meme_context',
  'chart_parse',
  'document_parse',
  'video_keyframes',
  'caption_consistency',
  'claim_support',
]);

export const mediaUncertaintyFlagSchema = z.enum([
  'media_not_loaded',
  'media_too_small',
  'media_too_blurry',
  'ocr_low_confidence',
  'visual_entity_uncertain',
  'chart_axes_uncertain',
  'video_sample_insufficient',
  'caption_mismatch_detected',
  'meme_context_uncertain',
  'model_disagreement',
  'claim_support_uncertain',
  'unsupported_media_type',
]);

export const mediaReasonCodeSchema = z.enum([
  'media_observation_high_confidence',
  'media_observation_partial',
  'media_observation_insufficient',
  'media_not_loaded',
  'ocr_low_confidence',
  'visual_entity_uncertain',
  'chart_axes_uncertain',
  'video_sample_insufficient',
  'caption_mismatch_detected',
  'meme_context_uncertain',
  'model_disagreement',
  'claim_support_uncertain',
  'unsupported_media_type',
]);

export const mediaInterpretationModeSchema = z.enum([
  'normal',
  'descriptive_fallback',
  'minimal_fallback',
]);

const boundedObservationStringSchema = z.string().trim().min(1).max(240);
const mediaIdSchema = z.string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9._:@/-]+$/)
  .refine((value) => !value.includes('..'), 'mediaId must not contain parent-directory segments');

export const mediaObservationEnvelopeSchema = z.object({
  schemaVersion: z.literal(MEDIA_OBSERVATION_SCHEMA_VERSION),
  mediaId: mediaIdSchema,
  mediaKind: mediaKindSchema,
  observationKind: mediaObservationKindSchema,
  literalObservations: z.array(boundedObservationStringSchema).max(24),
  extractedText: z.array(boundedObservationStringSchema).max(24),
  inferredContext: z.array(boundedObservationStringSchema).max(12),
  uncertaintyFlags: z.array(mediaUncertaintyFlagSchema).max(12),
  confidence: z.number().min(0).max(1),
  requiresFallback: z.boolean(),
  reasonCodes: z.array(mediaReasonCodeSchema).min(1).max(8),
}).strict();

export type MediaKind = z.infer<typeof mediaKindSchema>;
export type MediaObservationKind = z.infer<typeof mediaObservationKindSchema>;
export type MediaUncertaintyFlag = z.infer<typeof mediaUncertaintyFlagSchema>;
export type MediaReasonCode = z.infer<typeof mediaReasonCodeSchema>;
export type MediaInterpretationMode = z.infer<typeof mediaInterpretationModeSchema>;
export type MediaObservationEnvelope = z.infer<typeof mediaObservationEnvelopeSchema>;

export interface MediaObservationQuality {
  schemaVersion: 1;
  mode: MediaInterpretationMode;
  confidence: number;
  requiresFallback: boolean;
  primaryReasonCodes: MediaReasonCode[];
  uncertaintyFlags: MediaUncertaintyFlag[];
}

const MINIMAL_FALLBACK_FLAGS = new Set<MediaUncertaintyFlag>([
  'media_not_loaded',
  'unsupported_media_type',
  'video_sample_insufficient',
]);

const DESCRIPTIVE_FALLBACK_FLAGS = new Set<MediaUncertaintyFlag>([
  'ocr_low_confidence',
  'visual_entity_uncertain',
  'chart_axes_uncertain',
  'caption_mismatch_detected',
  'meme_context_uncertain',
  'model_disagreement',
  'claim_support_uncertain',
  'media_too_small',
  'media_too_blurry',
]);

export function parseMediaObservationEnvelope(value: unknown): MediaObservationEnvelope {
  return mediaObservationEnvelopeSchema.parse(value);
}

export function clampMediaConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function selectMediaInterpretationMode(envelope: MediaObservationEnvelope): MediaInterpretationMode {
  if (envelope.uncertaintyFlags.some((flag) => MINIMAL_FALLBACK_FLAGS.has(flag))) {
    return 'minimal_fallback';
  }
  if (envelope.requiresFallback && envelope.confidence < 0.35) {
    return 'minimal_fallback';
  }
  if (envelope.requiresFallback || envelope.confidence < 0.7) {
    return 'descriptive_fallback';
  }
  if (envelope.uncertaintyFlags.some((flag) => DESCRIPTIVE_FALLBACK_FLAGS.has(flag))) {
    return 'descriptive_fallback';
  }
  return 'normal';
}

export function summarizeMediaObservationQuality(envelopes: readonly MediaObservationEnvelope[]): MediaObservationQuality {
  if (envelopes.length === 0) {
    return {
      schemaVersion: MEDIA_OBSERVATION_SCHEMA_VERSION,
      mode: 'minimal_fallback',
      confidence: 0,
      requiresFallback: true,
      primaryReasonCodes: ['media_observation_insufficient'],
      uncertaintyFlags: ['media_not_loaded'],
    };
  }

  const parsed = envelopes.map((envelope) => parseMediaObservationEnvelope(envelope));
  const confidence = Math.min(...parsed.map((envelope) => clampMediaConfidence(envelope.confidence)));
  const requiresFallback = parsed.some((envelope) => envelope.requiresFallback);
  const uncertaintyFlags = unique(parsed.flatMap((envelope) => envelope.uncertaintyFlags));
  const primaryReasonCodes = unique(parsed.flatMap((envelope) => envelope.reasonCodes)).slice(0, 8);
  const modes = parsed.map(selectMediaInterpretationMode);
  const mode = modes.includes('minimal_fallback')
    ? 'minimal_fallback'
    : modes.includes('descriptive_fallback')
      ? 'descriptive_fallback'
      : 'normal';

  return {
    schemaVersion: MEDIA_OBSERVATION_SCHEMA_VERSION,
    mode,
    confidence,
    requiresFallback: requiresFallback || mode !== 'normal',
    primaryReasonCodes: primaryReasonCodes.length > 0 ? primaryReasonCodes : ['media_observation_partial'],
    uncertaintyFlags,
  };
}

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}
