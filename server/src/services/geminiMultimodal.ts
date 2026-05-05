// ─── Gemini Flash Multimodal Service — Overflow Vision Path ─────────────────
// Handles images 3+ in threads that exceed the standard 2-image Qwen3-VL cap.
// Uses @google/genai (Gemini Flash) so each analysis call goes to Google's API.
//
// Invoked only for requests marked overflow: true by the coordinator router.
// Returns the same MediaResponse shape as qwenMultimodal.ts so all downstream
// result merging and writer rendering is unchanged.
//
// Degradation path: fetch / model / parse failures return a low-confidence
// placeholder so the pipeline continues without dropping the entire stage.

import { createGoogleGenAIClient } from '../lib/googleGenAi.js';
import { env } from '../config/env.js';
import { ensureSafetyInstructions } from '../lib/safeguards.js';
import { sanitizeRemoteProcessingUrl } from '../lib/sanitize.js';
import {
  checkUrlAgainstSafeBrowsing,
  shouldBlockSafeBrowsingVerdict,
} from './safeBrowsing.js';
import { ValidationError } from '../lib/errors.js';
import type { MediaRequest, MediaResponse } from './qwenMultimodal.js';

export type { MediaRequest, MediaResponse } from './qwenMultimodal.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const GEMINI_MULTIMODAL_TIMEOUT_MS = 20_000;
const GEMINI_MULTIMODAL_MAX_OUTPUT_TOKENS = 800;

const SUPPORTED_MEDIA_CONTENT_TYPE_PREFIXES = ['image/'] as const;

// ─── System prompt (mirrors qwenMultimodal.ts closely) ───────────────────────

const SYSTEM_PROMPT = `You are the Glympse media analyzer. You receive an image from a social media thread alongside nearby text and candidate entities. Analyze only what is visually present.

OUTPUT FIELDS
─────────────
mediaCentrality   Number 0–1. How central is this media to understanding the thread? 0 = purely decorative, 1 = the entire claim depends on this image.
mediaType         One of: screenshot, chart, document, photo, meme, unknown.
extractedText     String or omit. Visible text in the image (OCR). Max 500 chars. Omit if no meaningful text.
mediaSummary      1–2 sentences describing what the image shows. Be specific. Do not interpret beyond what is visible.
candidateEntities Array of entity strings visible or clearly implied by the image. Max 5.
confidence        Number 0–1. Your overall confidence in this analysis.
cautionFlags      Array of strings. Include entries for: "miscaptioned" (image appears older or different context than claimed), "recycled" (looks like a widely-recirculated image), "partial-view" (important content is cropped). Empty array if none apply.
moderation        Object describing whether the image needs extra moderation treatment. Be conservative and use "none" unless the visual content clearly warrants intervention. "warn" = visible with warning context, "blur" = blur and allow reveal, "drop" = severe content that should stay hidden without reveal. Categories allowed: sexual-content, nudity, graphic-violence, extreme-graphic-violence, self-harm, hate-symbols, hate-speech, child-safety. Use at most 4 categories. Include a short neutral rationale when action is not "none".

Return valid JSON only. No markdown, no code blocks.

OUTPUT SCHEMA
{
  "mediaCentrality": 0.0,
  "mediaType": "photo",
  "extractedText": "optional string",
  "mediaSummary": "string",
  "candidateEntities": [],
  "confidence": 0.0,
  "cautionFlags": [],
  "moderation": {
    "action": "none",
    "categories": [],
    "confidence": 0.0,
    "allowReveal": true,
    "rationale": "optional string"
  }
}`;

const SYSTEM_PROMPT_WITH_SAFETY = ensureSafetyInstructions(SYSTEM_PROMPT);

// ─── Low-confidence degradation placeholder ───────────────────────────────────

function buildFallbackResponse(request: MediaRequest): MediaResponse {
  return {
    mediaCentrality: 0,
    mediaType: 'unknown',
    mediaSummary: request.mediaAlt
      ? `Image could not be analyzed. Alt text: ${request.mediaAlt}`
      : 'Image could not be analyzed.',
    candidateEntities: [],
    confidence: 0,
    cautionFlags: [],
    analysisStatus: 'degraded',
    moderationStatus: 'unavailable',
  };
}

