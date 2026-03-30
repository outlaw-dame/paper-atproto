export declare class VerificationError extends Error {
    readonly code: string;
    readonly retryable: boolean;
    constructor(message: string, options?: {
        code?: string;
        retryable?: boolean;
        cause?: unknown;
    });
}
export declare class VerificationTimeoutError extends VerificationError {
    constructor(message?: string, cause?: unknown);
}
export declare class VerificationRateLimitError extends VerificationError {
    constructor(message?: string, cause?: unknown);
}
export declare class VerificationBadResponseError extends VerificationError {
    constructor(message?: string, cause?: unknown);
}
export declare class VerificationConfigError extends VerificationError {
    constructor(message?: string, cause?: unknown);
}
//# sourceMappingURL=errors.d.ts.map