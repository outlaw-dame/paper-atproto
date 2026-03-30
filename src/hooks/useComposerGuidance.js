import { useDeferredValue, useEffect, useMemo, useRef } from 'react';
import { analyzeComposerGuidance, analyzeComposerGuidanceImmediate, } from '../intelligence/composer/guidancePipeline.js';
import { createEmptyComposerGuidanceResult } from '../intelligence/composer/guidanceScoring.js';
import { maybeWriteComposerGuidance } from '../intelligence/composer/guidanceWriter.js';
import { getComposerModelDebounceMs, getComposerWriterDebounceMs, hasComposerModelCoverage, hasComposerWriterCoverage, shouldReuseCachedComposerGuidance, shouldRunComposerModelStageForDraft, shouldRunComposerWriterStage, } from '../intelligence/composer/routing.js';
import { useComposerGuidanceStore } from '../store/composerGuidanceStore.js';
function hashDraftKey(value) {
    let hash = 5381;
    for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
    }
    return (hash >>> 0).toString(36);
}
export function useComposerGuidance({ surfaceId, context, debounceMs, }) {
    const setGuidance = useComposerGuidanceStore((state) => state.setGuidance);
    const dismissGuidance = useComposerGuidanceStore((state) => state.dismissGuidance);
    const clearGuidance = useComposerGuidanceStore((state) => state.clearGuidance);
    const requestIdRef = useRef(0);
    const deferredContext = useDeferredValue(context);
    const contextKey = JSON.stringify(deferredContext);
    const draftId = useMemo(() => `${surfaceId}:${hashDraftKey(contextKey)}`, [contextKey, surfaceId]);
    const cachedGuidance = useComposerGuidanceStore((state) => state.byDraftId[draftId]);
    const guidance = cachedGuidance ?? createEmptyComposerGuidanceResult(deferredContext.mode);
    const dismissedAt = useComposerGuidanceStore((state) => state.dismissedByDraftId[draftId] ?? null);
    useEffect(() => {
        if (shouldReuseCachedComposerGuidance(deferredContext.mode, deferredContext.draftText, cachedGuidance, dismissedAt)) {
            return;
        }
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        const immediate = analyzeComposerGuidanceImmediate(deferredContext);
        let latestGuidance = hasComposerModelCoverage(cachedGuidance ?? createEmptyComposerGuidanceResult(deferredContext.mode))
            ? (cachedGuidance ?? immediate)
            : immediate;
        if (!hasComposerModelCoverage(cachedGuidance ?? createEmptyComposerGuidanceResult(deferredContext.mode))) {
            setGuidance(draftId, immediate);
        }
        const shouldRunModelStage = shouldRunComposerModelStageForDraft(deferredContext.mode, deferredContext.draftText, immediate);
        if (!shouldRunModelStage) {
            return;
        }
        const modelDebounceMs = getComposerModelDebounceMs(deferredContext.mode, debounceMs);
        const writerDebounceMs = getComposerWriterDebounceMs(deferredContext.mode);
        const writerAbort = new AbortController();
        const runModelStage = async () => {
            if (hasComposerModelCoverage(cachedGuidance ?? createEmptyComposerGuidanceResult(deferredContext.mode))) {
                latestGuidance = cachedGuidance ?? latestGuidance;
                return latestGuidance;
            }
            const result = await analyzeComposerGuidance(deferredContext);
            if (requestIdRef.current !== requestId)
                return latestGuidance;
            latestGuidance = result;
            setGuidance(draftId, result);
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
                if (requestIdRef.current !== requestId)
                    return;
                if (hasComposerWriterCoverage(baseGuidance))
                    return;
                if (!shouldRunComposerWriterStage(deferredContext.mode, deferredContext.draftText, baseGuidance, dismissedAt))
                    return;
                const written = await maybeWriteComposerGuidance(deferredContext, baseGuidance, writerAbort.signal);
                if (requestIdRef.current !== requestId)
                    return;
                latestGuidance = written;
                setGuidance(draftId, written);
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
//# sourceMappingURL=useComposerGuidance.js.map