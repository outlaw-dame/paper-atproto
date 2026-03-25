// ─── Qwen3-4B Writer Service — Narwhal v3 ────────────────────────────────
// Calls the locally-running Ollama instance to produce the Interpolator summary.
// Model: qwen3:4b-instruct-2507-q4_K_M
//
// The model writes ONLY from structured thread state — it must not invent
// entities, contributors, or themes. Fallback copies are produced when
// interpretive confidence is low.

import { withRetry } from '../lib/retry.js';
import type { RetryOptions } from '../lib/retry.js';
import { env } from '../config/env.js';

// ─── Types ─────────────────────────────────────────────────────────────────
// These mirror src/intelligence/llmContracts.ts — kept local to avoid
// bundling client types on the server.

export type SummaryMode = 'normal' | 'descriptive_fallback' | 'minimal_fallback';

export interface WriterRequest {
  threadId: string;
  summaryMode: SummaryMode;
  confidence: { surfaceConfidence: number; entityConfidence: number; interpretiveConfidence: number };
  rootPost: { uri: string; handle: string; displayName?: string; text: string; createdAt: string };
  selectedComments: Array<{
    uri: string; handle: string; displayName?: string; text: string;
    impactScore: number; role?: string; liked?: number; replied?: number;
  }>;
  topContributors: Array<{
    did?: string; handle: string; role: string; impactScore: number; stanceSummary: string;
  }>;
  safeEntities: Array<{ id: string; label: string; type: string; confidence: number; impact: number }>;
  factualHighlights: string[];
  whatChangedSignals: string[];
  mediaFindings?: Array<{ mediaType: string; summary: string; confidence: number; extractedText?: string; cautionFlags?: string[] }>;
}

export interface WriterResponse {
  collapsedSummary: string;
  expandedSummary?: string;
  whatChanged: string[];
  contributorBlurbs: Array<{ handle: string; blurb: string }>;
  abstained: boolean;
  mode: SummaryMode;
}

// ─── Prompts ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Glympse Interpolator, a thread summary writer for a social discussion app.

Rules:
- Write ONLY from the structured thread state provided. Do not invent entities, contributors, or themes.
- collapsedSummary must be 1-3 sentences, natural prose, present tense.
- In descriptive_fallback mode: summarize the root post, then describe what replies are doing (playful, clarifying, debating, etc.), name only high-confidence contributors, end with a short uncertainty sentence.
- In minimal_fallback mode: describe the root post in one sentence only. Keep whatChanged empty.
- In normal mode: write a richer summary covering the theme, dominant contributors, and notable angles.
- Never say "the discussion centers on…" unless interpretive confidence is >= 0.60.
- If you cannot write a faithful summary, set abstained: true and collapsedSummary to an empty string.
- Return valid JSON matching the schema exactly. No markdown, no code blocks, just JSON.

Output schema:
{
  "collapsedSummary": "string",
  "expandedSummary": "string or omit",
  "whatChanged": ["string"],
  "contributorBlurbs": [{ "handle": "string", "blurb": "string" }],
  "abstained": false,
  "mode": "normal | descriptive_fallback | minimal_fallback"
}`;

// ─── Ollama caller ─────────────────────────────────────────────────────────

interface OllamaChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

interface OllamaChatResponse {
  message: OllamaChatMessage;
  done: boolean;
}

async function callOllama(
  model: string,
  messages: OllamaChatMessage[],
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${env.OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // think: false disables Qwen3's chain-of-thought tokens so the response
      // is pure JSON without <think>…</think> preamble that would break parsing.
      body: JSON.stringify({ model, messages, stream: false, format: 'json', think: false }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw Object.assign(
        new Error(`Ollama responded ${res.status}`),
        { status: res.status },
      );
    }

    const data = (await res.json()) as OllamaChatResponse;
    return data.message.content;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Validation ────────────────────────────────────────────────────────────

function validateResponse(raw: unknown, mode: SummaryMode): WriterResponse {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Writer returned non-object response');
  }
  const r = raw as Record<string, unknown>;

  const collapsedSummary = typeof r.collapsedSummary === 'string' ? r.collapsedSummary : '';
  const abstained = r.abstained === true || collapsedSummary === '';

  return {
    collapsedSummary,
    expandedSummary: typeof r.expandedSummary === 'string' ? r.expandedSummary : undefined,
    whatChanged: Array.isArray(r.whatChanged)
      ? (r.whatChanged as unknown[]).filter(s => typeof s === 'string').slice(0, 6) as string[]
      : [],
    contributorBlurbs: Array.isArray(r.contributorBlurbs)
      ? (r.contributorBlurbs as unknown[]).filter(
          b => typeof b === 'object' && b !== null && 'handle' in b && 'blurb' in b,
        ).slice(0, 5) as Array<{ handle: string; blurb: string }>
      : [],
    abstained,
    mode: (r.mode as SummaryMode) ?? mode,
  };
}

// ─── Public API ────────────────────────────────────────────────────────────

const RETRY_OPTIONS: RetryOptions = {
  attempts: 3,
  baseDelayMs: 300,
  maxDelayMs: 4000,
  jitter: true,
};

export async function runInterpolatorWriter(request: WriterRequest): Promise<WriterResponse> {
  const model = env.QWEN_WRITER_MODEL;

  const userMessage = JSON.stringify({
    summaryMode: request.summaryMode,
    confidence: request.confidence,
    rootPost: request.rootPost,
    selectedComments: request.selectedComments,
    topContributors: request.topContributors,
    safeEntities: request.safeEntities,
    factualHighlights: request.factualHighlights,
    whatChangedSignals: request.whatChangedSignals,
    ...(request.mediaFindings ? { mediaFindings: request.mediaFindings } : {}),
  });

  const rawContent = await withRetry(
    () => callOllama(
      model,
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      env.LLM_TIMEOUT_MS,
    ),
    RETRY_OPTIONS,
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new Error('Writer returned invalid JSON');
  }

  return validateResponse(parsed, request.summaryMode);
}
