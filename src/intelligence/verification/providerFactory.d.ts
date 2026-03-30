import type { VerificationProviders } from './types.js';
/**
 * Returns a singleton VerificationProviders instance.
 * Falls back to heuristic/noop providers when VITE_GLYMPSE_VERIFY_BASE_URL
 * is not configured.
 */
export declare function createVerificationProviders(): VerificationProviders;
/**
 * Clears the cached providers — useful in tests or when env vars change.
 */
export declare function resetVerificationProviders(): void;
//# sourceMappingURL=providerFactory.d.ts.map