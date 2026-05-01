import { useDeferredValue, useEffect, useMemo, useRef } from 'react';
import {
  analyzeComposerGuidance,
  analyzeComposerGuidanceImmediate,
  analyzeComposerGuidanceWithEdgeClassifier,
} from '../intelligence/composer/guidancePipeline';
import { createEmptyComposerGuidanceResult } from '../intelligence/composer/guidanceScoring';
import { maybeWriteComposerGuidance } from '../intelligence/composer/guidanceWriter';
import {
  getComposerModelDebounceMs,
  getComposerWriterDebounceMs,
  hasComposerModelCoverage,
  hasComposerWriterCoverage,
  shouldReuseCachedComposerGuidance,
  shouldRunComposerEdgeClassifierStageForDraft,
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

    const cachedOrEmptyGuidance = reusableCachedGuidance ?? createEmptyComposerGuidanceResult(deferredContext.mode);
    const hasCachedModelCoverage = hasComposerModelCoverage(cachedOrEmptyGuidance);
    let latestGuidance: ComposerGuidanceResult = hasCachedModelCoverage
      ? (reusableCachedGuidance ?? immediateGuidance)
      : immediateGuidance;

    if (!hasCachedModelCoverage) {
      setGuidance(draftId, immediateGuidance, contextFingerprint);
    }

    const shouldRunModelStage = shouldRunComposerModelStageForDraft(
      deferredContext.mode,
      deferredContext.draftText,
      immediateGuidance,
    );
    const shouldRunEdgeClassifierStage = shouldRunComposerEdgeClassifierStageForDraft(
      deferredContext.mode,
      deferredContext.draftText,
      immediateGuidance,
    );
    const shouldRunWriterFromImmediateGuidance = shouldRunComposerWriterStage(
      deferredContext.mode,
      deferredContext.draftText,
      latestGuidance,
      dismissedAt,
    );

    if (!shouldRunModelStage && !shouldRunEdgeClassifierStage && !shouldRunWriterFromImmediateGuidance) {
      return;
    }

    const refinementDebounceMs = getComposerModelDebounceMs(deferredContext.mode, debounceMs);
    const writerDebounceMs = getComposerWriterDebounceMs(deferredContext.mode);
    const classifierAbort = new AbortController();
    const writerAbort = new AbortController();
    let refinementTimer: number | null = null;

    const runRefinementStage = async () => {
      if (hasComposerModelCoverage(latestGuidance)) {
        return latestGuidance;
      }

      if (hasCachedModelCoverage) {
        latestGuidance = reusableCachedGuidance ?? latestGuidance;
        return latestGuidance;
      }

      if (shouldRunModelStage) {
        const result = await analyzeComposerGuidance(deferredContext);
        if (requestIdRef.current !== requestId) return latestGuidance;
        latestGuidance = result;
        setGuidance(draftId, result, contextFingerprint);
        return result;
      }

      if (shouldRunEdgeClassifierStage) {
        const result = await analyzeComposerGuidanceWithEdgeClassifier(
          deferredContext,
          latestGuidance,
          classifierAbort.signal,
        );
        if (requestIdRef.current !== requestId) return latestGuidance;
        latestGuidance = result;
        setGuidance(draftId, result, contextFingerprint);
        return result;
      }

      return latestGuidance;
    };

    if (shouldRunModelStage || shouldRunEdgeClassifierStage) {
      refinementTimer = window.setTimeout(() => {
        void runRefinementStage().catch(() => {
          // Keep the immediate local guidance result if async refinement fails.
        });
      }, refinementDebounceMs);
    }

    const writerTimer = window.setTimeout(() => {
      void (async () => {
        const baseGuidance = hasComposerModelCoverage(latestGuidance)
          ? latestGuidance
          : await runRefinementStage();

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
    }, shouldRunModelStage || shouldRunEdgeClassifierStage
      ? Math.max(writerDebounceMs, refinementDebounceMs + 700)
      : writerDebounceMs);

    return () => {
      if (refinementTimer !== null) {
        window.clearTimeout(refinementTimer);
      }
      classifierAbort.abort();
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
