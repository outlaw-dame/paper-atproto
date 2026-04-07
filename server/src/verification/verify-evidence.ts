import type {
  VerificationInput,
  VerificationResult,
  FactualContributionReason,
  SourceType,
  FactualState,
} from './types.js';
import { env } from '../config/env.js';
import { GoogleFactCheckProvider } from './google-fact-check.provider.js';
import { GeminiGroundingProvider } from './gemini-grounding.provider.js';
import { GoogleVisionMediaProvider } from './google-vision-media.provider.js';
import { createEntityLinkingProvider, computeEntityGrounding } from './entity-linking.provider.js';

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function chooseSourceType(types: SourceType[]): SourceType {
  const rank: SourceType[] = [
    'official_rule', 'court_record', 'government_record', 'standards_body',
    'primary_document', 'official_statement', 'reputable_reporting',
    'secondary_summary', 'user_screenshot', 'unknown', 'none',
  ];
  for (const candidate of rank) {
    if (types.includes(candidate)) return candidate;
  }
  return 'none';
}

function computeSourceQuality(sourceType: SourceType): number {
  switch (sourceType) {
    case 'official_rule': case 'court_record': case 'government_record': case 'standards_body': return 0.94;
    case 'primary_document': return 0.84;
    case 'official_statement': return 0.78;
    case 'reputable_reporting': return 0.68;
    case 'secondary_summary': return 0.45;
    case 'user_screenshot': return 0.35;
    case 'unknown': return 0.2;
    default: return 0;
  }
}

function buildReasons(input: {
  knownFactCheckMatch: boolean; sourceType: SourceType; checkability: number;
  specificity: number; quoteFidelity: number; entityGrounding: number;
  correctionValue: number; contextValue: number; corroborationLevel: number;
  mediaContextConfidence: number; mismatchRisk: number;
}): FactualContributionReason[] {
  const reasons: FactualContributionReason[] = [];
  if (input.knownFactCheckMatch) reasons.push('known-fact-check-match');
  if (input.sourceType === 'primary_document') reasons.push('primary-source-cited');
  if (input.sourceType === 'official_rule') reasons.push('official-rule-cited');
  if (input.sourceType === 'official_statement') reasons.push('official-statement-cited');
  if (input.checkability >= 0.65) reasons.push('claim-is-checkable');
  if (input.specificity >= 0.6) reasons.push('specific-date-or-number');
  if (input.quoteFidelity >= 0.65) reasons.push('quote-fidelity-high', 'direct-quote-present');
  if (input.entityGrounding >= 0.6) reasons.push('entity-grounded');
  if (input.correctionValue >= 0.6) reasons.push('corrective-context');
  if (input.contextValue >= 0.6) reasons.push('clarifies-ambiguity');
  if (input.corroborationLevel >= 0.65) reasons.push('multi-source-corroboration');
  if (input.mediaContextConfidence >= 0.6) reasons.push('media-context-match');
  if (input.mismatchRisk >= 0.6) reasons.push('media-context-mismatch-risk');
  return [...new Set(reasons)];
}

function computeFactualContributionScore(input: {
  checkability: number; sourcePresence: number; sourceQuality: number;
  quoteFidelity: number; specificity: number; contextValue: number;
  entityGrounding: number; correctionValue: number;
}): number {
  return clamp01(
    0.18 * input.checkability + 0.16 * input.sourcePresence + 0.16 * input.sourceQuality +
    0.12 * input.quoteFidelity + 0.12 * input.specificity + 0.12 * input.contextValue +
    0.07 * input.entityGrounding + 0.07 * input.correctionValue,
  );
}

function computeFactualConfidence(input: {
  sourcePresence: number; sourceQuality: number; quoteFidelity: number;
  entityGrounding: number; checkability: number; corroborationLevel: number;
  knownFactCheckMatch: boolean;
}): number {
  return clamp01(
    0.22 * input.sourcePresence + 0.20 * input.sourceQuality + 0.16 * input.quoteFidelity +
    0.14 * input.entityGrounding + 0.12 * input.checkability + 0.16 * input.corroborationLevel +
    (input.knownFactCheckMatch ? 0.18 : 0),
  );
}

