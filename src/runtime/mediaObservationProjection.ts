import type {
  MediaInterpretationMode,
  MediaObservationEnvelope,
  MediaObservationQuality,
  MediaReasonCode,
  MediaUncertaintyFlag,
} from './mediaObservationContract';
import {
  MEDIA_OBSERVATION_SCHEMA_VERSION,
  summarizeMediaObservationQuality,
} from './mediaObservationContract';

export const MEDIA_OBSERVATION_PROJECTION_SCHEMA_VERSION = 1 as const;

export type MediaObservationProjectionSeverity = 'info' | 'caution' | 'high_uncertainty';

export type MediaObservationProjectionFactorId =
  | 'media.confidence'
  | 'media.fallback_mode'
  | 'media.uncertainty_flags'
  | 'media.reason_codes';

export interface MediaObservationProjectionFactor {
  factorId: MediaObservationProjectionFactorId;
  severity: MediaObservationProjectionSeverity;
  reasonCode: MediaReasonCode;
  message: string;
}

export interface MediaObservationExplanationProjection {
  schemaVersion: typeof MEDIA_OBSERVATION_PROJECTION_SCHEMA_VERSION;
  sourceSchemaVersion: typeof MEDIA_OBSERVATION_SCHEMA_VERSION;
  mode: MediaInterpretationMode;
  severity: MediaObservationProjectionSeverity;
  confidence: number;
  summary: string;
  factors: MediaObservationProjectionFactor[];
  evidence: {
    mediaCount: number;
    uncertaintyFlags: MediaUncertaintyFlag[];
    primaryReasonCodes: MediaReasonCode[];
  };
}

export function projectMediaObservationQuality(
  quality: MediaObservationQuality,
  mediaCount: number,
): MediaObservationExplanationProjection {
  const safeMediaCount = sanitizeMediaCount(mediaCount);
  const severity = selectProjectionSeverity(quality);
  const factors = buildProjectionFactors(quality);

  return {
    schemaVersion: MEDIA_OBSERVATION_PROJECTION_SCHEMA_VERSION,
    sourceSchemaVersion: quality.schemaVersion,
    mode: quality.mode,
    severity,
    confidence: quality.confidence,
    summary: summarizeProjection(quality, safeMediaCount),
    factors,
    evidence: {
      mediaCount: safeMediaCount,
      uncertaintyFlags: quality.uncertaintyFlags,
      primaryReasonCodes: quality.primaryReasonCodes,
    },
  };
}

export function projectMediaObservations(
  envelopes: readonly MediaObservationEnvelope[],
): MediaObservationExplanationProjection {
  return projectMediaObservationQuality(
    summarizeMediaObservationQuality(envelopes),
    envelopes.length,
  );
}

function sanitizeMediaCount(mediaCount: number): number {
  if (!Number.isFinite(mediaCount)) return 0;
  return Math.max(0, Math.floor(mediaCount));
}

function selectProjectionSeverity(quality: MediaObservationQuality): MediaObservationProjectionSeverity {
  if (quality.mode === 'minimal_fallback' || quality.confidence < 0.35) return 'high_uncertainty';
  if (quality.mode === 'descriptive_fallback' || quality.requiresFallback || quality.confidence < 0.7) return 'caution';
  return 'info';
}

function summarizeProjection(quality: MediaObservationQuality, mediaCount: number): string {
  if (mediaCount === 0 || quality.mode === 'minimal_fallback') {
    return 'Media context is insufficient; use only minimal, non-interpretive language.';
  }
  if (quality.mode === 'descriptive_fallback') {
    return 'Media context is partial or uncertain; describe visible evidence before making interpretations.';
  }
  return 'Media context is sufficiently supported for normal presentation.';
}

function buildProjectionFactors(quality: MediaObservationQuality): MediaObservationProjectionFactor[] {
  const factors: MediaObservationProjectionFactor[] = [];
  const severity = selectProjectionSeverity(quality);
  const primaryReasonCode = quality.primaryReasonCodes[0] ?? 'media_observation_partial';

  factors.push({
    factorId: 'media.confidence',
    severity,
    reasonCode: primaryReasonCode,
    message: `Media confidence is ${formatConfidence(quality.confidence)}.`,
  });

  if (quality.mode !== 'normal' || quality.requiresFallback) {
    factors.push({
      factorId: 'media.fallback_mode',
      severity,
      reasonCode: primaryReasonCode,
      message: `Media interpretation mode is ${quality.mode}.`,
    });
  }

  if (quality.uncertaintyFlags.length > 0) {
    factors.push({
      factorId: 'media.uncertainty_flags',
      severity,
      reasonCode: firstReasonCodeForUncertainty(quality) ?? primaryReasonCode,
      message: `Uncertainty flags: ${quality.uncertaintyFlags.join(', ')}.`,
    });
  }

  if (quality.primaryReasonCodes.length > 1) {
    factors.push({
      factorId: 'media.reason_codes',
      severity,
      reasonCode: primaryReasonCode,
      message: `Primary media reason codes: ${quality.primaryReasonCodes.join(', ')}.`,
    });
  }

  return factors;
}

function firstReasonCodeForUncertainty(quality: MediaObservationQuality): MediaReasonCode | null {
  return quality.primaryReasonCodes.find((code) => code !== 'media_observation_high_confidence') ?? null;
}

function formatConfidence(confidence: number): string {
  if (!Number.isFinite(confidence)) return '0.00';
  return Math.max(0, Math.min(1, confidence)).toFixed(2);
}
