import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { computeInterpretiveConfidenceForSession } from '../conversation/interpretive/interpretiveScoring';
import { computeInterpretiveFactors } from '../conversation/interpretive/interpretiveFactors';
import {
  canonicalStoryIdentityFromCluster,
  generateCanonicalStoryId,
  type CanonicalStorySignals,
} from '../conversation/discovery/canonicalStory';
import { buildStoryClusters } from '../conversation/discovery/storyClustering';
import { detectCoverageGapForCluster } from '../conversation/discovery/coverageGap';
import { projectStoryView } from '../conversation/projections/storyProjection';
import type { MockPost } from '../data/mockData';
import type { ConversationSession } from '../conversation/sessionTypes';
import type { VerificationOutcome } from '../intelligence/verification/types';
import {
  ETHICAL_RANKING_POLICY,
  clampEngagementEffect,
  computeEthicalRankingScore,
} from '../intelligence/ranking/ethicalRanking';
import {
  computeLocalPersonalizationAdjustment,
  computeLocallyPersonalizedRankingScore,
  createLocalPersonalizationProfile,
} from '../intelligence/ranking/localPersonalization';
import {
  LOCAL_USER_DATA_SURFACES,
  REMOTE_USER_DATA_SYNC_ALLOWED,
  summarizeLocalUserDataPolicy,
  validateLocalUserDataPolicy,
} from '../privacy/localUserDataPolicy';

export interface AiArchitectureProof {
  id: string;
  invariant: string;
  passed: boolean;
  evidence: Record<string, unknown>;
  failure?: string;
}

export interface AiArchitectureProofReport {
  schemaVersion: 1;
  generatedAt: string;
  architecture: {
    substrate: 'deterministic-signals';
    scoringAuthority: 'session-interpretive-stack';
    projectionPolicy: 'sanitized-derived-state';
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  proofs: AiArchitectureProof[];
}

const ROOT_URI = 'at://did:plc:proof-root/app.bsky.feed.post/root';
const REPLY_URI = 'at://did:plc:proof-reply/app.bsky.feed.post/reply';
const RAW_PROOF_TEXT = 'Sensitive proof claim with https://official.example/report from did:plc:private';
const RAW_PROOF_DID = 'did:plc:private';
const RAW_PROOF_DOMAIN = 'official.example';

export async function buildAiArchitectureProofReport(options: {
  generatedAt?: string;
} = {}): Promise<AiArchitectureProofReport> {
  const proofs = await Promise.all([
    proveVerificationBoundary(),
    proveFactCheckMonotonicity(),
    proveExplanationProjectionSanitization(),
    proveCoverageGapStructuralSanitization(),
    proveCanonicalStoryDeterminism(),
    proveStrongAnchorClustering(),
    proveStoryProjectionSanitization(),
    proveEthicalRankingBoundaries(),
    proveLocalPersonalizationBoundaries(),
    proveLocalOnlyUserDataPolicy(),
  ]);
  const passed = proofs.filter((proof) => proof.passed).length;

  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    architecture: {
      substrate: 'deterministic-signals',
      scoringAuthority: 'session-interpretive-stack',
      projectionPolicy: 'sanitized-derived-state',
    },
    summary: {
      total: proofs.length,
      passed,
      failed: proofs.length - passed,
    },
    proofs,
  };
}

export function assertAiArchitectureProofReport(report: AiArchitectureProofReport): void {
  const failures = report.proofs.filter((proof) => !proof.passed);
  if (failures.length > 0) {
    throw new Error(
      `AI architecture proof failed: ${failures.map((proof) => proof.id).join(', ')}`,
    );
  }
}

