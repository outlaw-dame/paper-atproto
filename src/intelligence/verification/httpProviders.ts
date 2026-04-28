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
} from './types';
import { VerificationBadResponseError, VerificationConfigError, VerificationRateLimitError, VerificationTimeoutError } from './errors';
import { withRetry } from './retry';

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

// ─── VerificationHttpClient ───────────────────────────────────────────────
// High-level client that calls the /api/verify/evidence endpoint on the
// Glympse verify-server and returns a typed VerificationResult.
// API keys and provider secrets live server-side only.

/** Matches the VerificationResult shape returned by the verify-server. */
export interface ServerVerificationResult {
  claimType: string;
  extractedClaim: string | null;
  knownFactCheckMatch: boolean;
  factCheckMatches: Array<{
    claimText: string;
    reviewUrl: string;
    matchConfidence: number;
    textualRating?: string;
    publisherName?: string;
  }>;
  sourcePresence: number;
  sourceType: string;
  sourceDomain?: string;
  citedUrls: string[];
  quoteFidelity: number;
  corroborationLevel: number;
  contradictionLevel: number;
  mediaContextConfidence: number;
  entityGrounding: number;
  contextValue: number;
  correctionValue: number;
  checkability: number;
  specificity: number;
  factualContributionScore: number;
  factualConfidence: number;
  factualState: string;
  reasons: string[];
}

export interface VerificationClientInput {
  postUri?: string;
  text: string;
  urls?: string[];
  imageUrls?: string[];
  languageCode?: string;
  topicHints?: string[];
}

export class VerificationHttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly sharedSecret?: string,
  ) {}

  async verifyEvidence(input: VerificationClientInput): Promise<ServerVerificationResult> {
    const response = await fetch(`${this.baseUrl}/api/verify/evidence`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.sharedSecret !== undefined ? { 'x-verify-shared-secret': this.sharedSecret } : {}),
      },
      body: JSON.stringify(input),
    });

    const data = await response.json() as { ok: boolean; result?: ServerVerificationResult; error?: { message: string } };

    if (!response.ok || !data?.ok) {
      throw new Error(data?.error?.message ?? 'Verification request failed');
    }

    return data.result!;
  }
}

/** Computes the factual contribution boost to add to an existing score. */
export function computeVerificationBoost(verification: {
  factualContributionScore: number;
  factualConfidence: number;
}): number {
  return 0.2 * verification.factualContributionScore * verification.factualConfidence;
}
