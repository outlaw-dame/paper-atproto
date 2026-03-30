export declare class CloudKitConfigError extends Error {
    readonly cause?: unknown | undefined;
    readonly code = "cloudkit-config";
    readonly retryable = false;
    readonly layer: "cloudkit";
    constructor(message: string, cause?: unknown | undefined);
}
export declare class CloudKitAuthError extends Error {
    readonly cause?: unknown | undefined;
    readonly code = "cloudkit-auth";
    readonly retryable = false;
    readonly layer: "cloudkit";
    constructor(message: string, cause?: unknown | undefined);
}
export declare class CloudKitTransportError extends Error {
    readonly cause?: unknown | undefined;
    readonly code = "cloudkit-transport";
    readonly retryable = true;
    readonly layer: "cloudkit";
    constructor(message: string, cause?: unknown | undefined);
}
export declare class CloudKitSchemaError extends Error {
    readonly cause?: unknown | undefined;
    readonly code = "cloudkit-schema";
    readonly retryable = false;
    readonly layer: "cloudkit";
    constructor(message: string, cause?: unknown | undefined);
}
export declare class MirrorConflictError extends Error {
    readonly cause?: unknown | undefined;
    readonly code = "mirror-conflict";
    readonly retryable = false;
    readonly layer: "cloudkit";
    constructor(message: string, cause?: unknown | undefined);
}
export declare function isRetryableCloudKitError(err: unknown): boolean;
//# sourceMappingURL=errors.d.ts.map