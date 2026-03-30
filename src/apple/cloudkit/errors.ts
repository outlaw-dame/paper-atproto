// ─── CloudKit Error Types ─────────────────────────────────────────────────────
// All CloudKit errors stay inside the Apple layer unless explicitly mapped
// to a safe UI-facing message.

export class CloudKitConfigError extends Error {
  readonly code = 'cloudkit-config';
  readonly retryable = false;
  readonly layer = 'cloudkit' as const;
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'CloudKitConfigError';
  }
}

export class CloudKitAuthError extends Error {
  readonly code = 'cloudkit-auth';
  readonly retryable = false;
  readonly layer = 'cloudkit' as const;
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'CloudKitAuthError';
  }
}

export class CloudKitTransportError extends Error {
  readonly code = 'cloudkit-transport';
  readonly retryable = true;
  readonly layer = 'cloudkit' as const;
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'CloudKitTransportError';
  }
}

export class CloudKitSchemaError extends Error {
  readonly code = 'cloudkit-schema';
  readonly retryable = false;
  readonly layer = 'cloudkit' as const;
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'CloudKitSchemaError';
  }
}

export class MirrorConflictError extends Error {
  readonly code = 'mirror-conflict';
  readonly retryable = false;
  readonly layer = 'cloudkit' as const;
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'MirrorConflictError';
  }
}

export function isRetryableCloudKitError(err: unknown): boolean {
  return err instanceof CloudKitTransportError;
}
