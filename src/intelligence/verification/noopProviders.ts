import type {
  ClaimExtractionResult,
  ClaimExtractorProvider,
  ExtractedClaim,
  FactCheckProvider,
  FactCheckResult,
  GroundingProvider,
  GroundingResult,
  MediaVerificationProvider,
  MediaVerificationResult,
  VerificationRequest,
} from './types';
import { checkabilityScore, inferClaimType } from './utils';

export class HeuristicClaimExtractorProvider implements ClaimExtractorProvider {
  async extractClaim(input: VerificationRequest): Promise<ClaimExtractionResult> {
    const claimType = inferClaimType(input.text);
    const claim: ExtractedClaim = {
      text: input.text,
      claimType,
      checkability: checkabilityScore(input.text, claimType),
      quotedTextSpans: [],
    };

    return {
      claims: [claim],
      model: 'heuristic',
      latencyMs: 0,
    };
  }
}

export class NoopFactCheckProvider implements FactCheckProvider {
  async lookup(): Promise<FactCheckResult> {
    return {
      matched: false,
      hits: [],
      model: 'noop',
      latencyMs: 0,
    };
  }
}

export class NoopGroundingProvider implements GroundingProvider {
  async ground(): Promise<GroundingResult> {
    return {
      sources: [],
      corroborationLevel: 0,
      contradictionLevel: 0,
      model: 'noop',
      latencyMs: 0,
    };
  }
}

export class NoopMediaVerificationProvider implements MediaVerificationProvider {
  async inspect(): Promise<MediaVerificationResult> {
    return {
      matches: [],
      mediaContextConfidence: 0,
      mediaContextWarning: false,
      model: 'noop',
      latencyMs: 0,
    };
  }
}