async function proveVerificationBoundary(): Promise<AiArchitectureProof> {
  const source = readFileSync(join(process.cwd(), 'server/src/routes/verification.ts'), 'utf8');
  const factCheckRoute = extractRouteBody(source, '/fact-check');
  const mediaRoute = extractRouteBody(source, '/media');
  const evidenceRoute = extractRouteBody(source, '/evidence');
  const factCheckContainsDirectSafeBrowsingVerdict = /checkUrlAgainstSafeBrowsing|shouldBlockSafeBrowsingVerdict/.test(factCheckRoute);
  const factCheckUsesMediaSanitizer = /sanitizeVerificationImageUrls/.test(factCheckRoute);
  const mediaContainsSafeBrowsing = /SafeBrowsing|sanitizeVerificationImageUrls/.test(mediaRoute);
  const evidenceContainsSafeBrowsing = /SafeBrowsing|sanitizeVerificationImageUrls/.test(evidenceRoute);
  const factCheckUsesFactCheckProvider = /GoogleFactCheckProvider|factCheckProvider\.lookup/.test(factCheckRoute);
  const factCheckMatchedFromHits = /matched:\s*hits\.length\s*>\s*0/.test(factCheckRoute);
  const factCheckHitsFromProviderMatches = /dedupeFactCheckMatches/.test(factCheckRoute)
    && /provider\.searchClaims/.test(factCheckRoute);

  return proof({
    id: 'verification.boundary.safe_browsing_is_not_fact_check',
    invariant: 'Safe Browsing may preflight media URLs, but factual match state must come only from Fact Check provider hits.',
    passed: !factCheckContainsDirectSafeBrowsingVerdict
      && factCheckUsesFactCheckProvider
      && factCheckMatchedFromHits
      && factCheckHitsFromProviderMatches
      && (mediaContainsSafeBrowsing || evidenceContainsSafeBrowsing),
    evidence: {
      factCheckRouteLength: factCheckRoute.length,
      factCheckContainsDirectSafeBrowsingVerdict,
      factCheckUsesMediaSanitizer,
      factCheckUsesFactCheckProvider,
      factCheckMatchedFromHits,
      factCheckHitsFromProviderMatches,
      mediaContainsSafeBrowsing,
      evidenceContainsSafeBrowsing,
    },
    failure: 'Fact Check matched state is coupled to Safe Browsing verdicts or Fact Check provider evidence is missing.',
  });
}

async function proveFactCheckMonotonicity(): Promise<AiArchitectureProof> {
  const baseline = computeInterpretiveFactors(createProofSession()).factors;
  const matched = computeInterpretiveFactors(
    createProofSession(createVerificationOutcome({
      factualState: 'known-fact-check-match',
      factCheckMatched: true,
      contradictionLevel: 0.05,
      corroborationLevel: 0.9,
      sourcePresence: 0.95,
      sourceQuality: 0.9,
      reasons: ['known-fact-check-match', 'multiple-reputable-sources'],
    })),
  ).factors;
  const contested = computeInterpretiveFactors(
    createProofSession(createVerificationOutcome({
      factualState: 'contested',
      factCheckMatched: false,
      contradictionLevel: 0.75,
      corroborationLevel: 0.2,
      sourcePresence: 0.95,
      sourceQuality: 0.9,
      reasons: ['conflicting-reputable-sources'],
    })),
  ).factors;

  return proof({
    id: 'interpretive.fact_check_monotonicity',
    invariant: 'Known Fact Check matches must strengthen evidence/source factors, while contested outcomes must increase contradiction pressure.',
    passed: matched.evidenceAdequacy > baseline.evidenceAdequacy
      && matched.sourceIntegritySupport > baseline.sourceIntegritySupport
      && contested.contradictionPenalty > matched.contradictionPenalty
      && contested.evidenceAdequacy < matched.evidenceAdequacy,
    evidence: {
      baseline: pickFactors(baseline),
      knownFactCheckMatch: pickFactors(matched),
      contested: pickFactors(contested),
      deltas: {
        evidenceKnownMinusBaseline: round(matched.evidenceAdequacy - baseline.evidenceAdequacy),
        sourceKnownMinusBaseline: round(matched.sourceIntegritySupport - baseline.sourceIntegritySupport),
        contradictionContestedMinusKnown: round(contested.contradictionPenalty - matched.contradictionPenalty),
      },
    },
    failure: 'Verification outcomes are not moving interpretive factors in the expected monotonic direction.',
  });
}

