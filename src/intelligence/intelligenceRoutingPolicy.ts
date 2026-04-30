export type IntelligenceLane =
  | 'browser_heuristic'
  | 'browser_small_ml'
  | 'edge_classifier'
  | 'edge_reranker'
  | 'server_writer'
  | 'premium_provider'
  | 'browser_experimental';

export type IntelligenceTask =
  | 'composer_instant'
  | 'composer_refine'
  | 'composer_writer'
  | 'local_search'
  | 'public_search'
  | 'media_analysis'
  | 'story_summary';

export type PrivacyMode = 'local_only' | 'balanced' | 'cloud_enhanced';
export type DataScope = 'private_draft' | 'private_corpus' | 'local_cache' | 'public_corpus';
export type DeviceTier = 'low' | 'mid' | 'high';

export interface IntelligenceRoutingInput {
  task: IntelligenceTask;
  privacyMode?: PrivacyMode;
  dataScope?: DataScope;
  deviceTier?: DeviceTier;
  deviceMemoryGiB?: number | null;
  isMobile?: boolean;
  localSmallMlAvailable?: boolean;
  edgeAvailable?: boolean;
  premiumAvailable?: boolean;
  explicitUserAction?: boolean;
  browserExperimentalEnabled?: boolean;
  localSearchQuality?: LocalSearchQuality | null;
}

export interface IntelligenceRoutingDecision {
  task: IntelligenceTask;
  lane: IntelligenceLane;
  fallbackLane?: IntelligenceLane;
  reasonCode:
    | 'browser_heuristic_instant'
    | 'browser_small_ml_default'
    | 'browser_small_ml_private_search'
    | 'browser_small_ml_high_quality_local'
    | 'browser_experimental_opt_in_only'
    | 'edge_classifier_balanced_refine'
    | 'edge_reranker_public_scope'
    | 'edge_reranker_low_local_quality'
    | 'server_writer_selective'
    | 'premium_provider_explicit_best_quality'
    | 'local_only_privacy'
    | 'edge_unavailable_fallback'
    | 'device_too_constrained'
    | 'unsupported_task';
  sendsPrivateText: boolean;
  requiresConsent: boolean;
  maxPayloadChars: number;
}

export interface LocalSearchQualityInput {
  rows: Array<Record<string, unknown>>;
  resultLimit: number;
  localIndexCoverage?: number | null;
}

export interface LocalSearchQuality {
  topScore: number;
  topMargin: number;
  resultCount: number;
  lexicalSemanticAgreement: number;
  localIndexCoverage: number | null;
  confidence: number;
}

type DecisionOptions = Partial<Omit<IntelligenceRoutingDecision, 'task' | 'lane' | 'reasonCode' | 'fallbackLane'>> & {
  fallbackLane?: IntelligenceLane | undefined;
};

const DEFAULT_PRIVACY_MODE: PrivacyMode = 'balanced';
const DEFAULT_LOCAL_INDEX_COVERAGE = 0.5;
const MIN_BROWSER_EXPERIMENT_MEMORY_GIB = 8;
const HIGH_LOCAL_SEARCH_CONFIDENCE = 0.72;
const LOW_LOCAL_SEARCH_CONFIDENCE = 0.48;
const LOCAL_SEARCH_QUALITY_WEIGHTS = {
  topScore: 0.42,
  topMargin: 0.18,
  resultCoverage: 0.16,
  lexicalSemanticAgreement: 0.16,
  localIndexCoverage: 0.08,
} as const;

export function chooseIntelligenceLane(
  input: IntelligenceRoutingInput,
): IntelligenceRoutingDecision {
  const privacyMode = input.privacyMode ?? DEFAULT_PRIVACY_MODE;
  const dataScope = input.dataScope ?? defaultDataScopeForTask(input.task);

  if (input.task === 'composer_instant') {
    return decision(input.task, 'browser_heuristic', 'browser_heuristic_instant', {
      sendsPrivateText: false,
      maxPayloadChars: 0,
    });
  }

  if (input.task === 'local_search') {
    return chooseLocalSearchLane(input, privacyMode, dataScope);
  }

  if (input.task === 'public_search') {
    return choosePublicSearchLane(input, privacyMode);
  }

  if (input.task === 'composer_refine') {
    return chooseComposerRefineLane(input, privacyMode);
  }

  if (input.task === 'composer_writer') {
    return chooseComposerWriterLane(input, privacyMode);
  }

  if (input.task === 'media_analysis') {
    if (privacyMode === 'local_only') {
      return decision(input.task, 'browser_heuristic', 'local_only_privacy', {
        sendsPrivateText: false,
        maxPayloadChars: 0,
      });
    }
    return decision(input.task, 'edge_classifier', 'edge_classifier_balanced_refine', {
      sendsPrivateText: false,
      requiresConsent: privacyMode !== 'cloud_enhanced',
      maxPayloadChars: 800,
    });
  }

  if (input.task === 'story_summary') {
    if (input.premiumAvailable && input.explicitUserAction) {
      return decision(input.task, 'premium_provider', 'premium_provider_explicit_best_quality', {
        sendsPrivateText: false,
        requiresConsent: privacyMode !== 'cloud_enhanced',
        maxPayloadChars: 8_000,
      });
    }
    return decision(input.task, 'server_writer', 'server_writer_selective', {
      sendsPrivateText: false,
      maxPayloadChars: 6_000,
    });
  }

  return decision(input.task, 'browser_heuristic', 'unsupported_task', {
    sendsPrivateText: false,
    maxPayloadChars: 0,
  });
}

