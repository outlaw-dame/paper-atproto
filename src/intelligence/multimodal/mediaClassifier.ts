// ─── Multimodal — Media Type Classification ───────────────────────────────
// Deterministic pre-classification of media items before sending to a vision
// model. Avoids unnecessary model calls and provides a prior that the model
// can override.
//
// Classification uses:
//   • MIME type (most reliable)
//   • File extension in URL
//   • Alt text keywords
//   • Nearby post text patterns
//
// Design constraints:
//   • Pure functions — no I/O, no network calls.
//   • Fail-closed — on error, return 'unknown'.
//   • Restrict URL schemes to https/http only.
//   • All inputs sanitized to safe lengths before processing.

import type { WriterMediaFinding } from '../llmContracts';

// ─── Types ────────────────────────────────────────────────────────────────

export type MediaKind = WriterMediaFinding['mediaType'];

export interface MediaClassificationResult {
  /** Best-guess media type before model analysis. */
  kind: MediaKind;
  /** Confidence in this pre-classification [0, 1]. */
  confidence: number;
  /** True if this media is likely OCR-heavy (text-rich). */
  isTextHeavy: boolean;
  /** True if this media is a primary claim carrier (vs incidental). */
  isClaimCarrier: boolean;
}

// ─── MIME type table ──────────────────────────────────────────────────────

const MIME_TO_KIND: Record<string, MediaKind> = {
  'image/jpeg': 'photo',
  'image/jpg': 'photo',
  'image/png': 'photo',
  'image/webp': 'photo',
  'image/gif': 'photo',
  'image/avif': 'photo',
  'image/heic': 'photo',
  'image/heif': 'photo',
  'application/pdf': 'document',
  'image/svg+xml': 'document',
};

// ─── Extension fallback table ─────────────────────────────────────────────

const EXT_TO_KIND: Record<string, MediaKind> = {
  jpg: 'photo', jpeg: 'photo', png: 'photo', webp: 'photo',
  gif: 'photo', avif: 'photo', heic: 'photo', heif: 'photo',
  svg: 'document', pdf: 'document',
};

// ─── Keyword patterns ─────────────────────────────────────────────────────

