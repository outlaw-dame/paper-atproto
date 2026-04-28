// ─── Qwen3-VL Multimodal Service — Narwhal v3 Phase B ──────────────────────
// Calls the locally-running Ollama instance with vision capability.
// Model: qwen3-vl:4b-instruct-q4_K_M
//
// Invoked only when multimodal_score >= 0.55 (media materially affects meaning).
// Returns structured media findings consumed by the thread-state builder.
//
// Degradation path: if image fetch, encode, or model call fails, returns a
// low-confidence placeholder so the pipeline continues text-only.

import { env } from '../config/env.js';
import { withRetry } from '../lib/retry.js';
import type { RetryOptions } from '../lib/retry.js';
import { ensureSafetyInstructions, detectHarmfulContent } from '../lib/safeguards.js';
import { sanitizeRemoteProcessingUrl } from '../lib/sanitize.js';
import {
  checkUrlAgainstSafeBrowsing,
  shouldBlockSafeBrowsingVerdict,
} from './safeBrowsing.js';
import { ValidationError } from '../lib/errors.js';
import { ensureOllamaLocalUrlPolicy } from '../lib/ollama-policy.js';
import {
  recordMultimodalFallback,
  recordMultimodalInvocation,
  recordMultimodalRejection,
  recordMultimodalSuccess,
} from '../llm/multimodalDiagnostics.js';

export interface MediaRequest {
  threadId: string;
  mediaUrl: string;
  mediaAlt?: string;
  nearbyText: string;
  candidateEntities: string[];
  factualHints: string[];
}

export interface MediaResponse {
  mediaCentrality: number;
  mediaType: 'screenshot' | 'chart' | 'document' | 'photo' | 'meme' | 'unknown';
  extractedText?: string;
  mediaSummary: string;
  candidateEntities: string[];
  confidence: number;
  cautionFlags: string[];
  analysisStatus?: 'complete' | 'degraded';
  moderationStatus?: 'authoritative' | 'unavailable';
  moderation?: {
    action: 'none' | 'warn' | 'blur' | 'drop';
    categories: Array<
      | 'sexual-content'
      | 'nudity'
      | 'graphic-violence'
      | 'extreme-graphic-violence'
      | 'self-harm'
      | 'hate-symbols'
      | 'hate-speech'
      | 'child-safety'
    >;
    confidence: number;
    allowReveal?: boolean;
    rationale?: string;
  };
}

type MediaFallbackStage = 'fetch' | 'model-call' | 'parse' | 'validation';

interface FallbackContext {
  stage: MediaFallbackStage;
  request: MediaRequest;
  error?: unknown;
}

// ─── System prompt ─────────────────────────────────────────────────────────

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

// Wrap with safety instructions
const SYSTEM_PROMPT_WITH_SAFETY = ensureSafetyInstructions(SYSTEM_PROMPT);

// ─── Ollama vision caller ───────────────────────────────────────────────────

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
}

interface OllamaChatResponse {
  message: OllamaChatMessage;
  done: boolean;
}

const SUPPORTED_MEDIA_CONTENT_TYPE_PREFIXES = ['image/'] as const;
const ALLOWED_CAUTION_FLAGS = new Set(['miscaptioned', 'recycled', 'partial-view', 'harmful-content-detected']);
const ALLOWED_MODERATION_ACTIONS = new Set(['none', 'warn', 'blur', 'drop']);
const ALLOWED_MODERATION_CATEGORIES = new Set<string>([
  'sexual-content',
  'nudity',
  'graphic-violence',
  'extreme-graphic-violence',
  'self-harm',
  'hate-symbols',
  'hate-speech',
  'child-safety',
] as const);
const DROP_ELIGIBLE_CATEGORIES = new Set<string>(['extreme-graphic-violence', 'child-safety']);
const BLUR_ELIGIBLE_CATEGORIES = new Set<string>([
  'sexual-content',
  'nudity',
  'graphic-violence',
  'extreme-graphic-violence',
  'self-harm',
  'hate-symbols',
  'child-safety',
] as const);

function sanitizeModelText(value: string, maxChars: number): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

function safeErrorLabel(error: unknown): string {
  if (!error) return 'unknown';
  if (error instanceof ValidationError) return 'validation-error';
  if (error instanceof Error && error.name) return error.name;
  return typeof error;
}

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error) || !error.message) return '';
  return sanitizeModelText(error.message, 160);
}

function previewText(value: string | undefined): string {
  if (!value) return '';
  return sanitizeModelText(value, 80);
}