export function evaluateLocalSearchQuality(input: LocalSearchQualityInput): LocalSearchQuality {
  const rows = input.rows.slice(0, Math.max(0, input.resultLimit));
  const resultCount = rows.length;
  const scores = rows.map(getRowConfidenceScore).sort((left, right) => right - left);
  const topScore = scores[0] ?? 0;
  const secondScore = scores[1] ?? 0;
  const topMargin = Math.max(0, topScore - secondScore);
  const resultCoverage = input.resultLimit > 0
    ? Math.min(1, resultCount / input.resultLimit)
    : 0;
  const lexicalSemanticAgreement = computeLexicalSemanticAgreement(rows);
  const localIndexCoverage = normalizeOptionalUnit(input.localIndexCoverage);

  const weighted =
    LOCAL_SEARCH_QUALITY_WEIGHTS.topScore * topScore
    + LOCAL_SEARCH_QUALITY_WEIGHTS.topMargin * clampUnit(topMargin * 2)
    + LOCAL_SEARCH_QUALITY_WEIGHTS.resultCoverage * resultCoverage
    + LOCAL_SEARCH_QUALITY_WEIGHTS.lexicalSemanticAgreement * lexicalSemanticAgreement
    + LOCAL_SEARCH_QUALITY_WEIGHTS.localIndexCoverage * (localIndexCoverage ?? DEFAULT_LOCAL_INDEX_COVERAGE);

  return {
    topScore: round3(topScore),
    topMargin: round3(topMargin),
    resultCount,
    lexicalSemanticAgreement: round3(lexicalSemanticAgreement),
    localIndexCoverage,
    confidence: round3(weighted),
  };
}

export function shouldEscalateLocalSearchToEdge(
  quality: LocalSearchQuality,
  options: {
    privacyMode?: PrivacyMode;
    dataScope?: DataScope;
    edgeAvailable?: boolean;
  } = {},
): boolean {
  const privacyMode = options.privacyMode ?? DEFAULT_PRIVACY_MODE;
  const dataScope = options.dataScope ?? 'local_cache';
  if (privacyMode === 'local_only') return false;
  if (dataScope === 'private_corpus' || dataScope === 'private_draft') return false;
  if (options.edgeAvailable === false) return false;
  return quality.confidence < HIGH_LOCAL_SEARCH_CONFIDENCE;
}

export function isBrowserExperimentalAllowed(input: Pick<
  IntelligenceRoutingInput,
  'browserExperimentalEnabled' | 'deviceMemoryGiB' | 'deviceTier' | 'isMobile'
>): boolean {
  if (!input.browserExperimentalEnabled) return false;
  if (input.isMobile) return false;
  if (input.deviceTier === 'low') return false;
  if (input.deviceMemoryGiB !== null && input.deviceMemoryGiB !== undefined) {
    return input.deviceMemoryGiB >= MIN_BROWSER_EXPERIMENT_MEMORY_GIB;
  }
  return input.deviceTier === 'high';
}

function chooseLocalSearchLane(
  input: IntelligenceRoutingInput,
  privacyMode: PrivacyMode,
  dataScope: DataScope,
): IntelligenceRoutingDecision {
  if (input.localSmallMlAvailable === false) {
    return decision('local_search', 'browser_heuristic', 'device_too_constrained', {
      fallbackLane: privacyMode === 'local_only' ? undefined : 'edge_reranker',
      sendsPrivateText: false,
      requiresConsent: false,
      maxPayloadChars: 0,
    });
  }

  if (dataScope === 'private_corpus' || dataScope === 'private_draft' || privacyMode === 'local_only') {
    return decision('local_search', 'browser_small_ml', 'browser_small_ml_private_search', {
      sendsPrivateText: false,
      maxPayloadChars: 0,
    });
  }

  const quality = input.localSearchQuality;
  if (!quality || quality.confidence >= HIGH_LOCAL_SEARCH_CONFIDENCE) {
    return decision('local_search', 'browser_small_ml', 'browser_small_ml_high_quality_local', {
      fallbackLane: 'edge_reranker',
      sendsPrivateText: false,
      maxPayloadChars: 0,
    });
  }

  if (quality.confidence < LOW_LOCAL_SEARCH_CONFIDENCE && input.edgeAvailable !== false) {
    return decision('local_search', 'edge_reranker', 'edge_reranker_low_local_quality', {
      fallbackLane: 'browser_small_ml',
      sendsPrivateText: false,
      requiresConsent: privacyMode !== 'cloud_enhanced',
      maxPayloadChars: 280,
    });
  }

  return decision('local_search', 'browser_small_ml', 'browser_small_ml_default', {
    fallbackLane: input.edgeAvailable === false ? undefined : 'edge_reranker',
    sendsPrivateText: false,
    maxPayloadChars: 0,
  });
}