async function proveExplanationProjectionSanitization(): Promise<AiArchitectureProof> {
  const computation = computeInterpretiveConfidenceForSession(
    createProofSession(createVerificationOutcome({
      factualState: 'known-fact-check-match',
      factCheckMatched: true,
      contradictionLevel: 0.05,
      corroborationLevel: 0.9,
      sourcePresence: 0.95,
      sourceQuality: 0.9,
      reasons: ['known-fact-check-match', 'multiple-reputable-sources'],
    })),
  );
  const serializedV2 = JSON.stringify(computation.explanation.v2);
  const containsRaw = containsAny(serializedV2, [RAW_PROOF_TEXT, RAW_PROOF_DID, RAW_PROOF_DOMAIN]);

  return proof({
    id: 'interpretive.explanation_v2_is_sanitized_projection',
    invariant: 'Explanation v2 must expose structured factor evidence only, not raw post text, DIDs, URLs, or domains.',
    passed: !containsRaw
      && computation.explanation.v2?.schemaVersion === 2
      && (computation.explanation.v2.contributions.length > 0)
      && computation.confidence.interpretiveConfidence === computation.explanation.score,
    evidence: {
      schemaVersion: computation.explanation.v2?.schemaVersion,
      contributionCount: computation.explanation.v2?.contributions.length ?? 0,
      primaryReasons: computation.explanation.v2?.primaryReasons ?? [],
      interpretiveConfidence: round(computation.confidence.interpretiveConfidence),
      explanationScore: round(computation.explanation.score),
      containsRaw,
    },
    failure: 'Explanation projection leaked raw data or drifted from the authoritative score.',
  });
}

async function proveCoverageGapStructuralSanitization(): Promise<AiArchitectureProof> {
  const signal = await detectCoverageGapForCluster(
    {
      rootUri: ROOT_URI,
      quotedUris: [],
      externalDomains: [],
      externalUrls: [`https://${RAW_PROOF_DOMAIN}/report`],
      mentionedDids: [RAW_PROOF_DID],
      canonicalEntityIds: ['wikidata:Q-proof'],
    },
    {
      fetchComparisons: async () => [
        {
          externalUrls: ['https://analysis.example/report'],
          mentionedDids: ['did:plc:other'],
          canonicalEntityIds: ['wikidata:Q-proof'],
        },
        {
          externalUrls: ['https://archive.example/report'],
          mentionedDids: ['did:plc:third'],
          canonicalEntityIds: ['wikidata:Q-proof'],
        },
      ],
    },
  );
  const serializedSignal = JSON.stringify(signal);
  const containsRaw = containsAny(serializedSignal, [RAW_PROOF_DID, RAW_PROOF_DOMAIN, 'analysis.example']);
  const hasIdeologyKeys = Object.keys(signal).some((key) => /bias|left|right|ideolog|partisan/i.test(key));

  return proof({
    id: 'discovery.coverage_gap_is_structural_and_sanitized',
    invariant: 'Coverage gap must report structural divergence only and must not expose raw domains, DIDs, or ideology labels.',
    passed: signal.kind === 'divergent_sources'
      && signal.magnitude > 0.4
      && !containsRaw
      && !hasIdeologyKeys,
    evidence: {
      signal,
      containsRaw,
      hasIdeologyKeys,
    },
    failure: 'Coverage-gap signal leaked raw comparison data or introduced non-structural labeling.',
  });
}

async function proveCanonicalStoryDeterminism(): Promise<AiArchitectureProof> {
  const left: CanonicalStorySignals = {
    externalUrls: ['https://example.com/b', 'https://example.com/a'],
    entityIds: ['wikidata:q2', 'wikidata:q1'],
    quotedUris: ['at://did:plc:quote/app.bsky.feed.post/quote'],
    rootUris: ['at://did:plc:root/app.bsky.feed.post/root'],
  };
  const right: CanonicalStorySignals = {
    externalUrls: ['https://example.com/a', 'https://example.com/b'],
    entityIds: ['wikidata:q1', 'wikidata:q2'],
    quotedUris: ['at://did:plc:quote/app.bsky.feed.post/quote'],
    rootUris: ['at://did:plc:root/app.bsky.feed.post/root'],
  };
  const leftId = generateCanonicalStoryId(left);
  const rightId = generateCanonicalStoryId(right);
  const identity = canonicalStoryIdentityFromCluster({
    id: 'cluster:proof',
    rootUris: left.rootUris,
    quotedUris: left.quotedUris,
    externalUrls: left.externalUrls,
    entityIds: left.entityIds,
    domains: ['example.com'],
    postUris: [
      'at://did:plc:proof/app.bsky.feed.post/post',
      'https://mastodon.example/@proof/111',
    ],
    confidence: 0.72,
  });

  return proof({
    id: 'discovery.canonical_story_identity_is_deterministic',
    invariant: 'Canonical story identity must be stable across signal ordering and preserve only protocol-family metadata.',
    passed: leftId === rightId
      && identity.protocols.includes('atproto')
      && identity.protocols.includes('activitypub')
      && /^story:[0-9a-f]{8}$/.test(identity.id),
    evidence: {
      leftId,
      rightId,
      identityId: identity.id,
      protocols: identity.protocols,
      sourceThreadCount: identity.sourceThreads.length,
    },
    failure: 'Canonical story identity is unstable or protocol metadata is missing.',
  });
}

