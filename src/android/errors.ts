// ─── Android Enhancement Error Types ─────────────────────────────────────────
// All Android enhancement errors stay inside the android/ layer unless
// explicitly mapped to a safe UI-facing message.
// Core app behavior must never depend on catching these.

export class AndroidFeatureUnavailableError extends Error {
  readonly code = 'android-feature-unavailable' as const;
  readonly retryable = false;
  readonly layer = 'android' as const;

  constructor(
    public readonly feature: string,
    public readonly cause?: unknown,
  ) {
    super(`Android feature unavailable: ${feature}`);
    this.name = 'AndroidFeatureUnavailableError';
  }
}

export class AndroidShareError extends Error {
  readonly code = 'android-share' as const;
  readonly retryable = false;
  readonly layer = 'android' as const;

  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'AndroidShareError';
  }
}

export class AndroidShareAbortError extends Error {
  /** User dismissed the share sheet — not an error, just a cancellation. */
  readonly code = 'android-share-abort' as const;
  readonly retryable = false;
  readonly layer = 'android' as const;

  constructor(public readonly cause?: unknown) {
    super('Share cancelled by user');
    this.name = 'AndroidShareAbortError';
  }
}

// ─── Type guards ──────────────────────────────────────────────────────────────

export function isAndroidShareAbort(err: unknown): err is AndroidShareAbortError {
  return err instanceof AndroidShareAbortError;
}

export function isAndroidFeatureUnavailable(
  err: unknown,
): err is AndroidFeatureUnavailableError {
  return err instanceof AndroidFeatureUnavailableError;
}
