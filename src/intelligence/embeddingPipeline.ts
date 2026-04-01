import { inferenceClient } from '../workers/InferenceClient';

const MAX_QUEUE_DEPTH = 128;
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 250;
const CAP_DELAY_MS = 3_000;

type EmbeddingMode = 'query' | 'ingest' | 'filter';

interface EmbedOptions {
  mode?: EmbeddingMode;
}

interface BatchEmbedOptions extends EmbedOptions {
  batchSize?: number;
}

function sanitizeForEmbedding(input: string): string {
  return input
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\b(?:did:[a-z0-9:._-]+)\b/gi, '[did]')
    .replace(/\b@[a-z0-9._-]+\b/gi, '[handle]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2_000);
}

function jitteredDelay(baseDelayMs: number, previousDelayMs: number, capDelayMs: number): number {
  const lower = baseDelayMs;
  const upper = Math.min(capDelayMs, previousDelayMs * 3);
  return lower + Math.random() * (upper - lower);
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

class EmbeddingPipeline {
  private queueTail: Promise<void> = Promise.resolve();
  private queuedTasks = 0;
  private inFlightByKey = new Map<string, Promise<number[]>>();

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    if (this.queuedTasks >= MAX_QUEUE_DEPTH) {
      return Promise.reject(new Error('Embedding queue is saturated. Please retry shortly.'));
    }

    this.queuedTasks += 1;

    const run = async () => {
      try {
        return await work();
      } finally {
        this.queuedTasks = Math.max(0, this.queuedTasks - 1);
      }
    };

    const chained = this.queueTail.then(run, run);
    this.queueTail = chained.then(() => undefined, () => undefined);
    return chained;
  }

  private async embedWithRetry(text: string): Promise<number[]> {
    let previousDelayMs = BASE_DELAY_MS;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await inferenceClient.embed(text);
      } catch (error) {
        lastError = error;
        if (attempt >= MAX_ATTEMPTS) break;
        const delayMs = Math.max(0, Math.round(jitteredDelay(BASE_DELAY_MS, previousDelayMs, CAP_DELAY_MS)));
        previousDelayMs = delayMs;
        await sleep(delayMs);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Embedding generation failed');
  }

  async embed(text: string, _options: EmbedOptions = {}): Promise<number[]> {
    const sanitized = sanitizeForEmbedding(text);
    if (!sanitized) return [];

    const dedupeKey = sanitized;
    const existing = this.inFlightByKey.get(dedupeKey);
    if (existing) return existing;

    const task = this.enqueue(async () => this.embedWithRetry(sanitized));
    this.inFlightByKey.set(dedupeKey, task);

    try {
      const vector = await task;
      return vector;
    } finally {
      this.inFlightByKey.delete(dedupeKey);
    }
  }

  async embedBatch(texts: string[], options: BatchEmbedOptions = {}): Promise<number[][]> {
    const batchSize = Math.max(1, Math.min(32, options.batchSize ?? 12));
    if (texts.length === 0) return [];

    const sanitized = texts.map((text) => sanitizeForEmbedding(text));
    const outputs: number[][] = Array.from({ length: texts.length }, () => []);

    const uniqueToIndexes = new Map<string, { sanitized: string; indexes: number[] }>();
    sanitized.forEach((value, index) => {
      if (!value) return;
      const existing = uniqueToIndexes.get(value);
      if (existing) {
        existing.indexes.push(index);
      } else {
        uniqueToIndexes.set(value, { sanitized: value, indexes: [index] });
      }
    });

    const uniqueItems = [...uniqueToIndexes.values()];

    for (let offset = 0; offset < uniqueItems.length; offset += batchSize) {
      const window = uniqueItems.slice(offset, offset + batchSize);
      const vectors = await Promise.all(window.map((item) => this.embed(item.sanitized, options)));
      for (let i = 0; i < window.length; i += 1) {
        const { indexes } = window[i]!;
        const vector = vectors[i] ?? [];
        for (const index of indexes) {
          outputs[index] = vector;
        }
      }
    }

    return outputs;
  }
}

export const embeddingPipeline = new EmbeddingPipeline();
export { sanitizeForEmbedding };
