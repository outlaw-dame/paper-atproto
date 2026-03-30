import { atpCall } from '../lib/atproto/client.js';
import { isAtUri, resolveThread } from '../lib/resolver/atproto.js';
import { runVerifiedThreadPipeline, nodeToThreadPost, } from '../intelligence/index.js';
import { THREAD_RETRY_DEFAULTS } from '../intelligence/retry.js';
import { buildThreadStateForWriter } from '../intelligence/writerInput.js';
import { callInterpolatorWriter } from '../intelligence/modelClient.js';
import { translateWriterInput } from '../lib/i18n/threadTranslation.js';
import { buildSessionGraph } from './sessionGraph.js';
import { useConversationSessionStore } from './sessionStore.js';
import { annotateConversationQuality, assignDeferredReasons, defaultAnchorLinearPolicy, deriveThreadStateSignal, } from './sessionPolicies.js';
function sanitizeErrorMessage(err) {
    const raw = err instanceof Error ? err.message : String(err ?? 'Unknown error');
    const sanitized = raw.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();
    if (!sanitized)
        return 'Unexpected error while hydrating conversation session.';
    return sanitized.slice(0, 220);
}
let isInterpolatorWriterUnavailable = false;
function isInterpolatorWriterEndpointError(err) {
    const message = sanitizeErrorMessage(err).toLowerCase();
    return message.includes('/api/llm/write/interpolator') || message.includes('llm endpoint');
}
function setSessionError(sessionId, message) {
    const store = useConversationSessionStore.getState();
    store.updateSession(sessionId, (current) => ({
        ...current,
        meta: {
            ...current.meta,
            status: 'error',
            error: message,
        },
    }));
}
function deriveConversationDirectionFromSession(session) {
    const threadState = session.interpretation.threadState;
    if (!threadState)
        return 'forming';
    if (threadState.conversationPhase === 'escalating')
        return 'escalating';
    if (threadState.conversationPhase === 'stalled')
        return 'stalled';
    if (threadState.dominantTone === 'constructive')
        return 'clarifying';
    if (threadState.dominantTone === 'contested')
        return 'fragmenting';
    return 'forming';
}
function buildTranslationMap(params) {
    const { rootUri, targetLang, output } = params;
    const byUri = {
        [rootUri]: {
            ...(output.rootPost.translatedText ? { translatedText: output.rootPost.translatedText } : {}),
            sourceLang: output.rootPost.sourceLang,
            targetLang,
        },
    };
    for (const comment of output.selectedComments) {
        byUri[comment.id] = {
            ...(comment.translatedText ? { translatedText: comment.translatedText } : {}),
            sourceLang: comment.sourceLang,
            targetLang,
        };
    }
    return byUri;
}
function asThreadPostEnvelope(value) {
    if (typeof value !== 'object' || value == null)
        return {};
    return value;
}
export async function hydrateConversationSession(params) {
    const { sessionId, rootUri, agent, translationPolicy, providers, cache, signal, } = params;
    const store = useConversationSessionStore.getState();
    store.ensureSession(sessionId, rootUri);
    store.updateSession(sessionId, (current) => ({
        ...current,
        meta: {
            ...current.meta,
            status: 'loading',
            error: null,
        },
    }));
    if (!isAtUri(rootUri)) {
        setSessionError(sessionId, 'Invalid AT URI.');
        return;
    }
    try {
        const response = await atpCall(() => agent.getPostThread({ uri: rootUri, depth: 6 }), {
            ...THREAD_RETRY_DEFAULTS,
            ...(signal ? { signal } : {}),
        });
        const envelope = asThreadPostEnvelope(response);
        const threadData = envelope.data?.thread;
        if (!threadData || threadData.$type !== 'app.bsky.feed.defs#threadViewPost') {
            setSessionError(sessionId, 'Thread not found.');
            return;
        }
        const rootNode = resolveThread(threadData);
        const graph = buildSessionGraph(rootNode);
        const pipeline = await runVerifiedThreadPipeline({
            input: {
                rootUri,
                rootText: rootNode.text,
                rootPost: nodeToThreadPost(rootNode),
                replies: rootNode.replies ?? [],
            },
            previous: store.getSession(sessionId)?.interpretation.interpolator ?? null,
            providers,
            cache,
            ...(signal ? { signal } : {}),
        });
        store.updateSession(sessionId, (current) => ({
            ...current,
            graph,
            interpretation: {
                ...current.interpretation,
                interpolator: pipeline.interpolator,
                scoresByUri: pipeline.scores,
                confidence: pipeline.confidence,
                summaryMode: pipeline.summaryMode,
                writerResult: null,
                threadState: null,
                lastComputedAt: new Date().toISOString(),
            },
            evidence: {
                verificationByUri: pipeline.verificationByPost,
                rootVerification: pipeline.rootVerification,
            },
            entities: {
                ...current.entities,
                entityLandscape: pipeline.interpolator.entityLandscape ?? [],
            },
            contributors: {
                contributors: pipeline.interpolator.topContributors ?? [],
                topContributorDids: (pipeline.interpolator.topContributors ?? []).map((c) => c.did),
            },
            trajectory: {
                ...current.trajectory,
                heatLevel: pipeline.interpolator.heatLevel ?? 0,
                repetitionLevel: pipeline.interpolator.repetitionLevel ?? 0,
            },
            meta: {
                status: 'ready',
                error: null,
                lastHydratedAt: new Date().toISOString(),
            },
        }));
        let nextSession = store.getSession(sessionId);
        if (!nextSession)
            return;
        nextSession = annotateConversationQuality(nextSession);
        nextSession = {
            ...nextSession,
            interpretation: {
                ...nextSession.interpretation,
                threadState: deriveThreadStateSignal(nextSession),
            },
        };
        nextSession = assignDeferredReasons(nextSession, defaultAnchorLinearPolicy);
        nextSession = {
            ...nextSession,
            trajectory: {
                ...nextSession.trajectory,
                direction: deriveConversationDirectionFromSession(nextSession),
            },
        };
        store.updateSession(sessionId, () => nextSession);
        try {
            const translationOutput = await translateWriterInput({
                rootPost: {
                    id: rootNode.uri,
                    text: rootNode.text,
                },
                selectedComments: (rootNode.replies ?? []).map((reply) => ({
                    id: reply.uri,
                    text: reply.text,
                })),
                targetLang: translationPolicy.userLanguage,
                mode: translationPolicy.localOnlyMode ? 'local_private' : 'server_default',
            });
            const translationById = buildTranslationMap({
                rootUri,
                targetLang: translationPolicy.userLanguage,
                output: translationOutput,
            });
            store.updateSession(sessionId, (current) => ({
                ...current,
                translations: {
                    byUri: {
                        ...current.translations.byUri,
                        ...translationById,
                    },
                },
            }));
            const writerInput = buildThreadStateForWriter(rootUri, rootNode.text, pipeline.interpolator, pipeline.scores, rootNode.replies ?? [], pipeline.confidence, Object.fromEntries(Object.entries(translationById).map(([uri, value]) => [
                uri,
                {
                    ...(value.translatedText ? { translatedText: value.translatedText } : {}),
                    ...(value.sourceLang ? { sourceLang: value.sourceLang } : {}),
                },
            ])), rootNode.authorHandle ?? undefined);
            if (!isInterpolatorWriterUnavailable) {
                const writerResult = await callInterpolatorWriter(writerInput, signal);
                if (!writerResult.abstained) {
                    store.updateSession(sessionId, (current) => ({
                        ...current,
                        interpretation: {
                            ...current.interpretation,
                            writerResult,
                        },
                    }));
                }
            }
        }
        catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                return;
            }
            if (isInterpolatorWriterEndpointError(err)) {
                isInterpolatorWriterUnavailable = true;
            }
            // Non-fatal: deterministic interpolation remains available.
            console.warn('[conversation] optional translation/writer step failed', sanitizeErrorMessage(err));
        }
    }
    catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
            return;
        }
        setSessionError(sessionId, sanitizeErrorMessage(err));
    }
}
//# sourceMappingURL=sessionAssembler.js.map