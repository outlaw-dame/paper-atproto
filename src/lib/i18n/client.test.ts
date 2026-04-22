import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationHttpClient } from './client';
import type { TranslationResult } from './types';

describe('TranslationHttpClient smoke coverage', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('sends selected target language in inline payloads across multiple locales', async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const result: TranslationResult = {
        id: String(body.id ?? 'id'),
        translatedText: 'ok',
        sourceLang: 'en',
        targetLang: String(body.targetLang ?? 'en'),
        provider: 'm2m100',
        cached: false,
        modelVersion: 'test',
        qualityTier: 'default',
      };

      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result }),
      } as Response;
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new TranslationHttpClient({ baseUrl: '', timeoutMs: 5_000 });
    const targetLangs = ['es', 'fr', 'de', 'ja', 'pt'];

    for (const targetLang of targetLangs) {
      const response = await client.translateInline({
        id: `post-${targetLang}`,
        sourceText: 'hello world',
        targetLang,
        mode: 'server_default',
      });
      expect(response.targetLang).toBe(targetLang);
    }

    const calledTargetLangs = fetchMock.mock.calls.map((call) => {
      const init = call[1] as RequestInit | undefined;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      return body.targetLang;
    });

    expect(calledTargetLangs).toEqual(targetLangs);
  });

  it('retries aborted requests before succeeding', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(abortError)
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: {
            id: 'retry-post',
            translatedText: 'bonjour',
            sourceLang: 'en',
            targetLang: 'fr',
            provider: 'm2m100',
            cached: false,
            modelVersion: 'test',
            qualityTier: 'default',
          },
        }),
      } as Response);

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new TranslationHttpClient({ baseUrl: '', timeoutMs: 5_000 });
    const result = await client.translateInline({
      id: 'retry-post',
      sourceText: 'hello',
      targetLang: 'fr',
      mode: 'server_default',
    });

    expect(result.targetLang).toBe('fr');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('tracks telemetry for successes and retries', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(abortError)
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: {
            id: 'telemetry-post',
            translatedText: 'hola',
            sourceLang: 'en',
            targetLang: 'es',
            provider: 'm2m100',
            cached: false,
            modelVersion: 'test',
            qualityTier: 'default',
          },
        }),
      } as Response);

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new TranslationHttpClient({ baseUrl: '', timeoutMs: 5_000 });
    await client.translateInline({
      id: 'telemetry-post',
      sourceText: 'hello',
      targetLang: 'es',
      mode: 'server_default',
    });

    const snapshot = client.getTelemetrySnapshot();
    expect(snapshot.successes).toBe(1);
    expect(snapshot.retries).toBeGreaterThanOrEqual(1);
    expect(snapshot.failures).toBe(0);

    client.resetTelemetry();
    const reset = client.getTelemetrySnapshot();
    expect(reset.successes).toBe(0);
    expect(reset.retries).toBe(0);
    expect(reset.failures).toBe(0);
  });
});