async function proveStrongAnchorClustering(): Promise<AiArchitectureProof> {
  const sameDomainClusters = buildStoryClusters([
    {
      uri: 'at://did:plc:one/app.bsky.feed.post/one',
      externalUrls: ['https://example.com/report-a'],
      domains: ['example.com'],
    },
    {
      uri: 'at://did:plc:two/app.bsky.feed.post/two',
      externalUrls: ['https://example.com/report-b'],
      domains: ['example.com'],
    },
  ]);
  const crossProtocolClusters = buildStoryClusters([
    {
      uri: 'at://did:plc:one/app.bsky.feed.post/one',
      externalUrls: ['https://example.com/report'],
    },
    {
      uri: 'https://mastodon.example/@alice/111',
      externalUrls: ['https://example.com/report#section'],
    },
  ]);

  return proof({
    id: 'discovery.story_clustering_requires_strong_anchors',
    invariant: 'Story clustering must not merge on shared domain alone, but must merge exact cross-protocol link anchors.',
    passed: sameDomainClusters.length === 2
      && crossProtocolClusters.length === 1
      && crossProtocolClusters[0]?.postUris.length === 2,
    evidence: {
      sameDomainClusterCount: sameDomainClusters.length,
      sameDomainPostGroups: sameDomainClusters.map((cluster) => cluster.postUris.length),
      crossProtocolClusterCount: crossProtocolClusters.length,
      crossProtocolPostCount: crossProtocolClusters[0]?.postUris.length ?? 0,
      crossProtocolExternalUrls: crossProtocolClusters[0]?.externalUrls ?? [],
    },
    failure: 'Story clustering merged weak domain-only anchors or failed to merge exact strong anchors.',
  });
}

async function proveStoryProjectionSanitization(): Promise<AiArchitectureProof> {
  const projection = projectStoryView({
    query: 'proof',
    posts: [
      createMockPost({
        id: 'at://did:plc:proof/app.bsky.feed.post/one',
        embedUrl: `https://${RAW_PROOF_DOMAIN}/report`,
      }),
      createMockPost({
        id: 'at://did:plc:proof/app.bsky.feed.post/two',
        embedUrl: `https://${RAW_PROOF_DOMAIN}/report#section`,
      }),
    ],
    getTranslatedText: (post) => post.content,
  });
  const serializedCanonicalProjection = JSON.stringify(projection.canonicalStory);
  const containsRaw = containsAny(serializedCanonicalProjection, [RAW_PROOF_DOMAIN, RAW_PROOF_DID, RAW_PROOF_TEXT]);

  return proof({
    id: 'projection.canonical_story_projection_is_sanitized',
    invariant: 'Story projection may expose canonical identity metadata, but not raw canonical story source URLs or DIDs.',
    passed: Boolean(projection.canonicalStory?.id)
      && projection.canonicalStory?.sourceThreadCount === 2
      && !containsRaw,
    evidence: {
      canonicalStory: projection.canonicalStory,
      containsRaw,
    },
    failure: 'Canonical story projection leaked raw source signals or failed to project canonical identity.',
  });
}

