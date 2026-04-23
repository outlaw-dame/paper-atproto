import { beforeEach, describe, expect, it } from 'vitest';
import { useRuntimeStore } from './runtimeStore';

function resetRuntimeStore() {
  useRuntimeStore.setState({
    settingsMode: 'balanced',
    capability: null,
    activeModel: null,
    loadState: 'idle',
    lastError: null,
    cooldownUntil: {},
    sessionUnavailableReasons: {},
    lastCapabilityProbeAt: null,
    lastActiveAt: null,
    runtimeSmoke: {
      overallState: 'idle',
      lastRunAt: null,
      db: {
        state: 'idle',
        checkedAt: null,
        message: null,
      },
      browserMl: {
        state: 'idle',
        checkedAt: null,
        message: null,
      },
    },
    allowLiteRt: false,
    preferLiteRt: false,
    userConsentedToLargeModels: false,
  });
}

describe('runtime AI stack preferences', () => {
  beforeEach(() => {
    resetRuntimeStore();
    localStorage.clear();
  });

  it('does not allow preferring LiteRT when LiteRT is disabled', () => {
    useRuntimeStore.getState().setPreferLiteRt(true);

    expect(useRuntimeStore.getState().preferLiteRt).toBe(false);
  });

  it('does not allow large-model consent when LiteRT is disabled', () => {
    useRuntimeStore.getState().setUserConsentedToLargeModels(true);

    expect(useRuntimeStore.getState().userConsentedToLargeModels).toBe(false);
  });

  it('allows preference and consent after LiteRT is enabled', () => {
    const store = useRuntimeStore.getState();

    store.setAllowLiteRt(true);
    useRuntimeStore.getState().setPreferLiteRt(true);
    useRuntimeStore.getState().setUserConsentedToLargeModels(true);

    expect(useRuntimeStore.getState().allowLiteRt).toBe(true);
    expect(useRuntimeStore.getState().preferLiteRt).toBe(true);
    expect(useRuntimeStore.getState().userConsentedToLargeModels).toBe(true);
  });

  it('clears preference and large-model consent when LiteRT is disabled', () => {
    const store = useRuntimeStore.getState();

    store.setAllowLiteRt(true);
    useRuntimeStore.getState().setPreferLiteRt(true);
    useRuntimeStore.getState().setUserConsentedToLargeModels(true);
    useRuntimeStore.getState().setAllowLiteRt(false);

    expect(useRuntimeStore.getState().allowLiteRt).toBe(false);
    expect(useRuntimeStore.getState().preferLiteRt).toBe(false);
    expect(useRuntimeStore.getState().userConsentedToLargeModels).toBe(false);
  });
});
