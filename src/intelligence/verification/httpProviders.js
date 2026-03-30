import { VerificationBadResponseError, VerificationConfigError, VerificationRateLimitError, VerificationTimeoutError } from './errors.js';
import { withRetry } from './retry.js';
async function fetchJson(endpoint, payload, options, signal) {
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
                throw new VerificationBadResponseError(`Verification endpoint ${endpoint} failed with ${response.status}${body ? `: ${body}` : ''}`);
            }
            return await response.json();
        }, {
            retries: options.retries ?? 2,
            signal: signal ?? controller.signal,
        });
    }
    catch (error) {
        if (error?.name === 'AbortError') {
            throw new VerificationTimeoutError();
        }
        throw error;
    }
    finally {
        clearTimeout(timer);
    }
}
export class HttpClaimExtractorProvider {
    options;
    constructor(options) {
        this.options = options;
    }
    async extractClaim(input) {
        return fetchJson('/api/verify/claim', input, this.options, input.signal);
    }
}
export class HttpFactCheckProvider {
    options;
    constructor(options) {
        this.options = options;
    }
    async lookup(input) {
        return fetchJson('/api/verify/fact-check', input, this.options, input.signal);
    }
}
export class HttpGroundingProvider {
    options;
    constructor(options) {
        this.options = options;
    }
    async ground(input) {
        return fetchJson('/api/verify/ground', input, this.options, input.signal);
    }
}
export class HttpMediaVerificationProvider {
    options;
    constructor(options) {
        this.options = options;
    }
    async inspect(input) {
        return fetchJson('/api/verify/media', input, this.options, input.signal);
    }
}
export class VerificationHttpClient {
    baseUrl;
    sharedSecret;
    constructor(baseUrl, sharedSecret) {
        this.baseUrl = baseUrl;
        this.sharedSecret = sharedSecret;
    }
    async verifyEvidence(input) {
        const response = await fetch(`${this.baseUrl}/api/verify/evidence`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(this.sharedSecret !== undefined ? { 'x-verify-shared-secret': this.sharedSecret } : {}),
            },
            body: JSON.stringify(input),
        });
        const data = await response.json();
        if (!response.ok || !data?.ok) {
            throw new Error(data?.error?.message ?? 'Verification request failed');
        }
        return data.result;
    }
}
/** Computes the factual contribution boost to add to an existing score. */
export function computeVerificationBoost(verification) {
    return 0.2 * verification.factualContributionScore * verification.factualConfidence;
}
//# sourceMappingURL=httpProviders.js.map