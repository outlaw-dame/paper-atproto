import type {
  BatchTranslateRequest,
  BatchTranslateResponse,
  DetectLanguageRequest,
  DetectLanguageResponse,
  InlineTranslateRequest,
  InlineTranslateResponse,
  LanguageDetectionResult,
  TranslationResult,
} from './types';
import { getConfiguredApiBaseUrl, resolveApiUrl } from '../apiBase';

export type TranslationHttpClientConfig = {
  baseUrl: string;
  timeoutMs: number;
};

export type TranslationHttpTelemetrySnapshot = {
  queuedRequests: number;
  retries: number;
  successes: number;
  failures: number;
  inFlight: number;
  pendingQueue: number;
  peakQueueDepth: number;
};

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 300;
const RETRY_MAX_MS = 3000;
const RETRY_JITTER = 0.3;
const MAX_CONCURRENT_TRANSLATION_REQUESTS = 4;

function isRetryable(status: number): boolean {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

function delayMs(attempt: number): number {
  const exp = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
  const jitter = exp * RETRY_JITTER;
  return Math.floor(exp - jitter + Math.random() * jitter * 2);
}

function delayMsForStatus(attempt: number, retryAfterHeader: string | null): number {
  const parsed = Number(retryAfterHeader ?? '');
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(RETRY_MAX_MS, Math.floor(parsed * 1000));
  }
  return delayMs(attempt);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class TranslationHttpClient {
  private activeRequests = 0;
  private readonly queue: Array<() => void> = [];
  private telemetry: Omit<TranslationHttpTelemetrySnapshot, 'inFlight' | 'pendingQueue'> = {
    queuedRequests: 0,
    retries: 0,
    successes: 0,
    failures: 0,
    peakQueueDepth: 0,
  };

  constructor(private readonly config: TranslationHttpClientConfig) {}

  private async withConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeRequests >= MAX_CONCURRENT_TRANSLATION_REQUESTS) {
      this.telemetry.queuedRequests += 1;
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
        this.telemetry.peakQueueDepth = Math.max(this.telemetry.peakQueueDepth, this.queue.length);
      });
    }

    this.activeRequests += 1;
    try {
      return await fn();
    } finally {
      this.activeRequests = Math.max(0, this.activeRequests - 1);
      const next = this.queue.shift();
      next?.();
    }
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    return this.withConcurrencyLimit(async () => {
      let lastError: unknown;

      for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

        try {
          const response = await fetch(resolveApiUrl(path, this.config.baseUrl), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            const err = new Error(`translate ${path} failed (${response.status}): ${errorBody}`);
            lastError = err;
            if (!isRetryable(response.status) || attempt === RETRY_ATTEMPTS - 1) throw err;
            this.telemetry.retries += 1;
            await sleep(delayMsForStatus(attempt, response.headers.get('retry-after')));
            continue;
          }
          this.telemetry.successes += 1;
          return (await response.json()) as T;
        } catch (err) {
          lastError = err;
          if (attempt === RETRY_ATTEMPTS - 1) {
            this.telemetry.failures += 1;
            throw err;
          }
          this.telemetry.retries += 1;
          await sleep(delayMs(attempt));
        } finally {
          clearTimeout(timeoutId);
        }
      }

      throw lastError ?? new Error('Unknown translation client error');
    });
  }

  getTelemetrySnapshot(): TranslationHttpTelemetrySnapshot {
    return {
      ...this.telemetry,
      inFlight: this.activeRequests,
      pendingQueue: this.queue.length,
    };
  }

  resetTelemetry(): void {
    this.telemetry = {
      queuedRequests: 0,
      retries: 0,
      successes: 0,
      failures: 0,
      peakQueueDepth: 0,
    };
  }

  async translateInline(req: InlineTranslateRequest): Promise<TranslationResult> {
    const payload = {
      id: req.id,
      sourceText: req.sourceText,
      targetLang: req.targetLang,
      mode: req.mode,
      ...(req.sourceLang ? { sourceLang: req.sourceLang } : {}),
    };
    const response = await this.postJson<InlineTranslateResponse>('/api/translate/inline', payload);
    return response.result;
  }

  async translateBatch(req: BatchTranslateRequest): Promise<TranslationResult[]> {
    const response = await this.postJson<BatchTranslateResponse>('/api/translate/batch', req);
    return response.results;
  }

  async detectLanguage(req: DetectLanguageRequest): Promise<LanguageDetectionResult> {
    const response = await this.postJson<DetectLanguageResponse>('/api/translate/detect', req);
    return response.result;
  }
}

export const translationClient = new TranslationHttpClient({
  baseUrl: getConfiguredApiBaseUrl(
    (import.meta as any).env?.VITE_GLYMPSE_TRANSLATE_BASE_URL,
    (import.meta as any).env?.VITE_GLYMPSE_API_BASE_URL,
  ),
  timeoutMs: Number((import.meta as any).env?.VITE_GLYMPSE_TRANSLATE_TIMEOUT_MS ?? 20_000),
});

if (typeof window !== 'undefined') {
  (window as Window & {
    __glympseTranslationTelemetry?: () => TranslationHttpTelemetrySnapshot;
  }).__glympseTranslationTelemetry = () => translationClient.getTelemetrySnapshot();
}
