import type { PagesFunction } from '@cloudflare/workers-types';

interface Env {
  AI?: {
    run(model: string, input: unknown): Promise<unknown>;
  };
}

const MODEL_ID = '@cf/huggingface/distilbert-sst-2-int8' as const;
const RETRIES = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

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

function getDraftText(value: unknown): string | null {
  if (!isRecord(value) || typeof value.draftText !== 'string') return null;
  const draftText = value.draftText.replace(/\s+/g, ' ').trim().slice(0, 1200);
  return draftText.length > 0 ? draftText : null;
}

function extractCandidates(raw: unknown): Array<{ label?: unknown; score?: unknown }> {
  if (Array.isArray(raw)) return raw as Array<{ label?: unknown; score?: unknown }>;
  if (!isRecord(raw)) return [];
  if (Array.isArray(raw.result)) return raw.result as Array<{ label?: unknown; score?: unknown }>;
  if (Array.isArray(raw.response)) return raw.response as Array<{ label?: unknown; score?: unknown }>;
  return [];
}

function normalizeSentiment(raw: unknown) {
  const top = extractCandidates(raw)
    .map((entry) => {
      const labelText = String(entry.label ?? '').toLowerCase();
      const label = labelText.includes('negative') ? 'negative' : labelText.includes('positive') ? 'positive' : 'neutral';
      return { label, score: clamp01(Number(entry.score ?? 0)) };
    })
    .sort((left, right) => right.score - left.score)[0];
  return top ? { label: top.label, confidence: Math.round(Math.max(top.score, 0.01) * 1000) / 1000 } : { label: 'neutral', confidence: 0.5 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runModel(ai: Env['AI'], draftText: string): Promise<unknown> {
  if (!ai) throw new Error('Workers AI binding missing');
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    try {
      return await ai.run(MODEL_ID, { text: draftText });
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES - 1) {
        await sleep(120 + Math.floor(Math.random() * 120));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Workers AI failed');
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
  const draftText = getDraftText(body);
  if (!draftText) return json({ error: 'Invalid request' }, 400);
  try {
    const raw = await runModel(context.env.AI, draftText);
    const sentiment = normalizeSentiment(raw);
    return json({
      provider: 'cloudflare-workers-ai',
      model: MODEL_ID,
      confidence: sentiment.confidence,
      toolsUsed: ['edge-classifier', 'sentiment-polarity'],
      ml: { sentiment },
      abuseScore: null,
    });
  } catch {
    return json({ error: 'Workers AI classifier failed', code: 'WORKERS_AI_FAILED' }, 503);
  }
};
