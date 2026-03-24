import type {
  ClaimExtractionResult,
  ClaimExtractorProvider,
  FactCheckProvider,
  FactCheckResult,
  GroundingProvider,
  GroundingResult,
  MediaVerificationProvider,
  MediaVerificationResult,
  VerificationRequest,
} from './types.js';
import { VerificationBadResponseError, VerificationConfigError, VerificationRateLimitError, VerificationTimeoutError } from './errors.js';
import { withRetry } from './retry.js';

export interface HttpProviderOptions {
  baseUrl: string;
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
}

async function fetchJson<T>(
  endpoint: string,
  payload: unknown,
  options: HttpProviderOptions,
  signal?: AbortSignal,
): Promise<T> {
  if (!options.baseUrl) {
    throw new VerificationConfigError('Missing verification baseUrl');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);

  try {
    return await withRetry(async () => {
      const response = await fetch(`${options.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.headers ?? {}),
        },
        body: JSON.stringify(payload),
        signal: signal ?? controller.signal,
      });

      if (response.status === 429) {
        throw new VerificationRateLimitError();
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new VerificationBadResponseError(
          `Verification endpoint ${endpoint} failed with ${response.status}${body ? `: ${body}` : ''}`,
        );
      }

      return await response.json() as T;
    }, {
      retries: options.retries ?? 2,
      signal: signal ?? controller.signal,
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      throw new VerificationTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class HttpClaimExtractorProvider implements ClaimExtractorProvider {
  constructor(private readonly options: HttpProviderOptions) {}

  async extractClaim(input: VerificationRequest): Promise<ClaimExtractionResult> {
    return fetchJson<ClaimExtractionResult>('/api/verify/claim', input, this.options, input.signal);
  }
}

export class HttpFactCheckProvider implements FactCheckProvider {
  constructor(private readonly options: HttpProviderOptions) {}

  async lookup(input: { request: VerificationRequest; claims: any[]; signal?: AbortSignal }): Promise<FactCheckResult> {
    return fetchJson<FactCheckResult>('/api/verify/fact-check', input, this.options, input.signal);
  }
}

export class HttpGroundingProvider implements GroundingProvider {
  constructor(private readonly options: HttpProviderOptions) {}

  async ground(input: { request: VerificationRequest; claims: any[]; signal?: AbortSignal }): Promise<GroundingResult> {
    return fetchJson<GroundingResult>('/api/verify/ground', input, this.options, input.signal);
  }
}

export class HttpMediaVerificationProvider implements MediaVerificationProvider {
  constructor(private readonly options: HttpProviderOptions) {}

  async inspect(input: { request: VerificationRequest; claims: any[]; signal?: AbortSignal }): Promise<MediaVerificationResult> {
    return fetchJson<MediaVerificationResult>('/api/verify/media', input, this.options, input.signal);
  }
}
