import type {
  ClaimExtractionResult,
  FactualState,
  GroundingResult,
  VerificationOptions,
  VerificationOutcome,
  VerificationProviders,
  VerificationReason,
  VerificationRequest,
} from './types';
import { InMemoryVerificationCache, verificationCacheKey, type VerificationCache } from './cache';
import {
  buildReasons,
  clamp01,
  computeSourceTypeFromUrls,
  entityGroundingScore,
  sanitizeVerificationRequest,
  sourceTypeQuality,
  specificityScore,
} from './utils';
import {
  HeuristicClaimExtractorProvider,
  NoopFactCheckProvider,
  NoopGroundingProvider,
  NoopMediaVerificationProvider,
} from './noopProviders';

function quoteFidelityScore(input: VerificationRequest): number {
  const lower = input.text.toLowerCase();
  if (/["\u201C\u201D]/.test(input.text)) return 0.7;
  if (/\bthe rule says\b|\bthe report says\b|\baccording to\b/.test(lower)) return 0.6;
  return 0;
}

function correctionValueScore(input: VerificationRequest): number {
  const lower = input.text.toLowerCase();
  let score = 0;
  if (/\bactually\b|\bto clarify\b|\bfor context\b|\bin fact\b/.test(lower)) score += 0.35;
  if (/\bmisleading\b|\bout of context\b|\bincomplete\b|\bthe rule says\b/.test(lower)) score += 0.25;
  if (/\bnot\b|\bincorrect\b|\bdoesn'?t\b|\bwasn'?t\b/.test(lower)) score += 0.1;
  return clamp01(score);
}

function contextValueScore(input: VerificationRequest, grounding: GroundingResult | null): number {
  let score = 0;
  if (grounding?.summary) score += 0.35;
  if ((grounding?.sources.length ?? 0) >= 1) score += 0.2;
  if ((grounding?.sources.length ?? 0) >= 2) score += 0.15;
  if (input.embeds?.length) score += 0.15;
  if (input.entities?.length) score += 0.15;
  return clamp01(score);
}

function sourcePresenceScore(input: VerificationRequest, grounding: GroundingResult | null): number {
  const explicitLinks = (input.facets ?? []).filter((facet) => facet.type === 'link' && facet.uri).length;
  const embeds = input.embeds?.length ?? 0;
  const grounded = grounding?.sources.length ?? 0;
  return clamp01((explicitLinks * 0.25) + (embeds * 0.2) + (grounded * 0.2));
}

function aggregateSourceQuality(
  grounding: GroundingResult | null,
  fallbackSourceType: ReturnType<typeof computeSourceTypeFromUrls>,
): number {
  if (grounding?.sources.length) {
    const top = grounding.sources
      .slice()
      .sort((l, r) => r.sourceQuality - l.sourceQuality)
      .slice(0, 4);
    return clamp01(top.reduce((acc, s) => acc + s.sourceQuality, 0) / top.length);
  }
  return sourceTypeQuality(fallbackSourceType);
}

function computeFactualContributionScore(input: {
  checkability: number;
  sourcePresence: number;
  sourceQuality: number;
  quoteFidelity: number;
  specificity: number;
  contextValue: number;
  entityGrounding: number;
  correctionValue: number;
}): number {
  return clamp01(
    0.18 * input.checkability +
    0.16 * input.sourcePresence +
    0.16 * input.sourceQuality +
    0.12 * input.quoteFidelity +
    0.12 * input.specificity +
    0.12 * input.contextValue +
    0.07 * input.entityGrounding +
    0.07 * input.correctionValue,
  );
}

function computeFactualConfidence(input: {
  sourcePresence: number;
  sourceQuality: number;
  quoteFidelity: number;
  entityGrounding: number;
  checkability: number;
  corroborationLevel: number;
  contradictionLevel: number;
  mediaContextConfidence: number;
}): number {
  return clamp01(
    0.22 * input.sourcePresence +
    0.22 * input.sourceQuality +
    0.16 * input.quoteFidelity +
    0.12 * input.entityGrounding +
    0.12 * input.checkability +
    0.10 * input.corroborationLevel -
    0.10 * input.contradictionLevel +
    0.04 * input.mediaContextConfidence,
  );
}

function resolveFactualState(input: {
  factCheckMatched: boolean;
  factualContributionScore: number;
  factualConfidence: number;
  contradictionLevel: number;
  mediaContextWarning: boolean;
  correctionValue: number;
}): FactualState {
  if (input.factCheckMatched) return 'known-fact-check-match';
  if (input.mediaContextWarning) return 'media-context-warning';
  if (input.factualContributionScore >= 0.70 && input.factualConfidence >= 0.78) return 'well-supported';
  if (input.correctionValue >= 0.60 && input.factualConfidence >= 0.68) return 'source-backed-clarification';
  if (input.contradictionLevel >= 0.45) return 'contested';
  if (input.factualContributionScore >= 0.55 && input.factualConfidence >= 0.58) return 'partially-supported';
  if (input.factualContributionScore > 0.20) return 'unsupported-so-far';
  return 'none';
}

export interface VerifyEvidenceContext {
  cache?: VerificationCache;
  cacheTtlMs?: number;
}

export async function verifyEvidence(
  requestInput: VerificationRequest,
  providers: VerificationProviders,
  options?: VerificationOptions,
  context?: VerifyEvidenceContext,
): Promise<VerificationOutcome> {
  const start = Date.now();
  const request = sanitizeVerificationRequest(requestInput, options?.maxTextLength ?? 1_200);
  const cache = context?.cache ?? new InMemoryVerificationCache();
  const cacheKey = verificationCacheKey(request.postUri, request.text);
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const claimExtractor = providers.claimExtractor ?? new HeuristicClaimExtractorProvider();
  const factCheckProvider = providers.factCheck ?? new NoopFactCheckProvider();
  const groundingProvider = providers.grounding ?? new NoopGroundingProvider();
  const mediaProvider = providers.media ?? new NoopMediaVerificationProvider();

  const providerFailures: string[] = [];

  const extractedClaims = await claimExtractor.extractClaim(request);
  const claims = extractedClaims.claims.slice(0, options?.maxClaims ?? 3);

  const [factCheckResult, groundingResult, mediaResult] = await Promise.all([
    options?.useFactCheck === false
      ? Promise.resolve(null)
      : factCheckProvider.lookup({ request, claims, ...(request.signal !== undefined ? { signal: request.signal } : {}) }).catch((error) => {
          providerFailures.push(`factCheck:${(error as Error).message}`);
          return null;
        }),
    options?.useGrounding === false
      ? Promise.resolve(null)
      : groundingProvider.ground({ request, claims, ...(request.signal !== undefined ? { signal: request.signal } : {}) }).catch((error) => {
          providerFailures.push(`grounding:${(error as Error).message}`);
          return null;
        }),
    options?.useMediaVerification === false || !(request.media?.length)
      ? Promise.resolve(null)
      : mediaProvider.inspect({ request, claims, ...(request.signal !== undefined ? { signal: request.signal } : {}) }).catch((error) => {
          providerFailures.push(`media:${(error as Error).message}`);
          return null;
        }),
  ]);

  const firstClaim = claims[0];
  const citedUrls = Array.from(new Set([
    ...(request.facets ?? []).flatMap((f) => f.uri ? [f.uri] : []),
    ...(request.embeds ?? []).map((e) => e.url),
    ...(groundingResult?.sources ?? []).map((s) => s.url),
    ...(factCheckResult?.hits ?? []).map((h) => h.url),
  ]));

  const sourceType = groundingResult?.sources
    ?.slice()
    .sort((l, r) => r.sourceQuality - l.sourceQuality)[0]?.sourceType
    ?? computeSourceTypeFromUrls(citedUrls);

  const sourcePresence = sourcePresenceScore(request, groundingResult);
  const sourceQuality = aggregateSourceQuality(groundingResult, sourceType);
  const quoteFidelity = quoteFidelityScore(request);
  const specificity = specificityScore(request.text);
  const entityGrounding = entityGroundingScore(request.entities);
  const contextValue = contextValueScore(request, groundingResult);
  const correctionValue = correctionValueScore(request);
  const corroborationLevel = clamp01(groundingResult?.corroborationLevel ?? 0);
  const contradictionLevel = clamp01(groundingResult?.contradictionLevel ?? 0);
  const mediaContextConfidence = clamp01(mediaResult?.mediaContextConfidence ?? 0);

  const factualContributionScore = computeFactualContributionScore({
    checkability: clamp01(firstClaim?.checkability ?? 0),
    sourcePresence,
    sourceQuality,
    quoteFidelity,
    specificity,
    contextValue,
    entityGrounding,
    correctionValue,
  });

  const factualConfidence = computeFactualConfidence({
    sourcePresence,
    sourceQuality,
    quoteFidelity,
    entityGrounding,
    checkability: clamp01(firstClaim?.checkability ?? 0),
    corroborationLevel,
    contradictionLevel,
    mediaContextConfidence,
  });

  const reasons: VerificationReason[] = buildReasons({
    sourceType,
    checkability: clamp01(firstClaim?.checkability ?? 0),
    specificity,
    quoteFidelity,
    entityGrounding,
    correctionValue,
    contextValue,
    corroborationLevel,
    contradictionLevel,
    mediaContextWarning: mediaResult?.mediaContextWarning ?? false,
  });

  if (factCheckResult?.matched) reasons.unshift('known-fact-check-match');

  const outcome: VerificationOutcome = {
    request,
    extractedClaims,
    factCheck: factCheckResult,
    grounding: groundingResult,
    media: mediaResult,

    claimType: firstClaim?.claimType ?? 'unclear',
    sourceType,
    ...((() => {
      const domain = groundingResult?.sources?.[0]?.domain ?? request.embeds?.[0]?.domain;
      return domain ? { sourceDomain: domain } : {};
    })()),
    citedUrls,
    quotedTextSpans: firstClaim?.quotedTextSpans ?? [],

    checkability: clamp01(firstClaim?.checkability ?? 0),
    sourcePresence,
    sourceQuality,
    quoteFidelity,
    specificity,
    contextValue,
    entityGrounding,
    correctionValue,
    corroborationLevel,
    contradictionLevel,
    mediaContextConfidence,

    factualContributionScore,
    factualConfidence,
    factualState: resolveFactualState({
      factCheckMatched: factCheckResult?.matched ?? false,
      factualContributionScore,
      factualConfidence,
      contradictionLevel,
      mediaContextWarning: mediaResult?.mediaContextWarning ?? false,
      correctionValue,
    }),
    reasons,

    diagnostics: {
      providerFailures,
      latencyMs: Date.now() - start,
    },
  };

  await cache.set(cacheKey, outcome, context?.cacheTtlMs ?? 5 * 60_000);
  return outcome;
}