function choosePublicSearchLane(
  input: IntelligenceRoutingInput,
  privacyMode: PrivacyMode,
): IntelligenceRoutingDecision {
  if (privacyMode === 'local_only' || input.edgeAvailable === false) {
    return decision('public_search', 'browser_small_ml', 'local_only_privacy', {
      sendsPrivateText: false,
      maxPayloadChars: 0,
    });
  }

  if (input.localSearchQuality && input.localSearchQuality.confidence >= HIGH_LOCAL_SEARCH_CONFIDENCE) {
    return decision('public_search', 'browser_small_ml', 'browser_small_ml_high_quality_local', {
      fallbackLane: 'edge_reranker',
      sendsPrivateText: false,
      maxPayloadChars: 0,
    });
  }

  return decision('public_search', 'edge_reranker', 'edge_reranker_public_scope', {
    fallbackLane: 'browser_small_ml',
    sendsPrivateText: false,
    maxPayloadChars: 280,
  });
}

function chooseComposerRefineLane(
  input: IntelligenceRoutingInput,
  privacyMode: PrivacyMode,
): IntelligenceRoutingDecision {
  if (isBrowserExperimentalAllowed(input)) {
    return decision('composer_refine', 'browser_experimental', 'browser_experimental_opt_in_only', {
      fallbackLane: input.edgeAvailable === false ? 'browser_heuristic' : 'edge_classifier',
      sendsPrivateText: false,
      maxPayloadChars: 0,
    });
  }

  if (privacyMode === 'local_only') {
    return decision('composer_refine', 'browser_heuristic', 'local_only_privacy', {
      sendsPrivateText: false,
      maxPayloadChars: 0,
    });
  }

  if (input.edgeAvailable === false) {
    return decision('composer_refine', 'browser_heuristic', 'edge_unavailable_fallback', {
      sendsPrivateText: false,
      maxPayloadChars: 0,
    });
  }

  return decision('composer_refine', 'edge_classifier', 'edge_classifier_balanced_refine', {
    fallbackLane: 'browser_heuristic',
    sendsPrivateText: true,
    requiresConsent: privacyMode !== 'cloud_enhanced',
    maxPayloadChars: 1_200,
  });
}

function chooseComposerWriterLane(
  input: IntelligenceRoutingInput,
  privacyMode: PrivacyMode,
): IntelligenceRoutingDecision {
  if (privacyMode === 'local_only') {
    return decision('composer_writer', 'browser_heuristic', 'local_only_privacy', {
      sendsPrivateText: false,
      maxPayloadChars: 0,
    });
  }

  if (input.edgeAvailable === false) {
    return decision('composer_writer', 'browser_heuristic', 'edge_unavailable_fallback', {
      sendsPrivateText: false,
      maxPayloadChars: 0,
    });
  }

  return decision('composer_writer', 'server_writer', 'server_writer_selective', {
    fallbackLane: 'browser_heuristic',
    sendsPrivateText: true,
    requiresConsent: privacyMode !== 'cloud_enhanced',
    maxPayloadChars: 1_200,
  });
}

function decision(
  task: IntelligenceTask,
  lane: IntelligenceLane,
  reasonCode: IntelligenceRoutingDecision['reasonCode'],
  options: DecisionOptions = {},
): IntelligenceRoutingDecision {
  return {
    task,
    lane,
    reasonCode,
    sendsPrivateText: options.sendsPrivateText ?? false,
    requiresConsent: options.requiresConsent ?? false,
    maxPayloadChars: options.maxPayloadChars ?? 0,
    ...(options.fallbackLane ? { fallbackLane: options.fallbackLane } : {}),
  };
}

function defaultDataScopeForTask(task: IntelligenceTask): DataScope {
  if (task === 'composer_instant' || task === 'composer_refine' || task === 'composer_writer') {
    return 'private_draft';
  }
  if (task === 'public_search' || task === 'story_summary' || task === 'media_analysis') {
    return 'public_corpus';
  }
  return 'local_cache';
}

function getRowConfidenceScore(row: Record<string, unknown>): number {
  const confidence = Number(row.confidence_score ?? row.fused_score ?? 0);
  return Number.isFinite(confidence) ? clampUnit(confidence) : 0;
}

function computeLexicalSemanticAgreement(rows: Array<Record<string, unknown>>): number {
  if (rows.length === 0) return 0;

  const usable = rows.slice(0, 10).filter((row) => {
    const lexical = Number(row.fts_rank_raw ?? 0);
    const semanticMatched = Number(row.semantic_matched ?? 0) === 1;
    const semanticDistance = Number(row.semantic_distance ?? Number.POSITIVE_INFINITY);
    return lexical > 0 && semanticMatched && Number.isFinite(semanticDistance) && semanticDistance < 1;
  });

  return clampUnit(usable.length / Math.min(rows.length, 10));
}

function normalizeOptionalUnit(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return clampUnit(value);
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round3(value: number): number {
  return Math.round(clampUnit(value) * 1000) / 1000;
}