function logFallback(context: FallbackContext): void {
  if (!env.LLM_MEDIA_DIAGNOSTICS) return;

  const payload = {
    stage: context.stage,
    reason: safeErrorLabel(context.error),
    message: safeErrorMessage(context.error),
    threadId: sanitizeModelText(context.request.threadId, 80),
    mediaHost: (() => {
      try {
        return new URL(context.request.mediaUrl).hostname;
      } catch {
        return 'invalid-url';
      }
    })(),
    nearbyTextPreview: previewText(context.request.nearbyText),
    mediaAltPreview: previewText(context.request.mediaAlt),
    candidateEntityCount: context.request.candidateEntities.length,
    factualHintCount: context.request.factualHints.length,
  };

  console.warn('[llm/media/fallback]', payload);
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

async function assertSafeMediaUrl(url: string): Promise<void> {
  const verdict = await checkUrlAgainstSafeBrowsing(url);
  if (!shouldBlockSafeBrowsingVerdict(verdict)) return;
  throw new ValidationError(
    verdict.reason ?? 'Media URL blocked by Google Safe Browsing.',
  );
}

function isRedirectStatus(status: number): boolean {
  return status === 301
    || status === 302
    || status === 303
    || status === 307
    || status === 308;
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

async function fetchMediaResponse(
  url: string,
  timeoutMs: number,
  redirectCount = 0,
): Promise<Response> {
  await assertSafeMediaUrl(url);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'manual',
      headers: {
        Accept: 'image/*',
      },
    });

    if (isRedirectStatus(res.status)) {
      if (redirectCount >= env.LLM_MEDIA_MAX_REDIRECTS) {
        throw new Error('Media redirect limit exceeded.');
      }

      const location = res.headers.get('location');
      if (!location) {
        throw new Error('Media redirect missing location header.');
      }

      const nextUrl = new URL(location, url).toString();
      const sanitizedNextUrl = sanitizeRemoteProcessingUrl(nextUrl);
      if (!sanitizedNextUrl) {
        throw new Error('Unsafe media redirect target.');
      }

      return fetchMediaResponse(sanitizedNextUrl, timeoutMs, redirectCount + 1);
    }

    if (!res.ok) {
      throw Object.assign(new Error(`Image fetch failed: ${res.status}`), { status: res.status });
    }

    ensureSupportedMediaHeaders(res);
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readMediaResponseAsBase64(response: Response): Promise<string> {
  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > env.LLM_MEDIA_MAX_BYTES) {
      throw new Error(`Media payload exceeds ${env.LLM_MEDIA_MAX_BYTES} bytes.`);
    }
    return Buffer.from(arrayBuffer).toString('base64');
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    totalBytes += value.byteLength;
    if (totalBytes > env.LLM_MEDIA_MAX_BYTES) {
      throw new Error(`Media payload exceeds ${env.LLM_MEDIA_MAX_BYTES} bytes.`);
    }

    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks).toString('base64');
}

async function fetchImageAsBase64(url: string, timeoutMs: number): Promise<string> {
  const response = await fetchMediaResponse(url, timeoutMs);
  return readMediaResponseAsBase64(response);
}

async function callOllamaVision(
  model: string,
  imageBase64: string,
  userContent: string,
  timeoutMs: number,
): Promise<string> {
  ensureOllamaLocalUrlPolicy();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT_WITH_SAFETY },
          { role: 'user', content: userContent, images: [imageBase64] },
        ],
        stream: false,
        format: 'json',
        think: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw Object.assign(new Error(`Ollama responded ${res.status}`), { status: res.status });
    const data = (await res.json()) as OllamaChatResponse;
    return data.message.content;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Validation ────────────────────────────────────────────────────────────