// ─── URL validation ───────────────────────────────────────────────────────────

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function assertSafeMediaUrl(url: string): Promise<void> {
  const verdict = await checkUrlAgainstSafeBrowsing(url);
  if (!shouldBlockSafeBrowsingVerdict(verdict)) return;
  throw new ValidationError(verdict.reason ?? 'Media URL blocked by Google Safe Browsing.');
}

function ensureSupportedMediaHeaders(response: Response): void {
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (
    contentType
    && !SUPPORTED_MEDIA_CONTENT_TYPE_PREFIXES.some((prefix) => contentType.startsWith(prefix))
  ) {
    throw new Error(`Unsupported media content type: ${contentType}`);
  }

  const contentLengthHeader = response.headers.get('content-length');
  if (!contentLengthHeader) return;
  const contentLength = Number.parseInt(contentLengthHeader, 10);
  if (!Number.isFinite(contentLength) || contentLength < 0) {
    throw new Error('Invalid media content length header.');
  }
  if (contentLength > env.LLM_MEDIA_MAX_BYTES) {
    throw new Error(`Media payload exceeds ${env.LLM_MEDIA_MAX_BYTES} bytes.`);
  }
}

async function fetchMediaAsBase64(
  url: string,
  redirectCount = 0,
): Promise<{ base64: string; mimeType: string }> {
  await assertSafeMediaUrl(url);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), env.LLM_MEDIA_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'manual',
      headers: { Accept: 'image/*' },
    });

    if (isRedirectStatus(res.status)) {
      if (redirectCount >= env.LLM_MEDIA_MAX_REDIRECTS) {
        throw new Error('Media redirect limit exceeded.');
      }
      const location = res.headers.get('location');
      if (!location) throw new Error('Media redirect missing location header.');
      const nextUrl = new URL(location, url).toString();
      const sanitizedNext = sanitizeRemoteProcessingUrl(nextUrl);
      if (!sanitizedNext) throw new Error('Unsafe media redirect target.');
      return fetchMediaAsBase64(sanitizedNext, redirectCount + 1);
    }

    if (!res.ok) {
      throw Object.assign(new Error(`Image fetch failed: ${res.status}`), { status: res.status });
    }

    ensureSupportedMediaHeaders(res);

    // Detect mime type from content-type header, fallback to image/jpeg.
    const contentType = res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
    const mimeType = contentType.startsWith('image/') ? contentType : 'image/jpeg';

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > env.LLM_MEDIA_MAX_BYTES) {
      throw new Error(`Media payload exceeds ${env.LLM_MEDIA_MAX_BYTES} bytes.`);
    }
    const base64 = Buffer.from(buffer).toString('base64');
    return { base64, mimeType };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Response parsing ─────────────────────────────────────────────────────────

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

const ALLOWED_MEDIA_TYPES = new Set(['screenshot', 'chart', 'document', 'photo', 'meme', 'unknown']);
const ALLOWED_MODERATION_ACTIONS = new Set(['none', 'warn', 'blur', 'drop']);
const ALLOWED_MODERATION_CATEGORIES = new Set<string>([
  'sexual-content', 'nudity', 'graphic-violence', 'extreme-graphic-violence',
  'self-harm', 'hate-symbols', 'hate-speech', 'child-safety',
]);
const ALLOWED_CAUTION_FLAGS = new Set(['miscaptioned', 'recycled', 'partial-view', 'harmful-content-detected']);

