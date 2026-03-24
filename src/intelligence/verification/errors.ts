export class VerificationError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, options?: { code?: string; retryable?: boolean; cause?: unknown }) {
    super(message);
    this.name = 'VerificationError';
    this.code = options?.code ?? 'VERIFICATION_ERROR';
    this.retryable = options?.retryable ?? false;
    if (options?.cause !== undefined) {
      (this as any).cause = options.cause;
    }
  }
}

export class VerificationTimeoutError extends VerificationError {
  constructor(message = 'Verification provider timed out', cause?: unknown) {
    super(message, { code: 'VERIFICATION_TIMEOUT', retryable: true, cause });
    this.name = 'VerificationTimeoutError';
  }
}

export class VerificationRateLimitError extends VerificationError {
  constructor(message = 'Verification provider rate limited', cause?: unknown) {
    super(message, { code: 'VERIFICATION_RATE_LIMIT', retryable: true, cause });
    this.name = 'VerificationRateLimitError';
  }
}

export class VerificationBadResponseError extends VerificationError {
  constructor(message = 'Verification provider returned an invalid response', cause?: unknown) {
    super(message, { code: 'VERIFICATION_BAD_RESPONSE', retryable: false, cause });
    this.name = 'VerificationBadResponseError';
  }
}

export class VerificationConfigError extends VerificationError {
  constructor(message = 'Verification provider is misconfigured', cause?: unknown) {
    super(message, { code: 'VERIFICATION_CONFIG', retryable: false, cause });
    this.name = 'VerificationConfigError';
  }
}
