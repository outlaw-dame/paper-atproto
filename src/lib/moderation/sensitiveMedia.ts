import type { MockPost } from '../../data/mockData';
import type {
  MediaAnalysisResult,
  MediaModerationAction,
} from '../../intelligence/llmContracts';

export interface RawContentLabel {
  val: string;
  src?: string;
  neg: boolean;
}

const CATEGORY_KEYWORDS = {
  sexual: ['porn', 'sexual', 'sex', 'adult'] as const,
  nudity: ['nudity', 'nude', 'explicit-nudity'] as const,
  graphicViolence: ['graphic-media', 'graphic-violence', 'gore', 'violence', 'blood'] as const,
} as const;

const HATE_SPEECH_REASON = 'hate-speech';
const GENERIC_SENSITIVE_REASON = 'sensitive-content';
const MULTIMODAL_REASON_SET = new Set([
  'sensitive-content',
  'sexual-content',
  'nudity',
  'graphic-violence',
  'extreme-graphic-violence',
  'self-harm',
  'hate-symbols',
  'hate-speech',
  'child-safety',
]);

// Intentionally narrow, severe-term detector to reduce false positives.
const HATE_SPEECH_PATTERNS = [
  /\bn[\W_]*i[\W_]*g[\W_]*g[\W_]*(?:a|er|r)\b/gi,
] as const;

export interface SensitiveMediaAssessment {
  isSensitive: boolean;
  reasons: string[];
  action: MediaModerationAction;
  allowReveal: boolean;
  rationale?: string;
  source: 'label' | 'post' | 'multimodal' | 'hybrid';
}

export const EMPTY_SENSITIVE_MEDIA_ASSESSMENT: SensitiveMediaAssessment = {
  isSensitive: false,
  reasons: [],
  action: 'none',
  allowReveal: true,
  source: 'label',
};

export function createUnavailableSensitiveMediaAssessment(): SensitiveMediaAssessment {
  return normalizeAssessment({
    reasons: [GENERIC_SENSITIVE_REASON],
    action: 'warn',
    allowReveal: true,
    rationale: 'Automatic media moderation is temporarily unavailable.',
  }, 'multimodal');
}

type SensitiveMediaAssessmentInput = {
  reasons?: string[] | undefined;
  action?: MediaModerationAction | undefined;
  allowReveal?: boolean | undefined;
  rationale?: string | undefined;
};

const ACTION_PRIORITY: Record<MediaModerationAction, number> = {
  none: 0,
  warn: 1,
  blur: 2,
  drop: 3,
};

const DROP_REASON_SET = new Set(['child-safety', 'extreme-graphic-violence']);
const BLUR_REASON_SET = new Set([
  'sexual',
  'sexual-content',
  'nudity',
  'graphicviolence',
  'graphic-violence',
  'extreme-graphic-violence',
  'self-harm',
  'hate-symbols',
  'child-safety',
]);

function normalizeToken(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9:_-]/g, '')
    .slice(0, 64);
}

function sanitizeReasons(values: string[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = normalizeToken(value);
    if (!normalized) continue;
    unique.add(normalized);
    if (unique.size >= 6) break;
  }
  return [...unique];
}

function isSensitiveLabel(value: string): boolean {
  const normalized = normalizeToken(value);
  if (!normalized) return false;
  const allKeywords = [
    ...CATEGORY_KEYWORDS.sexual,
    ...CATEGORY_KEYWORDS.nudity,
    ...CATEGORY_KEYWORDS.graphicViolence,
  ];
  return allKeywords.some((token) => normalized.includes(token));
}

function isSensitiveReason(value: string): boolean {
  const normalized = normalizeToken(value);
  return normalized === HATE_SPEECH_REASON
    || MULTIMODAL_REASON_SET.has(normalized)
    || isSensitiveLabel(normalized);
}

function deriveActionFromReasons(reasons: string[]): MediaModerationAction {
  const normalizedReasons = reasons.map((reason) => normalizeToken(reason));
  if (normalizedReasons.some((reason) => DROP_REASON_SET.has(reason))) return 'drop';
  if (normalizedReasons.some((reason) => BLUR_REASON_SET.has(reason) || isSensitiveLabel(reason))) return 'blur';
  if (normalizedReasons.includes(GENERIC_SENSITIVE_REASON)) return 'warn';
  if (normalizedReasons.includes(HATE_SPEECH_REASON)) return 'warn';
  return 'none';
}

function sanitizeRationale(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const next = value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return next || undefined;
}

function normalizeAssessment(
  assessment: SensitiveMediaAssessmentInput,
  source: SensitiveMediaAssessment['source'],
): SensitiveMediaAssessment {
  const reasons = sanitizeReasons(assessment.reasons ?? []);
  const inferredAction = deriveActionFromReasons(reasons);
  const action = assessment.action && ACTION_PRIORITY[assessment.action] >= ACTION_PRIORITY[inferredAction]
    ? assessment.action
    : inferredAction;
  const isSensitive = action !== 'none';
  const rationale = sanitizeRationale(assessment.rationale);

  return {
    isSensitive,
    reasons,
    action,
    allowReveal: action !== 'drop' && assessment.allowReveal !== false,
    ...(rationale ? { rationale } : {}),
    source,
  };
}

