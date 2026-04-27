import { z } from 'zod';
import {
  mediaObservationEnvelopeSchema,
  summarizeMediaObservationQuality,
  type MediaObservationEnvelope,
  type MediaObservationQuality,
  type MediaReasonCode,
  type MediaUncertaintyFlag,
} from './mediaObservationContract';

export const MEDIA_OBSERVATION_BOUNDARY_ERROR = 'media_observation_boundary_error' as const;

export type MediaObservationBoundaryErrorCode =
  | 'invalid_media_observation_payload'
  | 'invalid_media_observation_list'
  | 'media_observation_list_too_large';

export interface MediaObservationBoundaryError {
  code: MediaObservationBoundaryErrorCode;
  reasonCode: MediaReasonCode;
  uncertaintyFlag: MediaUncertaintyFlag;
  message: string;
}

export type MediaObservationBoundaryResult =
  | {
      ok: true;
      observations: MediaObservationEnvelope[];
      quality: MediaObservationQuality;
    }
  | {
      ok: false;
      observations: [];
      quality: MediaObservationQuality;
      error: MediaObservationBoundaryError;
    };

const mediaObservationListSchema = z.array(mediaObservationEnvelopeSchema).max(32);

export function parseMediaObservationBoundary(value: unknown): MediaObservationBoundaryResult {
  const parsed = mediaObservationListSchema.safeParse(value);

  if (!parsed.success) {
    return mediaObservationBoundaryFailure(boundaryErrorFromZod(parsed.error));
  }

  return {
    ok: true,
    observations: parsed.data,
    quality: summarizeMediaObservationQuality(parsed.data),
  };
}

function mediaObservationBoundaryFailure(error: MediaObservationBoundaryError): MediaObservationBoundaryResult {
  return {
    ok: false,
    observations: [],
    quality: {
      schemaVersion: 1,
      mode: 'minimal_fallback',
      confidence: 0,
      requiresFallback: true,
      primaryReasonCodes: [error.reasonCode],
      uncertaintyFlags: [error.uncertaintyFlag],
    },
    error,
  };
}

function boundaryErrorFromZod(error: z.ZodError): MediaObservationBoundaryError {
  const tooBigArrayIssue = error.issues.find(
    (issue) => issue.code === 'too_big' && issue.path.length === 0,
  );

  if (tooBigArrayIssue) {
    return {
      code: 'media_observation_list_too_large',
      reasonCode: 'media_observation_insufficient',
      uncertaintyFlag: 'media_not_loaded',
      message: 'Media observation list exceeds the supported boundary size.',
    };
  }

  const invalidRoot = error.issues.find((issue) => issue.path.length === 0);

  if (invalidRoot) {
    return {
      code: 'invalid_media_observation_list',
      reasonCode: 'media_observation_insufficient',
      uncertaintyFlag: 'media_not_loaded',
      message: 'Media observations must be provided as a bounded array.',
    };
  }

  return {
    code: 'invalid_media_observation_payload',
    reasonCode: 'media_observation_insufficient',
    uncertaintyFlag: 'media_not_loaded',
    message: 'One or more media observations failed validation.',
  };
}
