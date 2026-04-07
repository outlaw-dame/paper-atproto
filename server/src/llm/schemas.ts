import { z } from 'zod';

export const SummaryModeSchema = z.enum(['normal', 'descriptive_fallback', 'minimal_fallback']);

export const ConfidenceSchema = z.object({
  surfaceConfidence: z.number().min(0).max(1),
  entityConfidence: z.number().min(0).max(1),
  interpretiveConfidence: z.number().min(0).max(1),
});

export const WriterEntitySchema = z.object({
  id: z.string(),
  label: z.string().max(120),
  type: z.string(),
  confidence: z.number().min(0).max(1),
  impact: z.number().min(0).max(1),
});

export const WriterCommentSchema = z.object({
  uri: z.string(),
  handle: z.string().max(100),
  displayName: z.string().max(120).optional(),
  text: z.string().max(300),
  impactScore: z.number().min(0).max(1),
  role: z.string().optional(),
  liked: z.number().int().optional(),
  replied: z.number().int().optional(),
});

export const WriterContributorSchema = z.object({
  did: z.string().optional(),
  handle: z.string().max(100),
  role: z.string(),
  impactScore: z.number().min(0).max(1),
  stanceSummary: z.string().max(200),
  stanceExcerpt: z.string().max(220).optional(),
  resonance: z.enum(['high', 'moderate', 'emerging']).optional(),
  agreementSignal: z.string().max(120).optional(),
});

export const ThreadStateSchema = z.object({
  threadId: z.string().max(300),
  summaryMode: SummaryModeSchema,
  confidence: ConfidenceSchema,
  visibleReplyCount: z.number().int().min(0).max(5000).optional(),
  rootPost: z.object({
    uri: z.string(),
    handle: z.string().max(100),
    displayName: z.string().max(120).optional(),
    text: z.string().max(600),
    createdAt: z.string(),
  }),
  selectedComments: z.array(WriterCommentSchema).max(12),
  topContributors: z.array(WriterContributorSchema).max(6),
  safeEntities: z.array(WriterEntitySchema).max(10),
  factualHighlights: z.array(z.string().max(200)).max(6),
  whatChangedSignals: z.array(z.string().max(150)).max(8),
  mediaFindings: z.array(z.object({
    mediaType: z.string(),
    summary: z.string().max(300),
    confidence: z.number(),
    extractedText: z.string().max(500).optional(),
    cautionFlags: z.array(z.string()).optional(),
  })).max(3).optional(),
  threadSignalSummary: z.object({
    newAnglesCount: z.number().int().min(0).max(50),
    clarificationsCount: z.number().int().min(0).max(50),
    sourceBackedCount: z.number().int().min(0).max(50),
    factualSignalPresent: z.boolean(),
    evidencePresent: z.boolean(),
  }).optional(),
  interpretiveExplanation: z.string().max(240).optional(),
});

export const WriterResponseSchema = z.object({
  collapsedSummary: z.string(),
  expandedSummary: z.string().optional(),
  whatChanged: z.array(z.string()),
  contributorBlurbs: z.array(z.object({
    handle: z.string(),
    blurb: z.string(),
  })),
  abstained: z.boolean(),
  mode: SummaryModeSchema,
});

export const MediaRequestSchema = z.object({
  threadId: z.string().max(300),
  mediaUrl: z.string().url().max(1000),
  mediaAlt: z.string().max(300).optional(),
  nearbyText: z.string().max(400),
  candidateEntities: z.array(z.string().max(80)).max(10),
  factualHints: z.array(z.string().max(120)).max(5),
});

export const MediaResponseSchema = z.object({
  mediaCentrality: z.number().min(0).max(1),
  mediaType: z.enum(['screenshot', 'chart', 'document', 'photo', 'meme', 'unknown']),
  extractedText: z.string().max(500).optional(),
  mediaSummary: z.string().max(320),
  candidateEntities: z.array(z.string().max(80)).max(5),
  confidence: z.number().min(0).max(1),
  cautionFlags: z.array(z.string().max(40)).max(8),
});