function chooseFactualState(input: {
  knownFactCheckMatch: boolean; sourcePresence: number; correctionValue: number;
  corroborationLevel: number; contradictionLevel: number; mediaContextConfidence: number;
  mismatchRisk: number; factualContributionScore: number; factualConfidence: number;
}): FactualState {
  if (input.mismatchRisk >= 0.7) return 'media_context_warning';
  if (input.knownFactCheckMatch) return 'known_fact_check_match';
  if (input.sourcePresence >= 0.6 && input.correctionValue >= 0.6 && input.factualConfidence >= 0.65) return 'source_backed_clarification';
  if (input.corroborationLevel >= 0.7 && input.factualContributionScore >= 0.7 && input.factualConfidence >= 0.7) return 'well_supported';
  if (input.contradictionLevel >= 0.55) return 'contested';
  if (input.factualContributionScore >= 0.45) return 'partially_supported';
  if (input.mediaContextConfidence >= 0.6) return 'media_context_warning';
  return 'unsupported_so_far';
}

function naiveClaimType(text: string): VerificationResult['claimType'] {
  const t = text.toLowerCase();
  if (!t.trim()) return 'none';
  if (/\b(rule|policy|section|official|book|guidance)\b/.test(t)) return 'rule_interpretation';
  if (/\b(photo|image|video|screenshot|picture)\b/.test(t)) return 'media_claim';
  if (/\bsaid|quoted|quote|according to\b/.test(t)) return 'quote_claim';
  if (/\b\d+(\.\d+)?%|\b\d{4}\b|\b\d+\b/.test(t)) return 'statistical_claim';
  if (/\bwhen|before|after|today|yesterday|tomorrow|date\b/.test(t)) return 'timeline_claim';
  return 'factual_assertion';
}

const emptyGrounding = {
  summary: null as null, sources: [] as [], corroborationLevel: 0,
  contradictionLevel: 0, quoteFidelity: 0, contextValue: 0, correctionValue: 0,
};

