import type { MediaAnalysisRequest, MediaAnalysisResult } from '../llmContracts';
import { clamp01 } from '../context/limits';
import { assembleMediaEvidence } from './mediaEvidenceAssembler';
import { classifyMedia } from './mediaClassifier';
import { classifyMediaCentrality } from './mediaCentrality';
import { detectMediaTextDisagreement } from './mediaDisagreement';

const MEDIA_TYPE_HINT_PATTERNS: Record<MediaAnalysisResult['mediaType'], RegExp> = {
  screenshot: /\b(?:screenshot|screen shot|screencap|ui|interface|dashboard|settings|tweet|post|notification panel)\b/i,
  chart: /\b(?:chart|graph|plot|trend|analytics|dashboard|bar chart|line chart|scatter plot|table)\b/i,
  document: /\b(?:document|memo|policy|report|article|letter|form|contract|invoice|pdf|paper|draft)\b/i,
  photo: /\b(?:photo|photograph|portrait|landscape|close-up|scene)\b/i,
  meme: /\b(?:meme|reaction image|captioned image|joke image)\b/i,
  unknown: /.^/,
};

const GENERIC_SUMMARY_PATTERNS = [
  /^a (?:photo|picture|image)\b/i,
  /^an image\b/i,
  /^photo of\b/i,
  /^image of\b/i,
  /^media present\b/i,
];

