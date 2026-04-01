import type { MockPost } from '../../data/mockData';

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

export interface SensitiveMediaAssessment {
  isSensitive: boolean;
  reasons: string[];
  source: 'label' | 'post';
}

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
    const reasons = rawReasons.filter(isSensitiveLabel);
    return {
      isSensitive: hasVisualMedia(post) && reasons.length > 0,
      reasons,
      source: 'post',
    };
  }

  const postLabels = Array.isArray(post.contentLabels) ? post.contentLabels : [];
  const sensitiveMatches = postLabels.filter(isSensitiveLabel);

  return {
    isSensitive: sensitiveMatches.length > 0 && hasVisualMedia(post),
    reasons: sanitizeReasons(sensitiveMatches),
    source: 'label',
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
