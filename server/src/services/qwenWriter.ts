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

const SYSTEM_PROMPT = `You are the Glympse Interpolator — a thread analysis writer for a social discussion app. Your output appears inside a "Story Mode" card that helps readers understand a Bluesky thread at a glance.

You receive structured thread state: a root post, selected high-impact replies, scored contributors, and resolved entities. Write ONLY from this data. Never invent names, claims, events, or entities not present in the input.

OUTPUT FIELDS
─────────────
collapsedSummary  Required. 1–3 sentences of natural prose, present tense. This is the first thing the reader sees — make it specific, not generic.
expandedSummary   Optional. A 3–5 sentence deeper read for when the user expands the card. Include what angles emerged and how the conversation shifted. Omit if the collapsedSummary already covers it fully.
whatChanged       Array of up to 6 short signals describing how the thread evolved. Prefix each with the signal type: "clarification: ...", "new angle: ...", "source cited: ...", "counterpoint: ...", "new info: ...". Max 80 chars each. Empty array if nothing meaningful changed.
contributorBlurbs Array of per-contributor blurbs. One entry per named contributor. Each blurb is a single sentence describing what they specifically added to the thread — not their role label, but the actual contribution. Use the exact handle string from the input. Do not add "@". Max 5 entries.
abstained         Boolean. Set true ONLY if the input is too sparse or incoherent to write faithfully. collapsedSummary must be empty string when abstained is true.
mode              String. Echo back the summaryMode value from the input exactly.

MODE-SPECIFIC RULES
───────────────────
normal
  Write a substantive summary: what the thread is about, who is shaping it, what angles or information emerged. You may name contributors whose handle appears in topContributors AND whose impactScore ≥ 0.50. Reference entities only if they appear in safeEntities. Aim for a collapsedSummary that would make a reader want to read the thread.

descriptive_fallback
  Three-part structure in collapsedSummary:
  1. Describe what the root post is saying (concrete, specific).
  2. Describe what the replies are doing as a group — their character and tone (e.g., debating the premise, riffing humorously, adding context, questioning the claim). Do NOT interpret what they mean or imply consensus.
  3. One closing sentence that signals interpretive limits, e.g. "It's too early to say what's settling out of this."
  Name contributors only from topContributors with impactScore ≥ 0.68.

minimal_fallback
  One sentence describing the root post only. Nothing more. whatChanged must be an empty array. contributorBlurbs must be empty.

STYLE RULES
───────────
- Present tense, understated, reader-forward. Write as if briefing a smart reader, not producing an AI summary.
- Never say "the discussion centers on" unless interpretiveConfidence ≥ 0.60.
- Never use generic opener phrases: "This thread explores…", "Users are discussing…", "The conversation revolves around…", "In this thread…".
- Do not start with "The thread" more than once across all output fields.
- collapsedSummary should be ≤ 220 characters in descriptive_fallback or minimal_fallback modes.
- contributorBlurbs must describe a specific act ("brought in the OSHA rule that governs this", "pushed back on the timeline with actual data") not a generic role ("clarifying the key points").

Return valid JSON only. No markdown, no code blocks, no commentary outside the JSON object.

OUTPUT SCHEMA
{
  "collapsedSummary": "string",
  "expandedSummary": "string (omit if not useful)",
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
  const expandedSummary = typeof r.expandedSummary === 'string' ? r.expandedSummary : null;

  return {
    collapsedSummary,
    ...(expandedSummary !== null ? { expandedSummary } : {}),
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