async function proveEthicalRankingBoundaries(): Promise<AiArchitectureProof> {
  const highConfidenceLowEngagement = computeEthicalRankingScore({
    interpretiveConfidence: 0.72,
    recency: 0.5,
    engagement: 0,
    coverageGap: 0.1,
    diversityScore: 0.9,
  });
  const lowConfidenceHighEngagement = computeEthicalRankingScore({
    interpretiveConfidence: 0.36,
    recency: 0.5,
    engagement: 1,
    coverageGap: 0.1,
    diversityScore: 0.9,
  });
  const weakGuardedStory = computeEthicalRankingScore({
    interpretiveConfidence: 0.35,
    recency: 1,
    engagement: 1,
    coverageGap: 0.75,
    diversityScore: 0.2,
  });
  const maxLowConfidenceEngagementEffect = ETHICAL_RANKING_POLICY.maxEngagementInfluenceRate * 0.36;
  const observedLowConfidenceEngagementEffect = clampEngagementEffect(1, 0.36);

  return proof({
    id: 'ranking.ethical_engagement_is_bounded_by_interpretive_quality',
    invariant: 'Adaptive ranking may reorder within bounded guardrails, but engagement must not overpower interpretive quality or feed back into confidence.',
    passed: highConfidenceLowEngagement.score > lowConfidenceHighEngagement.score
      && observedLowConfidenceEngagementEffect <= maxLowConfidenceEngagementEffect
      && weakGuardedStory.explanation.appliedGuardrails.includes('low_diversity')
      && weakGuardedStory.explanation.appliedGuardrails.includes('coverage_gap')
      && weakGuardedStory.explanation.appliedGuardrails.includes('confidence_floor')
      && !('interpretiveConfidence' in weakGuardedStory.explanation),
    evidence: {
      highConfidenceLowEngagement: {
        score: round(highConfidenceLowEngagement.score),
        interpretiveContribution: round(highConfidenceLowEngagement.explanation.interpretiveContribution),
        engagementEffect: round(highConfidenceLowEngagement.explanation.engagementEffect),
      },
      lowConfidenceHighEngagement: {
        score: round(lowConfidenceHighEngagement.score),
        interpretiveContribution: round(lowConfidenceHighEngagement.explanation.interpretiveContribution),
        engagementEffect: round(lowConfidenceHighEngagement.explanation.engagementEffect),
      },
      weakGuardedStory: {
        score: round(weakGuardedStory.score),
        appliedGuardrails: weakGuardedStory.explanation.appliedGuardrails,
        diversityAdjustment: round(weakGuardedStory.explanation.diversityAdjustment),
        coverageGapAdjustment: round(weakGuardedStory.explanation.coverageGapAdjustment),
        confidenceFloorAdjustment: round(weakGuardedStory.explanation.confidenceFloorAdjustment),
      },
      policy: {
        interpretiveWeight: ETHICAL_RANKING_POLICY.interpretiveWeight,
        engagementWeight: ETHICAL_RANKING_POLICY.engagementWeight,
        maxEngagementInfluenceRate: ETHICAL_RANKING_POLICY.maxEngagementInfluenceRate,
      },
    },
    failure: 'Adaptive ranking can overpower interpretive quality, skip guardrails, or expose confidence as mutable ranking output.',
  });
}