function hasPotentialHateSpeechText(value: string | undefined): boolean {
  if (!value) return false;
  return HATE_SPEECH_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

export function redactPotentialHateSpeechText(value: string): string {
  if (!value) return value;
  let redacted = value;
  for (const pattern of HATE_SPEECH_PATTERNS) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, '[redacted slur]');
  }
  return redacted;
}

function hasVisualMedia(post: MockPost): boolean {
  if (Boolean(post.media?.length) || post.embed?.type === 'video') return true;
  if (post.embed?.type === 'quote') {
    const q = post.embed.post;
    return Boolean(q.media?.length) || q.embed?.type === 'video';
  }
  return false;
}

export function detectSensitiveMedia(post: MockPost): SensitiveMediaAssessment {
  if (post.sensitiveMedia?.isSensitive) {
    const rawReasons = sanitizeReasons(post.sensitiveMedia.reasons ?? []);
    const reasons = rawReasons.filter(isSensitiveReason);
    const normalized = normalizeAssessment({
      reasons,
      action: post.sensitiveMedia.action,
      allowReveal: post.sensitiveMedia.allowReveal,
      rationale: post.sensitiveMedia.rationale,
    }, 'post');
    return hasVisualMedia(post) ? normalized : EMPTY_SENSITIVE_MEDIA_ASSESSMENT;
  }

  const postLabels = Array.isArray(post.contentLabels) ? post.contentLabels : [];
  const sensitiveMatches = postLabels.filter(isSensitiveLabel);
  const textSafetyReasons = hasPotentialHateSpeechText(post.content)
    ? [HATE_SPEECH_REASON]
    : [];
  const reasons = sanitizeReasons([...sensitiveMatches, ...textSafetyReasons]);

  if (!hasVisualMedia(post)) return EMPTY_SENSITIVE_MEDIA_ASSESSMENT;
  return normalizeAssessment({
    reasons,
    action: deriveActionFromReasons(reasons),
    allowReveal: true,
  }, 'label');
}

export function assessmentFromMediaAnalysis(
  result: Pick<MediaAnalysisResult, 'moderation' | 'cautionFlags' | 'analysisStatus' | 'moderationStatus'> | null | undefined,
): SensitiveMediaAssessment {
  if (result?.analysisStatus === 'degraded' || result?.moderationStatus === 'unavailable') {
    return createUnavailableSensitiveMediaAssessment();
  }

  const moderation = result?.moderation;
  if (!moderation || moderation.action === 'none' || moderation.confidence < 0.4) {
    if (result?.cautionFlags?.includes('harmful-content-detected')) {
      return normalizeAssessment({
        reasons: [GENERIC_SENSITIVE_REASON],
        action: 'warn',
        allowReveal: true,
        rationale: 'Sensitive details were omitted during media analysis.',
      }, 'multimodal');
    }
    return EMPTY_SENSITIVE_MEDIA_ASSESSMENT;
  }

  return normalizeAssessment({
    reasons: moderation.categories,
    action: moderation.action,
    allowReveal: moderation.allowReveal,
    rationale: moderation.rationale,
  }, 'multimodal');
}

export function mergeSensitiveMediaAssessments(
  primary: SensitiveMediaAssessment,
  secondary: SensitiveMediaAssessment,
): SensitiveMediaAssessment {
  if (!primary.isSensitive) return secondary;
  if (!secondary.isSensitive) return primary;

  const preferred = ACTION_PRIORITY[secondary.action] > ACTION_PRIORITY[primary.action]
    ? secondary
    : primary;
  const reasons = sanitizeReasons([...primary.reasons, ...secondary.reasons]);
  const rationale = sanitizeRationale(preferred.rationale ?? secondary.rationale ?? primary.rationale);

  return {
    isSensitive: true,
    reasons,
    action: preferred.action,
    allowReveal: primary.allowReveal && secondary.allowReveal && preferred.action !== 'drop',
    ...(rationale ? { rationale } : {}),
    source: primary.source === secondary.source ? primary.source : 'hybrid',
  };
}

export function mapRawLabelValues(raw: unknown): string[] {
  return sanitizeReasons(
    mapRawLabelDetails(raw)
      .filter((label) => !label.neg)
      .map((label) => label.val),
  );
}

export function mapRawLabelDetails(raw: unknown): RawContentLabel[] {
  if (!Array.isArray(raw)) return [];

  const details: RawContentLabel[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const maybeVal = (item as { val?: unknown }).val;
    if (typeof maybeVal !== 'string') continue;
    const val = normalizeToken(maybeVal);
    if (!val) continue;

    const maybeSrc = (item as { src?: unknown }).src;
    const src = typeof maybeSrc === 'string'
      ? normalizeToken(maybeSrc)
      : undefined;
    const maybeNeg = (item as { neg?: unknown }).neg;

    details.push({
      val,
      ...(src ? { src } : {}),
      neg: Boolean(maybeNeg),
    });
    if (details.length >= 20) break;
  }

  return details;
}