const SCREENSHOT_KEYWORDS = /\b(?:screenshot|screen shot|screencap|screengrab|screen grab|screen capture)\b/i;
const CHART_KEYWORDS = /\b(?:chart|graph|graph|plot|histogram|pie (?:chart|graph)|bar (?:chart|graph)|line (?:chart|graph)|scatter (?:plot|chart)|visualization|dashboard|analytics)\b/i;
const DOCUMENT_KEYWORDS = /\b(?:document|pdf|report|article|paper|memo|letter|form|contract|policy|regulation|legislation|bill|act|statute|rule|guideline)\b/i;
const MEME_KEYWORDS = /\b(?:meme|lol|haha|based|cringe|ratio|cope|seethe|galaxy brain)\b/i;
const OCR_HEAVY_KEYWORDS = /\b(?:screenshot|document|pdf|policy|regulation|law|rule|guideline|memo|report|article|news|headline|tweet|post|caption|text in (?:image|photo|picture))\b/i;
const CLAIM_CARRIER_KEYWORDS = /\b(?:this (?:image|photo|screenshot|chart|document|picture|shows?|proves?|confirms?)|the (?:image|screenshot|chart|document) (?:shows?|proves?|says?|states?|shows?)|look at (?:this|the)|as you can see|evidence:|proof:|here'?s (?:the|a) (?:screenshot|image|chart|document|proof|evidence))\b/i;

// ─── URL extension extraction ─────────────────────────────────────────────

function extractExtension(url: string): string {
  try {
    const u = new URL(url);
    const pathname = u.pathname;
    const lastDot = pathname.lastIndexOf('.');
    if (lastDot < 0 || lastDot >= pathname.length - 1) return '';
    return pathname.slice(lastDot + 1).toLowerCase().slice(0, 8);
  } catch {
    return '';
  }
}

function isAllowedScheme(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

// ─── classifyMedia ────────────────────────────────────────────────────────

/**
 * Pre-classify a media item before model analysis.
 *
 * @param url      — media URL (must be https/http)
 * @param mimeType — MIME type if known
 * @param altText  — image alt text if available
 * @param nearbyText — surrounding post text
 *
 * Never throws — returns {kind: 'unknown', confidence: 0} on error.
 */
export function classifyMedia(
  url: string,
  mimeType?: string,
  altText?: string,
  nearbyText?: string,
): MediaClassificationResult {
  const unknown: MediaClassificationResult = {
    kind: 'unknown',
    confidence: 0,
    isTextHeavy: false,
    isClaimCarrier: false,
  };

  if (!url || typeof url !== 'string') return unknown;

  try {
    if (!isAllowedScheme(url)) return unknown;

    const alt = (altText ?? '').slice(0, 200);
    const nearby = (nearbyText ?? '').slice(0, 500);
    const combined = `${alt} ${nearby}`.trim();

    // 1. MIME type (highest confidence)
    if (mimeType) {
      const normalizedMime = mimeType.toLowerCase().trim();
      const fromMime = MIME_TO_KIND[normalizedMime];
      if (fromMime) {
        // Screenshots and charts override 'photo' from MIME
        if (fromMime === 'photo' && SCREENSHOT_KEYWORDS.test(combined)) {
          const isTextHeavy = OCR_HEAVY_KEYWORDS.test(combined);
          const isClaimCarrier = CLAIM_CARRIER_KEYWORDS.test(combined);
          return { kind: 'screenshot', confidence: 0.80, isTextHeavy, isClaimCarrier };
        }
        if (fromMime === 'photo' && CHART_KEYWORDS.test(combined)) {
          const isClaimCarrier = CLAIM_CARRIER_KEYWORDS.test(combined);
          return { kind: 'chart', confidence: 0.75, isTextHeavy: false, isClaimCarrier };
        }
        if (fromMime === 'photo' && MEME_KEYWORDS.test(combined)) {
          return { kind: 'meme', confidence: 0.70, isTextHeavy: false, isClaimCarrier: false };
        }
        const isTextHeavy = fromMime === 'document' || OCR_HEAVY_KEYWORDS.test(combined);
        const isClaimCarrier = CLAIM_CARRIER_KEYWORDS.test(combined);
        return { kind: fromMime, confidence: 0.85, isTextHeavy, isClaimCarrier };
      }
    }

    // 2. URL extension
    const ext = extractExtension(url);
    if (ext && EXT_TO_KIND[ext]) {
      const fromExt = EXT_TO_KIND[ext]!;
      const isTextHeavy = fromExt === 'document' || OCR_HEAVY_KEYWORDS.test(combined);
      const isClaimCarrier = CLAIM_CARRIER_KEYWORDS.test(combined);
      return { kind: fromExt, confidence: 0.65, isTextHeavy, isClaimCarrier };
    }

    // 3. Alt text / nearby text keywords (lower confidence)
    if (SCREENSHOT_KEYWORDS.test(combined)) {
      const isTextHeavy = OCR_HEAVY_KEYWORDS.test(combined);
      const isClaimCarrier = CLAIM_CARRIER_KEYWORDS.test(combined);
      return { kind: 'screenshot', confidence: 0.55, isTextHeavy, isClaimCarrier };
    }
    if (CHART_KEYWORDS.test(combined)) {
      const isClaimCarrier = CLAIM_CARRIER_KEYWORDS.test(combined);
      return { kind: 'chart', confidence: 0.50, isTextHeavy: false, isClaimCarrier };
    }
    if (DOCUMENT_KEYWORDS.test(combined)) {
      const isClaimCarrier = CLAIM_CARRIER_KEYWORDS.test(combined);
      return { kind: 'document', confidence: 0.50, isTextHeavy: true, isClaimCarrier };
    }
    if (MEME_KEYWORDS.test(combined)) {
      return { kind: 'meme', confidence: 0.45, isTextHeavy: false, isClaimCarrier: false };
    }

    // Default: assume photo
    const isClaimCarrier = CLAIM_CARRIER_KEYWORDS.test(combined);
    return { kind: 'photo', confidence: 0.30, isTextHeavy: false, isClaimCarrier };
  } catch {
    return unknown;
  }
}

/**
 * Returns true if this media kind warrants OCR extraction.
 */
export function requiresOcr(kind: MediaKind): boolean {
  return kind === 'screenshot' || kind === 'document';
}

/**
 * Returns the recommended confidence threshold for this media kind.
 * Higher-confidence media kinds require a stronger signal before acting on results.
 */
export function minimumConfidenceForKind(kind: MediaKind): number {
  const thresholds: Record<MediaKind, number> = {
    screenshot: 0.40,
    document: 0.40,
    chart: 0.35,
    photo: 0.30,
    meme: 0.25,
    unknown: 0.50,
  };
  return thresholds[kind] ?? 0.40;
}
