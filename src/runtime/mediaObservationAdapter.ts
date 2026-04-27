import { z } from 'zod';
import {
  MEDIA_OBSERVATION_SCHEMA_VERSION,
  mediaObservationEnvelopeSchema,
  summarizeMediaObservationQuality,
  type MediaObservationEnvelope,
  type MediaObservationQuality,
} from './mediaObservationContract';

const MAX_ADAPTER_INPUT_ITEMS = 32;

export interface DroppedMediaObservation {
  index: number;
  reason: 'invalid_schema' | 'input_limit_exceeded';
  issues: string[];
}

export interface MediaObservationAdaptationResult {
  schemaVersion: typeof MEDIA_OBSERVATION_SCHEMA_VERSION;
  observations: MediaObservationEnvelope[];
  quality: MediaObservationQuality;
  dropped: DroppedMediaObservation[];
}

export function adaptMediaObservations(input: unknown): MediaObservationAdaptationResult {
  const candidates = Array.isArray(input) ? input : input == null ? [] : [input];
  const observations: MediaObservationEnvelope[] = [];
  const dropped: DroppedMediaObservation[] = [];

  candidates.slice(0, MAX_ADAPTER_INPUT_ITEMS).forEach((candidate, index) => {
    const parsed = mediaObservationEnvelopeSchema.safeParse(candidate);
    if (parsed.success) {
      observations.push(parsed.data);
      return;
    }

    dropped.push({
      index,
      reason: 'invalid_schema',
      issues: summarizeZodIssues(parsed.error),
    });
  });

  if (candidates.length > MAX_ADAPTER_INPUT_ITEMS) {
    for (let index = MAX_ADAPTER_INPUT_ITEMS; index < candidates.length; index += 1) {
      dropped.push({
        index,
        reason: 'input_limit_exceeded',
        issues: ['Too many media observation candidates were supplied.'],
      });
    }
  }

  return {
    schemaVersion: MEDIA_OBSERVATION_SCHEMA_VERSION,
    observations,
    quality: summarizeMediaObservationQuality(observations),
    dropped,
  };
}

export function hasUsableMediaObservations(result: MediaObservationAdaptationResult): boolean {
  return result.observations.length > 0 && result.quality.mode !== 'minimal_fallback';
}

function summarizeZodIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 8).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    return `${path}: ${issue.message}`;
  });
}
