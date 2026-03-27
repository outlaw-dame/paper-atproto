import { withRetry } from '../lib/retry.js';
import type { RetryOptions } from '../lib/retry.js';
import { env } from '../config/env.js';
import { detectHarmfulContent, ensureSafetyInstructions } from '../lib/safeguards.js';

export interface ComposerGuidanceWriterRequest {
  mode: 'post' | 'reply' | 'hosted_thread';
  draftText: string;
  parentText?: string;
  uiState: 'positive' | 'caution' | 'warning';
  scores: {
    positiveSignal: number;
    negativeSignal: number;
    supportiveness: number;
    constructiveness: number;
    clarifying: number;
    hostility: number;
    dismissiveness: number;
    escalation: number;
    sentimentPositive: number;
    sentimentNegative: number;
    anger: number;
    trust: number;
    optimism: number;
    targetedNegativity: number;
    toxicity: number;
  };
  constructiveSignals: string[];
  supportiveSignals: string[];
  parentSignals: string[];
}

export interface ComposerGuidanceWriterResponse {
  message: string;
  suggestion?: string;
  badges: string[];
}

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaChatResponse {
  message: OllamaChatMessage;
  done: boolean;
}

const SYSTEM_PROMPT_BASE = `You are the Glympse Composer Guidance Writer.

You do not moderate or block. You coach. Your job is to turn structured composer guidance into short, non-shaming copy for a social writing surface.

RULES
- Never tell the user they cannot post.
- Never moralize, shame, or diagnose.
- Use calm coaching language.
- For positive states, reinforce what is working.
- For caution states, give a light nudge.
- For warning states, explain that the draft may escalate or sound personal.
- Keep the message short: one sentence, max 110 characters.
- suggestion is optional and should be one sentence, max 120 characters.
- badges must be short product labels, max 3 total, max 20 chars each.
- Do not quote the draft back.
- Do not mention scores, models, classifiers, moderation, safety systems, or policy.

OUTPUT JSON ONLY
{
  "message": "string",
  "suggestion": "string (optional)",
  "badges": ["string"]
}`;

const SYSTEM_PROMPT = ensureSafetyInstructions(SYSTEM_PROMPT_BASE);

const OLLAMA_OPTIONS = {
  temperature: 0.4,
  repeat_penalty: 1.12,
  top_p: 0.9,
  num_predict: 220,
} as const;

const RETRY_OPTIONS: RetryOptions = {
  attempts: 3,
  baseDelayMs: 300,
  maxDelayMs: 4000,
  jitter: true,
};

function sanitizeText(value: string, maxLength: number): string {
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function looksShaming(text: string): boolean {
  return /\b(you should be ashamed|shame on you|you are toxic|you are abusive|bad person)\b/i.test(text);
}

function validateResponse(raw: unknown): ComposerGuidanceWriterResponse {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Composer guidance writer returned non-object response');
  }

  const record = raw as Record<string, unknown>;
  const message = typeof record.message === 'string'
    ? sanitizeText(record.message, 110)
    : '';
  const suggestion = typeof record.suggestion === 'string'
    ? sanitizeText(record.suggestion, 120)
    : undefined;
  const badges = Array.isArray(record.badges)
    ? Array.from(new Set(
        record.badges
          .filter((badge) => typeof badge === 'string')
          .map((badge) => sanitizeText(String(badge), 20))
          .filter((badge) => badge.length >= 2),
      )).slice(0, 3)
    : [];

  if (!message || looksShaming(message) || detectHarmfulContent(message).isHarmful) {
    throw new Error('Composer guidance writer returned unsafe or empty message');
  }

  if (
    suggestion
    && (looksShaming(suggestion) || detectHarmfulContent(suggestion).isHarmful)
  ) {
    return { message, badges };
  }

  return {
    message,
    ...(suggestion ? { suggestion } : {}),
    badges,
  };
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
      body: JSON.stringify({ model, messages, stream: false, format: 'json', think: false, options: OLLAMA_OPTIONS }),
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

function buildUserMessage(request: ComposerGuidanceWriterRequest): string {
  const lines: string[] = [];
  lines.push(`MODE: ${request.mode}`);
  lines.push(`UI STATE: ${request.uiState}`);
  lines.push(`DRAFT: ${request.draftText}`);

  if (request.parentText) {
    lines.push(`PARENT: ${request.parentText}`);
  }

  lines.push(
    `SCORES: positive=${request.scores.positiveSignal.toFixed(2)}, negative=${request.scores.negativeSignal.toFixed(2)}, supportive=${request.scores.supportiveness.toFixed(2)}, constructive=${request.scores.constructiveness.toFixed(2)}, clarifying=${request.scores.clarifying.toFixed(2)}, hostility=${request.scores.hostility.toFixed(2)}, dismissive=${request.scores.dismissiveness.toFixed(2)}, escalating=${request.scores.escalation.toFixed(2)}, targetedNegativity=${request.scores.targetedNegativity.toFixed(2)}`,
  );

  if (request.supportiveSignals.length > 0) {
    lines.push(`SUPPORTIVE SIGNALS: ${request.supportiveSignals.join(' | ')}`);
  }
  if (request.constructiveSignals.length > 0) {
    lines.push(`CONSTRUCTIVE SIGNALS: ${request.constructiveSignals.join(' | ')}`);
  }
  if (request.parentSignals.length > 0) {
    lines.push(`CONTEXT SIGNALS: ${request.parentSignals.join(' | ')}`);
  }

  return lines.join('\n');
}

export async function runComposerGuidanceWriter(
  request: ComposerGuidanceWriterRequest,
): Promise<ComposerGuidanceWriterResponse> {
  const model = env.QWEN_WRITER_MODEL;
  const rawContent = await withRetry(
    () => callOllama(
      model,
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserMessage(request) },
      ],
      env.LLM_TIMEOUT_MS,
    ),
    RETRY_OPTIONS,
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new Error('Composer guidance writer returned invalid JSON');
  }

  return validateResponse(parsed);
}