function validateResponse(raw: unknown): MediaResponse {
  if (typeof raw !== 'object' || raw === null) throw new Error('Non-object response from vision model');
  const r = raw as Record<string, unknown>;

  const mediaCentrality = typeof r.mediaCentrality === 'number' ? Math.max(0, Math.min(1, r.mediaCentrality)) : 0.3;
  const mediaType: MediaResponse['mediaType'] = ['screenshot', 'chart', 'document', 'photo', 'meme', 'unknown'].includes(r.mediaType as string)
    ? (r.mediaType as MediaResponse['mediaType'])
    : 'unknown';
  const extractedText = typeof r.extractedText === 'string' && r.extractedText.trim()
    ? sanitizeModelText(r.extractedText, 500)
    : undefined;
  const mediaSummary = typeof r.mediaSummary === 'string'
    ? sanitizeModelText(r.mediaSummary, 320)
    : '';
  const candidateEntities = Array.isArray(r.candidateEntities)
    ? (r.candidateEntities as unknown[])
        .filter((e): e is string => typeof e === 'string')
        .map((e) => sanitizeModelText(e, 80))
        .filter((e) => e.length > 0)
        .slice(0, 5)
    : [];
  const confidence = typeof r.confidence === 'number' ? Math.max(0, Math.min(1, r.confidence)) : 0.3;
  const cautionFlags = Array.isArray(r.cautionFlags)
    ? (r.cautionFlags as unknown[])
        .filter((f): f is string => typeof f === 'string')
        .map((f) => sanitizeModelText(f.toLowerCase(), 40))
        .filter((f) => ALLOWED_CAUTION_FLAGS.has(f))
    : [];

  const moderation = (() => {
    if (typeof r.moderation !== 'object' || r.moderation === null) return undefined;
    const rawModeration = r.moderation as Record<string, unknown>;
    const rawAction = typeof rawModeration.action === 'string'
      ? sanitizeModelText(rawModeration.action.toLowerCase(), 16)
      : 'none';
    const action = ALLOWED_MODERATION_ACTIONS.has(rawAction)
      ? rawAction as NonNullable<MediaResponse['moderation']>['action']
      : 'none';
    const categories = Array.isArray(rawModeration.categories)
      ? Array.from(new Set(
          rawModeration.categories
            .filter((value): value is string => typeof value === 'string')
            .map((value) => sanitizeModelText(value.toLowerCase(), 40))
            .filter((value): value is NonNullable<MediaResponse['moderation']>['categories'][number] => (
              ALLOWED_MODERATION_CATEGORIES.has(value as never)
            )),
        )).slice(0, 4)
      : [];
    const confidence = typeof rawModeration.confidence === 'number'
      ? Math.max(0, Math.min(1, rawModeration.confidence))
      : 0;
    const rationale = typeof rawModeration.rationale === 'string'
      ? sanitizeModelText(rawModeration.rationale, 180)
      : '';

    if (categories.length === 0 || confidence < 0.4 || action === 'none') {
      return {
        action: 'none' as const,
        categories: [],
        confidence: 0,
        allowReveal: true,
      };
    }

    const hasDropCategory = categories.some((category) => DROP_ELIGIBLE_CATEGORIES.has(category));
    const hasBlurCategory = categories.some((category) => BLUR_ELIGIBLE_CATEGORIES.has(category));
    const warnOnly = categories.every((category) => category === 'hate-speech');

    let normalizedAction = action;
    if (hasDropCategory && confidence >= 0.82) {
      normalizedAction = 'drop';
    } else if (normalizedAction === 'drop') {
      normalizedAction = hasBlurCategory ? 'blur' : 'warn';
    }

    if (normalizedAction === 'warn' && hasBlurCategory && !warnOnly && confidence >= 0.65) {
      normalizedAction = 'blur';
    }
    if (normalizedAction === 'blur' && warnOnly) {
      normalizedAction = 'warn';
    }

    return {
      action: normalizedAction,
      categories,
      confidence,
      allowReveal: normalizedAction !== 'drop',
      ...(rationale ? { rationale } : {}),
    };
  })();

  // Safety check: detect harmful content in extracted text or summary
  const safeExtractedText = extractedText && detectHarmfulContent(extractedText).isHarmful
    ? undefined
    : extractedText;
  if (extractedText && !safeExtractedText) {
    cautionFlags.push('harmful-content-detected');
    console.warn('[SAFETY] Harmful content detected in image extraction');
  }
  const safeMediaSummary = detectHarmfulContent(mediaSummary).isHarmful
    ? 'Media present — sensitive details omitted.'
    : mediaSummary;
  if (safeMediaSummary !== mediaSummary) {
    cautionFlags.push('harmful-content-detected');
    console.warn('[SAFETY] Harmful content detected in media summary');
  }

  const dedupedFlags = Array.from(new Set(cautionFlags));

  return {
    mediaCentrality,
    mediaType,
    mediaSummary: safeMediaSummary,
    candidateEntities,
    confidence,
    cautionFlags: dedupedFlags,
    analysisStatus: 'complete',
    moderationStatus: 'authoritative',
    ...(moderation && moderation.action !== 'none' ? { moderation } : {}),
    ...(safeExtractedText !== undefined ? { extractedText: safeExtractedText } : {}),
  };
}

// ─── Fallback ──────────────────────────────────────────────────────────────