async function proveLocalPersonalizationBoundaries(): Promise<AiArchitectureProof> {
  const profile = createLocalPersonalizationProfile({
    enabled: true,
    depth: 1,
    breadth: 1,
    recency: 1,
    sampleCount: 24,
    updatedAt: '2026-04-23T12:00:00.000Z',
  });
  const disabledProfile = createLocalPersonalizationProfile({
    ...profile,
    enabled: false,
  });
  const lowConfidenceStrongFit = computeLocallyPersonalizedRankingScore({
    interpretiveConfidence: 0.36,
    recency: 0.5,
    engagement: 1,
    coverageGap: 0.1,
    diversityScore: 0.9,
    personalization: profile,
    contentSignals: {
      depth: 1,
      breadth: 1,
      recency: 1,
    },
  });
  const highConfidencePoorFit = computeLocallyPersonalizedRankingScore({
    interpretiveConfidence: 0.72,
    recency: 0.5,
    engagement: 0,
    coverageGap: 0.1,
    diversityScore: 0.9,
    personalization: profile,
    contentSignals: {
      depth: 0,
      breadth: 0,
      recency: 0,
    },
  });
  const disabledAdjustment = computeLocalPersonalizationAdjustment({
    profile: disabledProfile,
    contentSignals: {
      depth: 1,
      breadth: 1,
      recency: 1,
    },
    interpretiveConfidence: 1,
  });
  const serializedProfile = JSON.stringify(profile);
  const storedKeys = Object.keys(JSON.parse(serializedProfile) as Record<string, unknown>).sort();
  const containsRawOrIdeology = containsAny(serializedProfile, [
    RAW_PROOF_TEXT,
    RAW_PROOF_DID,
    RAW_PROOF_DOMAIN,
    ROOT_URI,
    'left',
    'right',
    'ideology',
    'political',
  ]);

  return proof({
    id: 'ranking.local_personalization_is_local_bounded_and_non_identifying',
    invariant: 'Personalization may be local and user-controlled, but it must store only preference weights and remain secondary to interpretive quality.',
    passed: highConfidencePoorFit.score > lowConfidenceStrongFit.score
      && Math.abs(lowConfidenceStrongFit.personalization.adjustment) <= lowConfidenceStrongFit.personalization.maxInfluence
      && disabledAdjustment.adjustment === 0
      && !containsRawOrIdeology
      && JSON.stringify(storedKeys) === JSON.stringify([
        'breadth',
        'depth',
        'enabled',
        'recency',
        'sampleCount',
        'schemaVersion',
        'updatedAt',
      ]),
    evidence: {
      highConfidencePoorFit: {
        score: round(highConfidencePoorFit.score),
        personalizationAdjustment: round(highConfidencePoorFit.personalization.adjustment),
        maxInfluence: round(highConfidencePoorFit.personalization.maxInfluence),
      },
      lowConfidenceStrongFit: {
        score: round(lowConfidenceStrongFit.score),
        personalizationAdjustment: round(lowConfidenceStrongFit.personalization.adjustment),
        maxInfluence: round(lowConfidenceStrongFit.personalization.maxInfluence),
      },
      disabledAdjustment: {
        adjustment: round(disabledAdjustment.adjustment),
        enabled: disabledAdjustment.enabled,
      },
      storedKeys,
      containsRawOrIdeology,
    },
    failure: 'Local personalization can overpower interpretive quality, cannot be disabled, or stores identity/raw/ideology-shaped data.',
  });
}

async function proveLocalOnlyUserDataPolicy(): Promise<AiArchitectureProof> {
  const report = validateLocalUserDataPolicy();
  const preferenceMirrorSource = readFileSync(
    join(process.cwd(), 'src/apple/cloudkit/mirror/preferenceMirror.ts'),
    'utf8',
  );
  const recoveryMirrorSource = readFileSync(
    join(process.cwd(), 'src/apple/cloudkit/mirror/recoveryMirror.ts'),
    'utf8',
  );
  const appleBridgeSource = readFileSync(
    join(process.cwd(), 'src/components/AppleEnhancementBridge.tsx'),
    'utf8',
  );
  const manifestKeys = LOCAL_USER_DATA_SURFACES.map((surface) => surface.storageKey);
  const mirroredManifestKeys = manifestKeys.filter((key) =>
    containsAny(preferenceMirrorSource, [`'${key}'`, `"${key}"`])
    || containsAny(recoveryMirrorSource, [`'${key}'`, `"${key}"`]));
  const preferenceMirrorIsNoop = /return\s*;\s*\n\s*}/.test(preferenceMirrorSource)
    && /return\s+\{\};/.test(preferenceMirrorSource);
  const recoveryMirrorIsNoop = /return\s*;\s*\n\s*}/.test(recoveryMirrorSource)
    && /return\s+null;/.test(recoveryMirrorSource);
  const bridgeUsesLocalOnlyPolicy = /REMOTE_USER_DATA_SYNC_ALLOWED/.test(appleBridgeSource)
    && /setCloudKitEnabled\(false\)/.test(appleBridgeSource);

  return proof({
    id: 'privacy.local_user_data_is_browser_local_only',
    invariant: 'App-owned content history, preferences, personalization, and diagnostic history must remain browser-local, bounded, resettable, and excluded from remote user-data sync.',
    passed: report.valid
      && REMOTE_USER_DATA_SYNC_ALLOWED === false
      && mirroredManifestKeys.length === 0
      && preferenceMirrorIsNoop
      && recoveryMirrorIsNoop
      && bridgeUsesLocalOnlyPolicy,
    evidence: {
      policyValid: report.valid,
      failures: report.failures,
      surfaceCount: report.surfaceCount,
      categories: summarizeLocalUserDataPolicy(),
      remoteUserDataSyncAllowed: REMOTE_USER_DATA_SYNC_ALLOWED,
      mirroredManifestKeys,
      preferenceMirrorIsNoop,
      recoveryMirrorIsNoop,
      bridgeUsesLocalOnlyPolicy,
    },
    failure: 'A declared user-data surface is not local-only, is not resettable/bounded, or a remote mirror path can sync app-owned user data.',
  });
}