function parseMediaResponse(raw: string, request: MediaRequest): MediaResponse {
  const jsonText = extractJsonObject(raw);
  const parsed: unknown = JSON.parse(jsonText);
  if (!parsed || typeof parsed !== 'object') throw new Error('Parsed response is not an object');
  const data = parsed as Record<string, unknown>;

  const mediaCentrality = Math.min(1, Math.max(0, Number(data.mediaCentrality) || 0));
  const confidence = Math.min(1, Math.max(0, Number(data.confidence) || 0));

  const rawMediaType = typeof data.mediaType === 'string' ? data.mediaType : 'unknown';
  const mediaType: MediaResponse['mediaType'] = ALLOWED_MEDIA_TYPES.has(rawMediaType)
    ? (rawMediaType as MediaResponse['mediaType'])
    : 'unknown';

  const mediaSummary = typeof data.mediaSummary === 'string' && data.mediaSummary.trim()
    ? data.mediaSummary.trim().slice(0, 600)
    : (request.mediaAlt?.slice(0, 300) ?? 'No summary available.');

  const extractedText = typeof data.extractedText === 'string' && data.extractedText.trim()
    ? data.extractedText.trim().slice(0, 500)
    : undefined;

  const rawEntities = Array.isArray(data.candidateEntities) ? data.candidateEntities : [];
  const candidateEntities = rawEntities
    .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
    .slice(0, 5)
    .map((e) => e.trim());

  const rawCautionFlags = Array.isArray(data.cautionFlags) ? data.cautionFlags : [];
  const cautionFlags = rawCautionFlags
    .filter((f): f is string => typeof f === 'string' && ALLOWED_CAUTION_FLAGS.has(f));

  const modRaw = data.moderation && typeof data.moderation === 'object'
    ? (data.moderation as Record<string, unknown>)
    : null;

  const modAction = modRaw && typeof modRaw.action === 'string' && ALLOWED_MODERATION_ACTIONS.has(modRaw.action)
    ? (modRaw.action as MediaResponse['moderation']['action'])
    : 'none';

  const modCategories = modRaw && Array.isArray(modRaw.categories)
    ? (modRaw.categories as unknown[])
        .filter((c): c is string => typeof c === 'string' && ALLOWED_MODERATION_CATEGORIES.has(c))
        .slice(0, 4) as Array<MediaResponse['moderation']['categories'][number]>
    : [];

  const modConfidence = Math.min(1, Math.max(0, Number(modRaw?.confidence) || 0));
  const modAllowReveal = modRaw?.allowReveal !== false;
  const modRationale = typeof modRaw?.rationale === 'string' && modRaw.rationale.trim()
    ? modRaw.rationale.trim().slice(0, 200)
    : undefined;

  return {
    mediaCentrality,
    mediaType,
    mediaSummary,
    ...(extractedText !== undefined ? { extractedText } : {}),
    candidateEntities,
    confidence,
    cautionFlags,
    analysisStatus: 'complete',
    moderationStatus: 'authoritative',
    moderation: {
      action: modAction,
      categories: modCategories,
      confidence: modConfidence,
      allowReveal: modAllowReveal,
      ...(modRationale !== undefined ? { rationale: modRationale } : {}),
    },
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Analyzes a media URL using Gemini Flash vision. Intended for images beyond
 * the standard 2-image Qwen3-VL cap (overflow images in long threads).
 *
 * Returns a low-confidence degraded placeholder on any failure so the caller
 * can continue without dropping the entire multimodal stage.
 */
export async function runGeminiMediaAnalyzer(request: MediaRequest): Promise<MediaResponse> {
  const client = createGoogleGenAIClient();
  if (!client) {
    return buildFallbackResponse(request);
  }

  let base64: string;
  let mimeType: string;
  try {
    ({ base64, mimeType } = await fetchMediaAsBase64(request.mediaUrl));
  } catch {
    return buildFallbackResponse(request);
  }

  const userPrompt = [
    `Thread context: ${request.nearbyText.slice(0, 400)}`,
    request.candidateEntities.length > 0
      ? `Candidate entities: ${request.candidateEntities.slice(0, 5).join(', ')}`
      : null,
    request.factualHints.length > 0
      ? `Factual hints: ${request.factualHints.slice(0, 3).join('; ')}`
      : null,
    request.mediaAlt
      ? `Alt text: ${request.mediaAlt.slice(0, 300)}`
      : null,
    'Analyze the provided image and return valid JSON matching the output schema.',
  ].filter(Boolean).join('\n');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_MULTIMODAL_TIMEOUT_MS);

  try {
    const response = await client.models.generateContent({
      model: env.GEMINI_MULTIMODAL_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: `${SYSTEM_PROMPT_WITH_SAFETY}\n\n${userPrompt}` },
            {
              inlineData: {
                mimeType,
                data: base64,
              },
            },
          ],
        },
      ],
      config: {
        maxOutputTokens: GEMINI_MULTIMODAL_MAX_OUTPUT_TOKENS,
        temperature: 0.2,
        topP: 0.9,
        httpOptions: {
          timeout: GEMINI_MULTIMODAL_TIMEOUT_MS,
        },
      },
    });

    const rawText = response.text ?? '';
    return parseMediaResponse(rawText, request);
  } catch {
    return buildFallbackResponse(request);
  } finally {
    clearTimeout(timeoutId);
  }
}
