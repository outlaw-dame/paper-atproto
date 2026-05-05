import type { PagesFunction } from '@cloudflare/workers-types';

type MediaType = 'screenshot' | 'chart' | 'document' | 'photo' | 'meme' | 'unknown';

interface Env {
  AI?: {
    run(model: string, input: unknown): Promise<unknown>;
  };
  WORKERS_AI_MULTIMODAL_MODEL?: string;
}

interface MediaAnalysisRequest {
  threadId: string;
  mediaUrl: string;
  mediaAlt?: string | undefined;
  nearbyText: string;
  candidateEntities: string[];
  factualHints: string[];
}

interface MediaAnalysisResult {
  mediaCentrality: number;
  mediaType: MediaType;
  extractedText?: string | undefined;
  mediaSummary: string;
  candidateEntities: string[];
  confidence: number;
  cautionFlags: string[];
  analysisStatus?: 'complete' | 'degraded' | undefined;
  moderationStatus?: 'authoritative' | 'unavailable' | undefined;
}

const DEFAULT_MODEL_ID = '@cf/meta/llama-3.2-11b-vision-instruct';
const MAX_NEARBY_TEXT_CHARS = 900;
const MAX_ENTITY_COUNT = 6;
const MAX_HINT_COUNT = 5;
const RETRIES = 2;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, private',
      'x-content-type-options': 'nosniff',
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeText(value: unknown, limit = MAX_NEARBY_TEXT_CHARS): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function clamp01(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function sanitizeList(values: unknown, limit: number): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => sanitizeText(value, 80))
    .filter(Boolean)
    .slice(0, limit);
}

function parseRequest(value: unknown): MediaAnalysisRequest | null {
  if (!isRecord(value)) return null;
  const mediaUrl = sanitizeText(value.mediaUrl, 2_000);
  const nearbyText = sanitizeText(value.nearbyText, MAX_NEARBY_TEXT_CHARS);
  const threadId = sanitizeText(value.threadId, 256);
  if (!mediaUrl || !nearbyText || !threadId) return null;
  return {
    threadId,
    mediaUrl,
    nearbyText,
    mediaAlt: sanitizeText(value.mediaAlt, 280) || undefined,
    candidateEntities: sanitizeList(value.candidateEntities, MAX_ENTITY_COUNT),
    factualHints: sanitizeList(value.factualHints, MAX_HINT_COUNT),
  };
}

function buildPrompt(request: MediaAnalysisRequest): string {
  const lines = [
    'Analyze the image for a social-thread media understanding task.',
    'Return strict JSON with keys: mediaType, mediaSummary, extractedText, candidateEntities, confidence, cautionFlags.',
    'Keep mediaSummary to one sentence grounded only in visible evidence.',
    'Do not invent entities not visible or strongly implied by nearby thread text.',
    `Nearby thread text: ${request.nearbyText}`,
  ];

  if (request.mediaAlt) lines.push(`Alt text: ${request.mediaAlt}`);
  if (request.candidateEntities.length > 0) {
    lines.push(`Preferred candidate entities: ${request.candidateEntities.join(', ')}`);
  }
  if (request.factualHints.length > 0) {
    lines.push(`Factual hints: ${request.factualHints.join(' | ')}`);
  }

  return lines.join('\n');
}

function normalizeMediaType(value: unknown): MediaType {
  const text = sanitizeText(value, 32).toLowerCase();
  if (text === 'screenshot' || text === 'chart' || text === 'document' || text === 'photo' || text === 'meme') {
    return text;
  }
  if (text.includes('screen')) return 'screenshot';
  if (text.includes('chart') || text.includes('graph')) return 'chart';
  if (text.includes('document') || text.includes('paper')) return 'document';
  if (text.includes('photo') || text.includes('image')) return 'photo';
  if (text.includes('meme')) return 'meme';
  return 'unknown';
}

function fallbackResult(request: MediaAnalysisRequest, model: string, reason: string): MediaAnalysisResult & { provider: string; model: string } {
  return {
    provider: 'cloudflare-workers-ai',
    model,
    mediaCentrality: request.candidateEntities.length > 0 ? 0.72 : 0.58,
    mediaType: 'unknown',
    mediaSummary: request.mediaAlt || request.nearbyText || 'Media attached to the thread.',
    extractedText: undefined,
    candidateEntities: request.candidateEntities.slice(0, 3),
    confidence: 0.34,
    cautionFlags: [reason],
    analysisStatus: 'degraded',
    moderationStatus: 'unavailable',
  };
}

function extractJsonCandidate(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1);
  return trimmed;
}

function normalizeResult(raw: unknown, request: MediaAnalysisRequest, model: string): MediaAnalysisResult & { provider: string; model: string } {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(extractJsonCandidate(raw));
    } catch {
      return fallbackResult(request, model, 'workers_ai_unstructured_response');
    }
  }

  const record = isRecord(parsed) ? parsed : null;
  if (!record) return fallbackResult(request, model, 'workers_ai_invalid_response');

  const returnedEntities = sanitizeList(record.candidateEntities, MAX_ENTITY_COUNT);
  const candidateEntities = returnedEntities.length > 0
    ? returnedEntities
    : request.candidateEntities.slice(0, MAX_ENTITY_COUNT);

  return {
    provider: 'cloudflare-workers-ai',
    model,
    mediaCentrality: clamp01(Number(record.mediaCentrality ?? record.centrality ?? 0.7), 0.7),
    mediaType: normalizeMediaType(record.mediaType),
    extractedText: sanitizeText(record.extractedText, 600) || undefined,
    mediaSummary: sanitizeText(record.mediaSummary, 320) || request.mediaAlt || request.nearbyText,
    candidateEntities,
    confidence: clamp01(Number(record.confidence ?? 0.72), 0.72),
    cautionFlags: sanitizeList(record.cautionFlags, 6),
    analysisStatus: 'complete',
    moderationStatus: 'unavailable',
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runModel(ai: Env['AI'], model: string, request: MediaAnalysisRequest): Promise<unknown> {
  if (!ai) throw new Error('Workers AI binding missing');
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    try {
      return await ai.run(model, {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: buildPrompt(request),
              },
              {
                type: 'input_image',
                image_url: request.mediaUrl,
              },
            ],
          },
        ],
        response_format: {
          type: 'json_object',
        },
      });
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES - 1) {
        await sleep(180 + Math.floor(Math.random() * 120));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Workers AI failed');
}

export async function runWorkersAiMediaClassifier(
  ai: Env['AI'],
  model: string,
  request: MediaAnalysisRequest,
): Promise<MediaAnalysisResult & { provider: string; model: string }> {
  const raw = await runModel(ai, model, request);
  return normalizeResult(raw, request, model);
}

export const onRequest: PagesFunction<Env> = async (context): Promise<Response> => {
  if (context.request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!context.env.AI) return json({ error: 'Workers AI unavailable', code: 'WORKERS_AI_UNAVAILABLE' }, 503);

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const request = parseRequest(body);
  if (!request) return json({ error: 'Invalid request' }, 400);

  const model = sanitizeText(context.env.WORKERS_AI_MULTIMODAL_MODEL, 128) || DEFAULT_MODEL_ID;

  try {
    return json(await runWorkersAiMediaClassifier(context.env.AI, model, request));
  } catch {
    return json(fallbackResult(request, model, 'workers_ai_failed'), 200);
  }
};