function proof(input: {
  id: string;
  invariant: string;
  passed: boolean;
  evidence: Record<string, unknown>;
  failure: string;
}): AiArchitectureProof {
  return {
    id: input.id,
    invariant: input.invariant,
    passed: input.passed,
    evidence: input.evidence,
    ...(input.passed ? {} : { failure: input.failure }),
  };
}

function extractRouteBody(source: string, path: string): string {
  const marker = `verificationRouter.post('${path}'`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const next = source.indexOf("verificationRouter.post('", start + marker.length);
  return source.slice(start, next < 0 ? undefined : next);
}

function createVerificationOutcome(params: {
  factualState: VerificationOutcome['factualState'];
  factCheckMatched: boolean;
  contradictionLevel: number;
  corroborationLevel: number;
  sourcePresence: number;
  sourceQuality: number;
  reasons: VerificationOutcome['reasons'];
}): VerificationOutcome {
  return {
    request: {
      postUri: REPLY_URI,
      text: RAW_PROOF_TEXT,
      createdAt: '2026-04-23T12:01:00.000Z',
    },
    extractedClaims: {
      claims: [
        {
          text: RAW_PROOF_TEXT,
          claimType: 'factual_assertion',
          checkability: 0.9,
        },
      ],
    },
    factCheck: {
      matched: params.factCheckMatched,
      hits: params.factCheckMatched
        ? [
            {
              url: `https://${RAW_PROOF_DOMAIN}/fact-check`,
              matchConfidence: 0.91,
              publisher: 'Proof Publisher',
            },
          ]
        : [],
    },
    grounding: {
      sources: [
        {
          url: `https://${RAW_PROOF_DOMAIN}/report`,
          domain: RAW_PROOF_DOMAIN,
          sourceType: 'reputable_reporting',
          sourceQuality: params.sourceQuality,
          supports: params.factualState !== 'contested',
          contradicts: params.factualState === 'contested',
        },
      ],
      corroborationLevel: params.corroborationLevel,
      contradictionLevel: params.contradictionLevel,
    },
    media: null,
    claimType: 'factual_assertion',
    sourceType: 'reputable_reporting',
    sourceDomain: RAW_PROOF_DOMAIN,
    citedUrls: [`https://${RAW_PROOF_DOMAIN}/report`],
    quotedTextSpans: [],
    checkability: 0.9,
    sourcePresence: params.sourcePresence,
    sourceQuality: params.sourceQuality,
    quoteFidelity: 0,
    specificity: 0.85,
    contextValue: 0.7,
    entityGrounding: 0.7,
    correctionValue: params.reasons.includes('corrective-context') ? 0.8 : 0,
    corroborationLevel: params.corroborationLevel,
    contradictionLevel: params.contradictionLevel,
    mediaContextConfidence: 0,
    factualContributionScore: 0.9,
    factualConfidence: params.factualState === 'contested' ? 0.45 : 0.88,
    factualState: params.factualState,
    reasons: params.reasons,
    diagnostics: {
      providerFailures: [],
      latencyMs: 10,
    },
  };
}