export const ExploreSynopsisSchema = z.object({
  storyId: z.string().max(300),
  titleHint: z.string().max(200).optional(),
  candidatePosts: z.array(z.object({
    uri: z.string(),
    handle: z.string().max(100),
    text: z.string().max(300),
    impactScore: z.number(),
  })).max(10),
  safeEntities: z.array(WriterEntitySchema).max(8),
  factualHighlights: z.array(z.string().max(200)).max(5),
  mediaFindings: z.array(z.object({
    mediaType: z.string(),
    summary: z.string().max(300),
    confidence: z.number(),
    extractedText: z.string().max(500).optional(),
    cautionFlags: z.array(z.string()).optional(),
  })).max(3).optional(),
  confidence: ConfidenceSchema,
});

export const ExploreSynopsisResponseSchema = z.object({
  synopsis: z.string(),
  shortSynopsis: z.string().optional(),
  abstained: z.boolean(),
});

export const ComposerGuidanceSchema = z.object({
  mode: z.enum(['post', 'reply', 'hosted_thread']),
  draftText: z.string().min(1).max(1200),
  parentText: z.string().max(500).optional(),
  uiState: z.enum(['positive', 'caution', 'warning']),
  scores: z.object({
    positiveSignal: z.number().min(0).max(1),
    negativeSignal: z.number().min(0).max(1),
    supportiveness: z.number().min(0).max(1),
    constructiveness: z.number().min(0).max(1),
    clarifying: z.number().min(0).max(1),
    hostility: z.number().min(0).max(1),
    dismissiveness: z.number().min(0).max(1),
    escalation: z.number().min(0).max(1),
    sentimentPositive: z.number().min(0).max(1),
    sentimentNegative: z.number().min(0).max(1),
    anger: z.number().min(0).max(1),
    trust: z.number().min(0).max(1),
    optimism: z.number().min(0).max(1),
    targetedNegativity: z.number().min(0).max(1),
    toxicity: z.number().min(0).max(1),
  }),
  constructiveSignals: z.array(z.string().max(200)).max(4),
  supportiveSignals: z.array(z.string().max(200)).max(4),
  parentSignals: z.array(z.string().max(200)).max(4),
});

export const ComposerGuidanceResponseSchema = z.object({
  message: z.string().max(110),
  suggestion: z.string().max(120).optional(),
  badges: z.array(z.string().max(20)).max(3),
});

export const PremiumInterpolatorSchema = z.object({
  actorDid: z.string().min(1).max(200),
  threadId: z.string().max(300),
  summaryMode: SummaryModeSchema,
  confidence: ConfidenceSchema,
  visibleReplyCount: z.number().int().min(0).max(5000).optional(),
  rootPost: z.object({
    uri: z.string(),
    handle: z.string().max(100),
    displayName: z.string().max(120).optional(),
    text: z.string().max(600),
    createdAt: z.string(),
  }),
  selectedComments: z.array(WriterCommentSchema).max(12),
  topContributors: z.array(WriterContributorSchema).max(6),
  safeEntities: z.array(WriterEntitySchema).max(10),
  factualHighlights: z.array(z.string().max(200)).max(6),
  whatChangedSignals: z.array(z.string().max(150)).max(8),
  interpretiveBrief: z.object({
    summaryMode: SummaryModeSchema,
    baseSummary: z.string().max(400).optional(),
    dominantTone: z.string().max(80).optional(),
    conversationPhase: z.string().max(80).optional(),
    supports: z.array(z.string().max(160)).max(6),
    limits: z.array(z.string().max(160)).max(6),
  }),
});

export const PremiumDeepInterpolatorResponseSchema = z.object({
  summary: z.string().max(420),
  groundedContext: z.string().max(260).optional(),
  perspectiveGaps: z.array(z.string().max(120)).max(3),
  followUpQuestions: z.array(z.string().max(120)).max(3),
  confidence: z.number().min(0).max(1),
  provider: z.literal('gemini'),
  updatedAt: z.string(),
});
