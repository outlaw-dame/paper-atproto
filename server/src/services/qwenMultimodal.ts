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

Return valid JSON only. No markdown, no code blocks.

OUTPUT SCHEMA
{
  "mediaCentrality": 0.0,
  "mediaType": "photo",
  "extractedText": "optional string",
  "mediaSummary": "string",
  "candidateEntities": [],
  "confidence": 0.0,
  "cautionFlags": []
}`;

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

async function fetchImageAsBase64(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
    const buf = await res.arrayBuffer();
    return Buffer.from(buf).toString('base64');
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callOllamaVision(
  model: string,
  imageBase64: string,
  userContent: string,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
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
  const extractedText = typeof r.extractedText === 'string' && r.extractedText.trim() ? r.extractedText.slice(0, 500) : undefined;
  const mediaSummary = typeof r.mediaSummary === 'string' ? r.mediaSummary : '';
  const candidateEntities = Array.isArray(r.candidateEntities)
    ? (r.candidateEntities as unknown[]).filter(e => typeof e === 'string').slice(0, 5) as string[]
    : [];
  const confidence = typeof r.confidence === 'number' ? Math.max(0, Math.min(1, r.confidence)) : 0.3;
  const cautionFlags = Array.isArray(r.cautionFlags)
    ? (r.cautionFlags as unknown[]).filter(f => typeof f === 'string') as string[]
    : [];

  return {
    mediaCentrality, mediaType, mediaSummary, candidateEntities, confidence, cautionFlags,
    ...(extractedText !== undefined ? { extractedText } : {}),
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

// Image fetch budget is separate from model timeout — keep it tight.
const IMAGE_FETCH_TIMEOUT_MS = 8_000;

export async function runMediaAnalyzer(request: MediaRequest): Promise<MediaResponse> {
  const model = env.QWEN_MULTIMODAL_MODEL;

  // Fetch and encode the image first — if this fails, degrade gracefully.
  let imageBase64: string;
  try {
    imageBase64 = await withRetry(
      () => fetchImageAsBase64(request.mediaUrl, IMAGE_FETCH_TIMEOUT_MS),
      { attempts: 2, baseDelayMs: 300, maxDelayMs: 2000, jitter: true },
    );
  } catch {
    return fallbackResponse(request.mediaAlt, request.nearbyText);
  }

  const userContent = JSON.stringify({
    nearbyText: request.nearbyText.slice(0, 300),
    candidateEntities: request.candidateEntities.slice(0, 8),
    factualHints: request.factualHints.slice(0, 4),
    mediaAlt: request.mediaAlt?.slice(0, 200),
  });

  let rawContent: string;
  try {
    rawContent = await withRetry(
      () => callOllamaVision(model, imageBase64, userContent, env.LLM_TIMEOUT_MS),
      RETRY_OPTIONS,
    );
  } catch {
    return fallbackResponse(request.mediaAlt, request.nearbyText);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return fallbackResponse(request.mediaAlt, request.nearbyText);
  }

  return validateResponse(parsed);
}