function sanitizeMediaText(value: string | undefined, maxLength: number): string {
  return (value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function ensureSentence(value: string): string {
  if (!value) return '';
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function dedupeStrings(values: Array<string | undefined>, limit: number, maxLength: number): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = sanitizeMediaText(value, maxLength);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (unique.has(key)) continue;
    unique.add(key);
    if (unique.size >= limit) break;
  }
  return [...unique].map((value) => {
    const original = values.find((candidate) => sanitizeMediaText(candidate, maxLength).toLowerCase() === value);
    return sanitizeMediaText(original, maxLength);
  });
}

function normalizeEntityToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferMediaTypeFromText(hintText: string): MediaAnalysisResult['mediaType'] | null {
  const sanitized = sanitizeMediaText(hintText, 500);
  if (!sanitized) return null;

  for (const mediaType of ['screenshot', 'chart', 'document', 'meme', 'photo'] as const) {
    if (MEDIA_TYPE_HINT_PATTERNS[mediaType].test(sanitized)) {
      return mediaType;
    }
  }

  return null;
}

function resolveMediaType(
  request: MediaAnalysisRequest,
  result: MediaAnalysisResult,
  classification: ReturnType<typeof classifyMedia>,
): MediaAnalysisResult['mediaType'] {
  const textualHint = inferMediaTypeFromText([
    request.mediaAlt,
    request.nearbyText,
    result.mediaSummary,
    result.extractedText,
  ].filter(Boolean).join(' '));

  if (textualHint && textualHint !== 'photo' && (result.mediaType === 'photo' || result.mediaType === 'unknown')) {
    return textualHint;
  }

  if (result.mediaType === 'unknown' && classification.kind !== 'unknown') {
    return classification.kind;
  }

  return result.mediaType;
}

function looksGenericSummary(value: string): boolean {
  const sanitized = sanitizeMediaText(value, 220);
  if (!sanitized) return true;
  return GENERIC_SUMMARY_PATTERNS.some((pattern) => pattern.test(sanitized));
}

function mediaTypeLabel(mediaType: MediaAnalysisResult['mediaType']): string {
  switch (mediaType) {
    case 'document':
      return 'document';
    case 'screenshot':
      return 'screenshot';
    case 'chart':
      return 'chart';
    case 'meme':
      return 'meme';
    case 'photo':
      return 'photo';
    default:
      return 'image';
  }
}

function buildFallbackSummary(params: {
  mediaType: MediaAnalysisResult['mediaType'];
  extractedText?: string;
  nearbyText?: string;
  isClaimCarrier: boolean;
}): string {
  const mediaLabel = mediaTypeLabel(params.mediaType);
  const extractedText = sanitizeMediaText(params.extractedText, 120);
  if (extractedText) {
    return ensureSentence(`A ${mediaLabel} with visible text related to the thread.`);
  }

  const nearbyText = sanitizeMediaText(params.nearbyText, 160);
  if (params.isClaimCarrier && nearbyText) {
    return ensureSentence(`A ${mediaLabel} that appears central to the thread's claim.`);
  }

  return ensureSentence(`A ${mediaLabel} related to the thread.`);
}

function extractRelevantCandidateEntities(
  request: MediaAnalysisRequest,
  result: MediaAnalysisResult,
  isClaimCarrier: boolean,
): string[] {
  const hintText = normalizeEntityToken([
    request.nearbyText,
    request.mediaAlt,
    result.mediaSummary,
    result.extractedText,
  ].filter(Boolean).join(' '));

  const universe = dedupeStrings([
    ...result.candidateEntities,
    ...request.candidateEntities,
  ], 8, 80);

  const matched = universe.filter((candidate) => {
    const normalized = normalizeEntityToken(candidate);
    if (!normalized) return false;
    if (hintText.includes(normalized)) return true;
    return normalized
      .split(' ')
      .filter(Boolean)
      .every((token) => token.length >= 3 && hintText.includes(token));
  });

  if (matched.length > 0) {
    return matched.slice(0, 5);
  }

  if (isClaimCarrier && request.candidateEntities.length === 1) {
    return dedupeStrings(request.candidateEntities, 1, 80);
  }

  return [];
}

function normalizeSummary(
  request: MediaAnalysisRequest,
  result: MediaAnalysisResult,
  mediaType: MediaAnalysisResult['mediaType'],
  isClaimCarrier: boolean,
): string {
  const sanitized = ensureSentence(sanitizeMediaText(result.mediaSummary, 280));
  if (sanitized && !looksGenericSummary(sanitized)) {
    return sanitized;
  }

  return buildFallbackSummary({
    mediaType,
    ...(result.extractedText ? { extractedText: result.extractedText } : {}),
    ...(request.nearbyText ? { nearbyText: request.nearbyText } : {}),
    isClaimCarrier,
  });
}

function buildCaptionFallbackConfidence(classification: ReturnType<typeof classifyMedia>, summary: string): number {
  const detailBoost = sanitizeMediaText(summary, 240).split(/\s+/).filter(Boolean).length >= 8 ? 0.05 : 0;
  const claimCarrierBoost = classification.isClaimCarrier ? 0.08 : 0;
  const textHeavyBoost = classification.isTextHeavy ? 0.06 : 0;
  return clamp01(Math.min(
    0.55,
    0.18 + (classification.confidence * 0.28) + detailBoost + claimCarrierBoost + textHeavyBoost,
  ));
}

export function refineMediaAnalysisResult(
  request: MediaAnalysisRequest,
  result: MediaAnalysisResult,
): MediaAnalysisResult {
  const classification = classifyMedia(
    request.mediaUrl,
    undefined,
    request.mediaAlt,
    [request.nearbyText, result.mediaSummary, result.extractedText].filter(Boolean).join(' '),
  );
  const mediaType = resolveMediaType(request, result, classification);
  const normalizedSummary = normalizeSummary(
    request,
    result,
    mediaType,
    classification.isClaimCarrier,
  );
  const normalizedEntities = extractRelevantCandidateEntities(
    request,
    { ...result, mediaType, mediaSummary: normalizedSummary },
    classification.isClaimCarrier,
  );

  const disagreement = detectMediaTextDisagreement(
    request.nearbyText,
    result.extractedText,
    normalizedSummary,
    result.confidence,
    result.cautionFlags,
  );
  const useHeuristicCentrality =
    mediaType !== result.mediaType
    && result.mediaCentrality < 0.45;
  const centrality = classifyMediaCentrality(
    mediaType,
    classification.isClaimCarrier,
    classification.isTextHeavy,
    request.nearbyText,
    sanitizeMediaText(request.nearbyText, 400).length < 80,
    useHeuristicCentrality ? undefined : result.mediaCentrality,
  );
  const evidence = assembleMediaEvidence(
    classification,
    centrality,
    disagreement,
    {
      ...result,
      mediaType,
      mediaSummary: normalizedSummary,
      candidateEntities: normalizedEntities,
    },
  );

  const confidence = evidence.suppressConfidentClaims
    ? Math.min(evidence.confidence, 0.48)
    : evidence.confidence;
  const extractedText = sanitizeMediaText(
    evidence.normalizedOcr || result.extractedText,
    500,
  );
  const cautionFlags = dedupeStrings(
    [...evidence.cautionFlags, ...result.cautionFlags],
    6,
    80,
  );
  const candidateEntities = evidence.candidateEntities.length > 0
    ? evidence.candidateEntities.slice(0, 5)
    : normalizedEntities.slice(0, 5);

  return {
    mediaCentrality: centrality.score,
    mediaType,
    mediaSummary: evidence.mediaSummary || normalizedSummary,
    candidateEntities,
    confidence,
    cautionFlags,
    ...(result.moderation ? { moderation: result.moderation } : {}),
    ...(extractedText ? { extractedText } : {}),
  };
}

export function buildCaptionFallbackMediaAnalysis(
  request: MediaAnalysisRequest,
  caption: string,
): MediaAnalysisResult {
  const classification = classifyMedia(
    request.mediaUrl,
    undefined,
    request.mediaAlt,
    [request.nearbyText, caption].filter(Boolean).join(' '),
  );
  const summary = ensureSentence(sanitizeMediaText(caption, 240))
    || buildFallbackSummary({
      mediaType: classification.kind,
      nearbyText: request.nearbyText,
      isClaimCarrier: classification.isClaimCarrier,
    });
  const provisional: MediaAnalysisResult = {
    mediaCentrality: classification.isClaimCarrier
      ? 0.72
      : classification.isTextHeavy
        ? 0.52
        : 0.32,
    mediaType: classification.kind,
    mediaSummary: summary,
    candidateEntities: [],
    confidence: buildCaptionFallbackConfidence(classification, summary),
    cautionFlags: [],
  };

  return refineMediaAnalysisResult(request, provisional);
}
