import type { ServiceWorkerRegistrationState } from './types.js';
export declare function onServiceWorkerUpdate(fn: () => void): () => void;
export declare function registerAppServiceWorker(): Promise<ServiceWorkerRegistrationState>;
/** Tell the waiting service worker to take over immediately. */
export declare function activatePendingUpdate(): void;
export declare function getServiceWorkerRegistration(): ServiceWorkerRegistration | null;
//# sourceMappingURL=registerServiceWorker.d.ts.map