// ─── CloudKit Error Types ─────────────────────────────────────────────────────
// All CloudKit errors stay inside the Apple layer unless explicitly mapped
// to a safe UI-facing message.
export class CloudKitConfigError extends Error {
    cause;
    code = 'cloudkit-config';
    retryable = false;
    layer = 'cloudkit';
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = 'CloudKitConfigError';
    }
}
export class CloudKitAuthError extends Error {
    cause;
    code = 'cloudkit-auth';
    retryable = false;
    layer = 'cloudkit';
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = 'CloudKitAuthError';
    }
}
export class CloudKitTransportError extends Error {
    cause;
    code = 'cloudkit-transport';
    retryable = true;
    layer = 'cloudkit';
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = 'CloudKitTransportError';
    }
}
export class CloudKitSchemaError extends Error {
    cause;
    code = 'cloudkit-schema';
    retryable = false;
    layer = 'cloudkit';
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = 'CloudKitSchemaError';
    }
}
export class MirrorConflictError extends Error {
    cause;
    code = 'mirror-conflict';
    retryable = false;
    layer = 'cloudkit';
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = 'MirrorConflictError';
    }
}
export function isRetryableCloudKitError(err) {
    return err instanceof CloudKitTransportError;
}
//# sourceMappingURL=errors.js.map