function createProofSession(verification?: VerificationOutcome): ConversationSession {
  const rootNode = {
    uri: ROOT_URI,
    cid: 'root-cid',
    authorDid: 'did:plc:root',
    authorHandle: 'root.test',
    text: 'Proof root asks whether the evidence supports the claim.',
    createdAt: '2026-04-23T12:00:00.000Z',
    likeCount: 0,
    replyCount: 1,
    repostCount: 0,
    facets: [],
    embed: null,
    labels: [],
    depth: 0,
    replies: [],
    branchDepth: 0,
    siblingIndex: 0,
    descendantCount: 1,
  };
  const replyNode = {
    uri: REPLY_URI,
    cid: 'reply-cid',
    authorDid: RAW_PROOF_DID,
    authorHandle: 'private.test',
    text: RAW_PROOF_TEXT,
    createdAt: '2026-04-23T12:01:00.000Z',
    likeCount: 0,
    replyCount: 0,
    repostCount: 0,
    facets: [
      {
        kind: 'link',
        byteStart: 29,
        byteEnd: 60,
        uri: `https://${RAW_PROOF_DOMAIN}/report`,
        domain: RAW_PROOF_DOMAIN,
      },
    ],
    embed: null,
    labels: [],
    depth: 1,
    replies: [],
    branchDepth: 1,
    siblingIndex: 0,
    descendantCount: 0,
    contributionRole: 'source_bringer',
    contributionSignal: {
      role: 'evidence',
      roleConfidence: 0.9,
      addedInformation: true,
      evidencePresent: true,
      isRepetitive: false,
      heatContribution: 0.05,
      qualityScore: 0.72,
      interpretiveWeight: 0.7,
      viewpointClusterId: 'evidence-source',
    },
  };

  return {
    id: ROOT_URI,
    mode: 'thread',
    graph: {
      rootUri: ROOT_URI,
      nodesByUri: {
        [ROOT_URI]: rootNode,
        [REPLY_URI]: replyNode,
      },
      childUrisByParent: {
        [ROOT_URI]: [REPLY_URI],
      },
      parentUriByChild: {
        [REPLY_URI]: ROOT_URI,
      },
      subtreeEndHints: {},
    },
    structure: {
      focusedAnchorUri: ROOT_URI,
      visibleUris: [ROOT_URI, REPLY_URI],
      deferredUris: [],
      hiddenUris: [],
      revealedWarnUris: [],
      unresolvedChildCountsByUri: {},
    },
    interpretation: {
      interpolator: null,
      scoresByUri: {},
      writerResult: null,
      mediaFindings: [],
      confidence: {
        surfaceConfidence: 0.5,
        entityConfidence: 0.5,
        interpretiveConfidence: 0.5,
      },
      summaryMode: 'descriptive_fallback',
      threadState: null,
      interpretiveExplanation: null,
      premium: {
        status: 'idle',
      },
      lastComputedAt: '2026-04-23T12:02:00.000Z',
    },
    evidence: {
      verificationByUri: verification ? { [REPLY_URI]: verification } : {},
      rootVerification: null,
    },
    entities: {
      writerEntities: [],
      canonicalEntities: [],
      entityLandscape: [],
    },
    contributors: {
      contributors: [],
      topContributorDids: [],
    },
    translations: {
      byUri: {},
    },
    trajectory: {
      direction: 'clarifying',
      heatLevel: 0.05,
      repetitionLevel: 0,
      activityVelocity: 0.2,
      turningPoints: [],
      snapshots: [],
    },
    mutations: {
      revision: 0,
      recent: [],
    },
    meta: {
      status: 'ready',
      error: null,
      lastHydratedAt: '2026-04-23T12:02:00.000Z',
    },
  } as ConversationSession;
}

function createMockPost(params: {
  id: string;
  embedUrl: string;
}): MockPost {
  const domain = new URL(params.embedUrl).hostname.replace(/^www\./, '');
  return {
    id: params.id,
    author: {
      did: RAW_PROOF_DID,
      handle: 'proof.test',
      displayName: 'Proof User',
    },
    content: RAW_PROOF_TEXT,
    createdAt: '2026-04-23T12:00:00.000Z',
    likeCount: 0,
    replyCount: 0,
    repostCount: 0,
    bookmarkCount: 0,
    chips: [],
    embed: {
      type: 'external',
      url: params.embedUrl,
      title: 'Proof source',
      description: 'Proof source description',
      domain,
    },
  };
}

function pickFactors(factors: ReturnType<typeof computeInterpretiveFactors>['factors']): Record<string, number> {
  return {
    evidenceAdequacy: round(factors.evidenceAdequacy),
    sourceIntegritySupport: round(factors.sourceIntegritySupport),
    contradictionPenalty: round(factors.contradictionPenalty),
    signalAgreement: round(factors.signalAgreement),
  };
}

function containsAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
