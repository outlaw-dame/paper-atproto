import { useDeferredValue, useEffect, useMemo, useRef } from 'react';
import {
  analyzeComposerGuidance,
  analyzeComposerGuidanceImmediate,
} from '../intelligence/composer/guidancePipeline';
import { createEmptyComposerGuidanceResult } from '../intelligence/composer/guidanceScoring';
import { maybeWriteComposerGuidance } from '../intelligence/composer/guidanceWriter';
import {
  getComposerModelDebounceMs,
  getComposerWriterDebounceMs,
  hasComposerModelCoverage,
  hasComposerWriterCoverage,
  shouldReuseCachedComposerGuidance,
  shouldRunComposerModelStageForDraft,
  shouldRunComposerWriterStage,
} from '../intelligence/composer/routing';
import {
  createComposerContextFingerprint,
  createComposerDraftId,
} from '../intelligence/composer/guidanceIdentity';
import type { ComposerContext, ComposerGuidanceResult } from '../intelligence/composer/types';
import { useComposerGuidanceStore } from '../store/composerGuidanceStore';

interface UseComposerGuidanceOptions {
  surfaceId: string;
  context: ComposerContext;
  debounceMs?: number;
}

export function useComposerGuidance({
  surfaceId,
  context,
  debounceMs,
}: UseComposerGuidanceOptions) {
  const setGuidance = useComposerGuidanceStore((state) => state.setGuidance);
  const dismissGuidance = useComposerGuidanceStore((state) => state.dismissGuidance);
  const clearGuidance = useComposerGuidanceStore((state) => state.clearGuidance);
  const requestIdRef = useRef(0);
  const deferredContext = useDeferredValue(context);
  const draftId = useMemo(
    () => createComposerDraftId(surfaceId, deferredContext),
    [deferredContext, surfaceId],
  );
  const contextFingerprint = useMemo(
    () => createComposerContextFingerprint(deferredContext),
    [deferredContext],
  );

  const cachedGuidance = useComposerGuidanceStore((state) => state.byDraftId[draftId]);
  const cachedContextFingerprint = useComposerGuidanceStore(
    (state) => state.contextFingerprintByDraftId[draftId] ?? null,
  );
  const isCachedContextFresh = cachedContextFingerprint === contextFingerprint;
  const immediateGuidance = useMemo(
    () => analyzeComposerGuidanceImmediate(deferredContext),
    [contextFingerprint, deferredContext],
  );
  const guidance = isCachedContextFresh && cachedGuidance
    ? cachedGuidance
    : immediateGuidance;
  const dismissedAt = useComposerGuidanceStore((state) => state.dismissedByDraftId[draftId] ?? null);

  useEffect(() => {
    const reusableCachedGuidance = isCachedContextFresh ? cachedGuidance : undefined;

    if (shouldReuseCachedComposerGuidance(deferredContext.mode, deferredContext.draftText, reusableCachedGuidance, dismissedAt)) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    let latestGuidance: ComposerGuidanceResult = hasComposerModelCoverage(
      reusableCachedGuidance ?? createEmptyComposerGuidanceResult(deferredContext.mode),
    )
      ? (reusableCachedGuidance ?? immediateGuidance)
      : immediateGuidance;

    if (!hasComposerModelCoverage(reusableCachedGuidance ?? createEmptyComposerGuidanceResult(deferredContext.mode))) {
      setGuidance(draftId, immediateGuidance, contextFingerprint);
    }

    const shouldRunModelStage = shouldRunComposerModelStageForDraft(
      deferredContext.mode,
      deferredContext.draftText,
      immediateGuidance,
    );

    if (!shouldRunModelStage) {
      return;
    }

    const modelDebounceMs = getComposerModelDebounceMs(deferredContext.mode, debounceMs);
    const writerDebounceMs = getComposerWriterDebounceMs(deferredContext.mode);
    const writerAbort = new AbortController();

    const runModelStage = async () => {
      if (hasComposerModelCoverage(reusableCachedGuidance ?? createEmptyComposerGuidanceResult(deferredContext.mode))) {
        latestGuidance = reusableCachedGuidance ?? latestGuidance;
        return latestGuidance;
      }

      const result = await analyzeComposerGuidance(deferredContext);
      if (requestIdRef.current !== requestId) return latestGuidance;
      latestGuidance = result;
      setGuidance(draftId, result, contextFingerprint);
      return result;
    };

    const modelTimer = window.setTimeout(() => {
      void runModelStage().catch(() => {
        // Keep the immediate local guidance result if the async refinement fails.
      });
    }, modelDebounceMs);

    const writerTimer = window.setTimeout(() => {
      void (async () => {
        const baseGuidance = hasComposerModelCoverage(latestGuidance)
          ? latestGuidance
          : await runModelStage();

        if (requestIdRef.current !== requestId) return;
        if (hasComposerWriterCoverage(baseGuidance)) return;
        if (!shouldRunComposerWriterStage(deferredContext.mode, deferredContext.draftText, baseGuidance, dismissedAt)) return;

        const written = await maybeWriteComposerGuidance(deferredContext, baseGuidance, writerAbort.signal);
        if (requestIdRef.current !== requestId) return;
        latestGuidance = written;
        setGuidance(draftId, written, contextFingerprint);
      })().catch(() => {
        // Writer guidance is optional; keep the local copy if the server-side pass fails.
      });
    }, Math.max(writerDebounceMs, modelDebounceMs + 700));

    return () => {
      window.clearTimeout(modelTimer);
      window.clearTimeout(writerTimer);
      writerAbort.abort();
    };
  }, [
    deferredContext,
    debounceMs,
    dismissedAt,
    draftId,
    contextFingerprint,
    cachedGuidance,
    isCachedContextFresh,
    immediateGuidance,
    setGuidance,
  ]);

  return {
    draftId,
    guidance,
    dismissedAt,
    isDismissed: dismissedAt !== null,
    dismissGuidance: () => dismissGuidance(draftId),
    clearGuidance: () => clearGuidance(draftId),
  };
}