function fallbackResponse(mediaAlt?: string, nearbyText?: string): MediaResponse {
  return {
    mediaCentrality: 0.3,
    mediaType: guessMediaType(mediaAlt ?? nearbyText ?? ''),
    mediaSummary: 'Media present — analysis unavailable.',
    candidateEntities: [],
    confidence: 0.15,
    cautionFlags: [],
    analysisStatus: 'degraded',
    moderationStatus: 'unavailable',
  };
}

function guessMediaType(hint: string): MediaResponse['mediaType'] {
  const h = hint.toLowerCase();
  if (/screenshot|screen shot|screencap/.test(h)) return 'screenshot';
  if (/chart|graph|data/.test(h)) return 'chart';
  if (/document|article|policy|rule/.test(h)) return 'document';
  return 'photo';
}

// ─── Public API ────────────────────────────────────────────────────────────

const RETRY_OPTIONS: RetryOptions = { attempts: 2, baseDelayMs: 500, maxDelayMs: 3000, jitter: true };

async function analyzeEncodedMedia(
  request: MediaRequest,
  imageBase64: string,
  startedAt: number,
): Promise<MediaResponse> {
  const model = env.QWEN_MULTIMODAL_MODEL;
  const userContent = JSON.stringify({
    nearbyText: sanitizeModelText(request.nearbyText, 300),
    candidateEntities: request.candidateEntities
      .map((entity) => sanitizeModelText(entity, 80))
      .filter((entity) => entity.length > 0)
      .slice(0, 8),
    factualHints: request.factualHints
      .map((hint) => sanitizeModelText(hint, 120))
      .filter((hint) => hint.length > 0)
      .slice(0, 4),
    mediaAlt: request.mediaAlt ? sanitizeModelText(request.mediaAlt, 200) : undefined,
  });

  let rawContent: string;
  try {
    rawContent = await withRetry(
      () => callOllamaVision(model, imageBase64, userContent, env.LLM_TIMEOUT_MS),
      RETRY_OPTIONS,
    );
  } catch (error) {
    recordMultimodalFallback({
      stage: 'model-call',
      latencyMs: Date.now() - startedAt,
      reason: safeErrorLabel(error),
      message: safeErrorMessage(error),
    });
    logFallback({ stage: 'model-call', request, error });
    return fallbackResponse(request.mediaAlt, request.nearbyText);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(rawContent));
  } catch (error) {
    recordMultimodalFallback({
      stage: 'parse',
      latencyMs: Date.now() - startedAt,
      reason: safeErrorLabel(error),
      message: safeErrorMessage(error),
    });
    logFallback({ stage: 'parse', request, error });
    return fallbackResponse(request.mediaAlt, request.nearbyText);
  }
  try {
    const result = validateResponse(parsed);
    recordMultimodalSuccess({
      mediaType: result.mediaType,
      moderationAction: result.moderation?.action ?? 'none',
      confidence: result.confidence,
      latencyMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    recordMultimodalFallback({
      stage: 'validation',
      latencyMs: Date.now() - startedAt,
      reason: safeErrorLabel(error),
      message: safeErrorMessage(error),
    });
    logFallback({ stage: 'validation', request, error });
    return fallbackResponse(request.mediaAlt, request.nearbyText);
  }
}

export async function runMediaAnalyzerFromImageBase64(
  request: MediaRequest,
  imageBase64: string,
): Promise<MediaResponse> {
  const startedAt = Date.now();
  recordMultimodalInvocation();
  return analyzeEncodedMedia(request, imageBase64, startedAt);
}

export async function runMediaAnalyzer(request: MediaRequest): Promise<MediaResponse> {
  const startedAt = Date.now();
  recordMultimodalInvocation();

  // Fetch and encode the image first — if this fails, degrade gracefully.
  let imageBase64: string;
  try {
    imageBase64 = await withRetry(
      () => fetchImageAsBase64(request.mediaUrl, env.LLM_MEDIA_FETCH_TIMEOUT_MS),
      { attempts: 2, baseDelayMs: 300, maxDelayMs: 2000, jitter: true },
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      recordMultimodalRejection({
        stage: 'fetch',
        latencyMs: Date.now() - startedAt,
        reason: safeErrorLabel(error),
        message: safeErrorMessage(error),
      });
      throw error;
    }
    recordMultimodalFallback({
      stage: 'fetch',
      latencyMs: Date.now() - startedAt,
      reason: safeErrorLabel(error),
      message: safeErrorMessage(error),
    });
    logFallback({ stage: 'fetch', request, error });
    return fallbackResponse(request.mediaAlt, request.nearbyText);
  }

  return analyzeEncodedMedia(request, imageBase64, startedAt);
}
