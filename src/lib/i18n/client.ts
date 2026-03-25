import type {
  BatchTranslateRequest,
  BatchTranslateResponse,
  DetectLanguageRequest,
  DetectLanguageResponse,
  InlineTranslateRequest,
  InlineTranslateResponse,
  LanguageDetectionResult,
  TranslationResult,
} from './types.js';

export type TranslationHttpClientConfig = {
  baseUrl: string;
  timeoutMs: number;
};

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 300;
const RETRY_MAX_MS = 3000;
const RETRY_JITTER = 0.3;

function isRetryable(status: number): boolean {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

function delayMs(attempt: number): number {
  const exp = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
  const jitter = exp * RETRY_JITTER;
  return Math.floor(exp - jitter + Math.random() * jitter * 2);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class TranslationHttpClient {
  constructor(private readonly config: TranslationHttpClientConfig) {}

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const response = await fetch(`${this.config.baseUrl}${path}`, {
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
          await sleep(delayMs(attempt));
          continue;
        }

        return (await response.json()) as T;
      } catch (err) {
        lastError = err;
        const isAbort = err instanceof Error && err.name === 'AbortError';
        if (isAbort || attempt === RETRY_ATTEMPTS - 1) throw err;
        await sleep(delayMs(attempt));
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw lastError ?? new Error('Unknown translation client error');
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
  baseUrl: (import.meta as any).env?.VITE_GLYMPSE_TRANSLATE_BASE_URL ?? 'http://localhost:3001',
  timeoutMs: Number((import.meta as any).env?.VITE_GLYMPSE_TRANSLATE_TIMEOUT_MS ?? 12_000),
});
