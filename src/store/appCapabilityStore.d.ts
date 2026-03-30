import type { PwaCapabilities, ServiceWorkerRegistrationState } from '../pwa/types.js';
interface AppCapabilityState {
    capabilities: PwaCapabilities | null;
    swState: ServiceWorkerRegistrationState | null;
    setCapabilities: (caps: PwaCapabilities) => void;
    setSwState: (state: ServiceWorkerRegistrationState) => void;
    setUpdateAvailable: () => void;
}
export declare const useAppCapabilityStore: import("zustand").UseBoundStore<import("zustand").StoreApi<AppCapabilityState>>;
export {};
//# sourceMappingURL=appCapabilityStore.d.ts.map