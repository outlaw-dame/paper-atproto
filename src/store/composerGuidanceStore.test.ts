import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyComposerGuidanceResult } from '../intelligence/composer/guidanceScoring';
import { useComposerGuidanceStore } from './composerGuidanceStore';

describe('composerGuidanceStore', () => {
  beforeEach(() => {
    useComposerGuidanceStore.setState({
      byDraftId: {},
      contextFingerprintByDraftId: {},
      dismissedByDraftId: {},
    });
  });

  it('tracks guidance context fingerprints and clears them with the draft entry', () => {
    const result = createEmptyComposerGuidanceResult('reply');
    const store = useComposerGuidanceStore.getState();

    store.setGuidance('draft-1', result, 'fingerprint-1');
    store.dismissGuidance('draft-1');

    expect(useComposerGuidanceStore.getState().contextFingerprintByDraftId['draft-1']).toBe('fingerprint-1');

    useComposerGuidanceStore.getState().clearGuidance('draft-1');

    expect(useComposerGuidanceStore.getState().byDraftId['draft-1']).toBeUndefined();
    expect(useComposerGuidanceStore.getState().contextFingerprintByDraftId['draft-1']).toBeUndefined();
    expect(useComposerGuidanceStore.getState().dismissedByDraftId['draft-1']).toBeUndefined();
  });
});
