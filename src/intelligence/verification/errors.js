export class VerificationError extends Error {
    code;
    retryable;
    constructor(message, options) {
        super(message);
        this.name = 'VerificationError';
        this.code = options?.code ?? 'VERIFICATION_ERROR';
        this.retryable = options?.retryable ?? false;
        if (options?.cause !== undefined) {
            this.cause = options.cause;
        }
    }
}
export class VerificationTimeoutError extends VerificationError {
    constructor(message = 'Verification provider timed out', cause) {
        super(message, { code: 'VERIFICATION_TIMEOUT', retryable: true, cause });
        this.name = 'VerificationTimeoutError';
    }
}
export class VerificationRateLimitError extends VerificationError {
    constructor(message = 'Verification provider rate limited', cause) {
        super(message, { code: 'VERIFICATION_RATE_LIMIT', retryable: true, cause });
        this.name = 'VerificationRateLimitError';
    }
}
export class VerificationBadResponseError extends VerificationError {
    constructor(message = 'Verification provider returned an invalid response', cause) {
        super(message, { code: 'VERIFICATION_BAD_RESPONSE', retryable: false, cause });
        this.name = 'VerificationBadResponseError';
    }
}
export class VerificationConfigError extends VerificationError {
    constructor(message = 'Verification provider is misconfigured', cause) {
        super(message, { code: 'VERIFICATION_CONFIG', retryable: false, cause });
        this.name = 'VerificationConfigError';
    }
}
//# sourceMappingURL=errors.js.map