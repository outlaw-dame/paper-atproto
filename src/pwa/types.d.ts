export type NetworkState = 'online' | 'offline' | 'degraded';
export type CacheProvenance = 'fresh' | 'stale' | 'offline-cache' | 'syncing' | 'failed-refresh';
export type CacheStrategy = 'cache-first' | 'network-first' | 'stale-while-revalidate' | 'network-only' | 'cache-only';
export interface ServiceWorkerRegistrationState {
    supported: boolean;
    registered: boolean;
    updateAvailable: boolean;
    errorCode?: ServiceWorkerErrorCode;
}
export type ServiceWorkerErrorCode = 'unsupported' | 'insecure-context' | 'registration-failed' | 'script-fetch-failed';
export interface PwaCapabilities {
    standalone: boolean;
    serviceWorker: boolean;
    push: boolean;
    notifications: boolean;
    badging: boolean;
    backgroundSync: boolean;
    fileSystemWritable: boolean;
    share: boolean;
    isAppleWebKit: boolean;
}
export interface AppLayerError extends Error {
    code: string;
    layer: 'pwa' | 'push' | 'badge' | 'offline' | 'cloudkit';
    retryable: boolean;
    userSafeMessage?: string;
    cause?: unknown;
}
//# sourceMappingURL=types.d.ts.map