export async function verifyEvidence(input: VerificationInput): Promise<VerificationResult> {
  const factCheck = new GoogleFactCheckProvider();
  const grounding = new GeminiGroundingProvider();
  const media = new GoogleVisionMediaProvider();
  const entityLinking = createEntityLinkingProvider();
  const entityLinkingEndpoint = env.VERIFY_ENTITY_LINKING_PROVIDER === 'wikidata'
    ? env.VERIFY_WIKIDATA_ENDPOINT
    : env.VERIFY_ENTITY_LINKING_PROVIDER === 'hybrid'
      ? `${env.VERIFY_ENTITY_LINKING_ENDPOINT} | ${env.VERIFY_WIKIDATA_ENDPOINT}`
      : env.VERIFY_ENTITY_LINKING_ENDPOINT;

  const claimType = naiveClaimType(input.text);
  const extractedClaim = input.text.trim() || null;
  const checkability = extractedClaim ? 0.75 : 0;
  const specificity = /\b\d|\bsection\b|\brule\b|\barticle\b/i.test(input.text) ? 0.65 : 0.4;

  const [factMatches, grounded, mediaResult, linkedEntities] = await Promise.all([
    extractedClaim ? factCheck.searchClaims(extractedClaim, input.languageCode ?? 'en') : Promise.resolve([]),
    extractedClaim
      ? grounding.groundClaim({
          claim: extractedClaim,
          ...(input.languageCode !== undefined ? { languageCode: input.languageCode } : {}),
          ...(input.urls ? { urls: input.urls } : {}),
        })
      : Promise.resolve(emptyGrounding),
    input.imageUrls?.[0] ? media.verifyImage(input.imageUrls[0]).catch(() => null) : Promise.resolve(null),
    entityLinking.linkEntities(input.text, input.topicHints ?? []).catch(() => []),
  ]);

  const entityGrounding = computeEntityGrounding(input.topicHints ?? [], linkedEntities);

  const sourceType = chooseSourceType(grounded.sources.map((s) => s.sourceType));
  const sourceQuality = computeSourceQuality(sourceType);
  const sourcePresence = grounded.sources.length > 0 || factMatches.length > 0 ? 1 : 0;
  const mediaContextConfidence = mediaResult?.mediaContextConfidence ?? 0;
  const mismatchRisk = mediaResult?.mismatchRisk ?? 0;

  const factualContributionScore = computeFactualContributionScore({
    checkability, sourcePresence, sourceQuality,
    quoteFidelity: grounded.quoteFidelity, specificity,
    contextValue: grounded.contextValue, entityGrounding,
    correctionValue: grounded.correctionValue,
  });

  const factualConfidence = computeFactualConfidence({
    sourcePresence, sourceQuality, quoteFidelity: grounded.quoteFidelity,
    entityGrounding, checkability, corroborationLevel: grounded.corroborationLevel,
    knownFactCheckMatch: factMatches.length > 0,
  });

  const factualState = chooseFactualState({
    knownFactCheckMatch: factMatches.length > 0, sourcePresence,
    correctionValue: grounded.correctionValue, corroborationLevel: grounded.corroborationLevel,
    contradictionLevel: grounded.contradictionLevel, mediaContextConfidence, mismatchRisk,
    factualContributionScore, factualConfidence,
  });

  const reasons = buildReasons({
    knownFactCheckMatch: factMatches.length > 0, sourceType, checkability, specificity,
    quoteFidelity: grounded.quoteFidelity, entityGrounding,
    correctionValue: grounded.correctionValue, contextValue: grounded.contextValue,
    corroborationLevel: grounded.corroborationLevel, mediaContextConfidence, mismatchRisk,
  });

  // Always include linked entities so the client can upgrade canonicalEntityId
  // values from locally-generated IDs (ent:concept:ai) to Wikidata/DBpedia
  // canonical IDs (wikidata:Q11660). Filtered to confidence ≥ 0.55 to avoid
  // low-quality matches polluting the entity landscape.
  const canonicalEntities = linkedEntities
    .filter((e) => e.confidence >= 0.55)
    .map((e) => ({
      mention: e.mention,
      canonicalId: e.canonicalId,
      canonicalLabel: e.canonicalLabel,
      confidence: e.confidence,
      provider: e.provider,
    }));

  return {
    claimType,
    extractedClaim,
    knownFactCheckMatch: factMatches.length > 0,
    factCheckMatches: factMatches,
    sourcePresence,
    sourceType,
    ...(grounded.sources[0]?.domain !== undefined ? { sourceDomain: grounded.sources[0].domain } : {}),
    citedUrls: [...new Set([...grounded.sources.map((s) => s.uri), ...factMatches.map((m) => m.reviewUrl)])],
    quoteFidelity: grounded.quoteFidelity,
    corroborationLevel: grounded.corroborationLevel,
    contradictionLevel: grounded.contradictionLevel,
    mediaContextConfidence,
    entityGrounding,
    contextValue: grounded.contextValue,
    correctionValue: grounded.correctionValue,
    checkability,
    specificity,
    factualContributionScore,
    factualConfidence,
    factualState,
    reasons,
    ...(canonicalEntities.length > 0 ? { canonicalEntities } : {}),
    ...(env.VERIFY_ENTITY_LINKING_DEBUG
      ? {
          entityLinking: {
            provider: env.VERIFY_ENTITY_LINKING_PROVIDER,
            ...(entityLinkingEndpoint
              ? { endpoint: entityLinkingEndpoint }
              : {}),
          },
        }
      : {}),
  };
}
