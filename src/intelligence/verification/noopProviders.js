import { checkabilityScore, inferClaimType } from './utils.js';
export class HeuristicClaimExtractorProvider {
    async extractClaim(input) {
        const claimType = inferClaimType(input.text);
        const claim = {
            text: input.text,
            claimType,
            checkability: checkabilityScore(input.text, claimType),
            quotedTextSpans: [],
        };
        return {
            claims: [claim],
            model: 'heuristic',
            latencyMs: 0,
        };
    }
}
export class NoopFactCheckProvider {
    async lookup() {
        return {
            matched: false,
            hits: [],
            model: 'noop',
            latencyMs: 0,
        };
    }
}
export class NoopGroundingProvider {
    async ground() {
        return {
            sources: [],
            corroborationLevel: 0,
            contradictionLevel: 0,
            model: 'noop',
            latencyMs: 0,
        };
    }
}
export class NoopMediaVerificationProvider {
    async inspect() {
        return {
            matches: [],
            mediaContextConfidence: 0,
            mediaContextWarning: false,
            model: 'noop',
            latencyMs: 0,
        };
    }
}
//# sourceMappingURL=noopProviders.js.map