import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { RuntimeCapability } from './capabilityProbe';
import type { ModelChoice, RuntimeMode } from './modelPolicy';

export type RuntimeLoadState = 'idle' | 'probing' | 'ready' | 'loading' | 'error';
export type RuntimeSmokeState = 'idle' | 'running' | 'passed' | 'failed';

export interface RuntimeSmokeTargetSnapshot {
  state: RuntimeSmokeState;
  checkedAt: number | null;
  message: string | null;
  backend?: 'worker' | 'local';
  persistent?: boolean;
  workerStatus?: string;
  crossOriginIsolated?: boolean;
  assetIntegrityOk?: boolean;
}

export interface RuntimeSmokeSnapshot {
  overallState: RuntimeSmokeState;
  lastRunAt: number | null;
  db: RuntimeSmokeTargetSnapshot;
  browserMl: RuntimeSmokeTargetSnapshot;
}

type ModelMap<T> = Partial<Record<ModelChoice, T>>;

function createInitialSmokeTarget(): RuntimeSmokeTargetSnapshot {
  return {
    state: 'idle',
    checkedAt: null,
    message: null,
  };
}

function createInitialSmokeSnapshot(): RuntimeSmokeSnapshot {
  return {
    overallState: 'idle',
    lastRunAt: null,
    db: createInitialSmokeTarget(),
    browserMl: createInitialSmokeTarget(),
  };
}

interface RuntimeStoreState {
  settingsMode: RuntimeMode;
  capability: RuntimeCapability | null;
  activeModel: ModelChoice | null;
  loadState: RuntimeLoadState;
  lastError: string | null;
  cooldownUntil: ModelMap<number>;
  sessionUnavailableReasons: ModelMap<string>;
  lastCapabilityProbeAt: number | null;
  lastActiveAt: number | null;
  runtimeSmoke: RuntimeSmokeSnapshot;
  allowLiteRt: boolean;
  preferLiteRt: boolean;
  userConsentedToLargeModels: boolean;

  setSettingsMode: (mode: RuntimeMode) => void;
  setAllowLiteRt: (allowed: boolean) => void;
  setPreferLiteRt: (preferred: boolean) => void;
  setUserConsentedToLargeModels: (consented: boolean) => void;
  startCapabilityProbe: () => void;
  finishCapabilityProbe: (capability: RuntimeCapability) => void;
  setActiveModel: (model: ModelChoice | null) => void;
  setLoadState: (state: RuntimeLoadState) => void;
  setLastError: (message: string | null) => void;
  recordModelCooldown: (model: ModelChoice, cooldownMs: number, reason: string) => void;
  clearModelCooldown: (model: ModelChoice) => void;
  markModelUnavailableForSession: (model: ModelChoice, reason: string) => void;
  clearSessionUnavailable: (model: ModelChoice) => void;
  touchActivity: () => void;
  isModelCoolingDown: (model: ModelChoice, now?: number) => boolean;
  getModelCooldownExpiry: (model: ModelChoice) => number | null;
  getModelUnavailableReason: (model: ModelChoice) => string | null;
  startRuntimeSmokeCheck: () => void;
  finishRuntimeSmokeCheck: (snapshot: Omit<RuntimeSmokeSnapshot, 'overallState'> & { overallState: Exclude<RuntimeSmokeState, 'idle' | 'running'> }) => void;
}

export const useRuntimeStore = create<RuntimeStoreState>()(
  persist(
    (set, get) => ({
      settingsMode: 'balanced',
      capability: null,
      activeModel: null,
      loadState: 'idle',
      lastError: null,
      cooldownUntil: {},
      sessionUnavailableReasons: {},
      lastCapabilityProbeAt: null,
      lastActiveAt: null,
      runtimeSmoke: createInitialSmokeSnapshot(),
      allowLiteRt: false,
      preferLiteRt: false,
      userConsentedToLargeModels: false,

      setSettingsMode: (mode) => set({ settingsMode: mode }),
      setAllowLiteRt: (allowed) => set((state) => ({
        allowLiteRt: allowed,
        preferLiteRt: allowed ? state.preferLiteRt : false,
        userConsentedToLargeModels: allowed ? state.userConsentedToLargeModels : false,
      })),
      setPreferLiteRt: (preferred) => set((state) => ({
        preferLiteRt: state.allowLiteRt ? preferred : false,
      })),
      setUserConsentedToLargeModels: (consented) => set((state) => ({
        userConsentedToLargeModels: state.allowLiteRt ? consented : false,
      })),
      startCapabilityProbe: () => set({ loadState: 'probing', lastError: null }),
      finishCapabilityProbe: (capability) => set({
        capability,
        loadState: capability.generationAllowed || capability.multimodalAllowed ? 'ready' : 'idle',
        lastCapabilityProbeAt: Date.now(),
        ...(capability.reason ? { lastError: null } : {}),
      }),
      setActiveModel: (model) => set({ activeModel: model }),
      setLoadState: (state) => set({ loadState: state }),
      setLastError: (message) => set({ lastError: message }),
      recordModelCooldown: (model, cooldownMs, reason) => set((state) => ({
        cooldownUntil: {
          ...state.cooldownUntil,
          [model]: Date.now() + Math.max(0, cooldownMs),
        },
        sessionUnavailableReasons: {
          ...state.sessionUnavailableReasons,
          [model]: reason,
        },
        lastError: reason,
        loadState: 'error',
      })),
      clearModelCooldown: (model) => set((state) => {
        const cooldownUntil = { ...state.cooldownUntil };
        delete cooldownUntil[model];
        return { cooldownUntil };
      }),
      markModelUnavailableForSession: (model, reason) => set((state) => ({
        sessionUnavailableReasons: {
          ...state.sessionUnavailableReasons,
          [model]: reason,
        },
        lastError: reason,
      })),
      clearSessionUnavailable: (model) => set((state) => {
        const sessionUnavailableReasons = { ...state.sessionUnavailableReasons };
        delete sessionUnavailableReasons[model];
        return { sessionUnavailableReasons };
      }),
      touchActivity: () => set({ lastActiveAt: Date.now() }),
      isModelCoolingDown: (model, now = Date.now()) => {
        const expiry = get().cooldownUntil[model];
        return typeof expiry === 'number' && expiry > now;
      },
      getModelCooldownExpiry: (model) => get().cooldownUntil[model] ?? null,
      getModelUnavailableReason: (model) => get().sessionUnavailableReasons[model] ?? null,
      startRuntimeSmokeCheck: () => set({
        runtimeSmoke: {
          overallState: 'running',
          lastRunAt: null,
          db: {
            ...createInitialSmokeTarget(),
            state: 'running',
          },
          browserMl: {
            ...createInitialSmokeTarget(),
            state: 'running',
          },
        },
      }),
      finishRuntimeSmokeCheck: (snapshot) => set({
        runtimeSmoke: snapshot,
      }),
    }),
    {
      name: 'glympse.runtime.settings.v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        settingsMode: state.settingsMode,
        allowLiteRt: state.allowLiteRt,
        preferLiteRt: state.preferLiteRt,
        userConsentedToLargeModels: state.userConsentedToLargeModels,
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.warn('[RuntimeStore] Rehydration error:', error);
        }
      },
    },
  ),
);
