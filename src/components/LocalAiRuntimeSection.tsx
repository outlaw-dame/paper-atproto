import React from 'react';
import { browserModelManager } from '../runtime/modelManager';
import type { RuntimeMode } from '../runtime/modelPolicy';
import { useRuntimeStore } from '../runtime/runtimeStore';
import { useSessionStore } from '../store/sessionStore';
import {
  getInterpolatorMetricsSnapshot,
  subscribeInterpolatorMetrics,
  type InterpolatorMetricsSnapshot,
} from '../perf/interpolatorTelemetry';
import {
  getConversationSupervisorTelemetrySnapshot,
  subscribeConversationSupervisorTelemetry,
  type ConversationSupervisorTelemetrySnapshot,
} from '../perf/conversationSupervisorTelemetry';
import {
  appendConversationOsHealthHistory,
  clearConversationOsHealthHistory,
  readConversationOsHealthHistory,
  type ConversationOsHealthHistoryEntry,
} from '../perf/conversationOsHealthHistory';
import {
  appendWriterEnhancerProviderHistory,
  clearWriterEnhancerProviderHistory,
  readWriterEnhancerProviderHistory,
  type WriterEnhancerProviderHistoryEntry,
} from '../perf/writerEnhancerProviderHistory';
import type {
  ConversationOsHumanReviewPack,
  ConversationOsHumanReviewScore,
  HumanReviewRating,
} from '../evals/conversationOsHumanReview';
import {
  deriveConversationOsHealth,
  deriveConversationSupervisorSummary,
  deriveConversationOsTrendSummary,
  deriveConversationDeltaAlerts,
  derivePremiumDiagnosticsAlerts,
  derivePremiumProviderAvailabilityAlerts,
  deriveConversationWatchAlerts,
  deriveWriterProviderTrendSummaries,
  deriveWriterDiagnosticsAlerts,
  formatLatency,
  formatRelativeAge,
  formatRate,
  humanizeIssueLabel,
  topWriterEnhancerIssues,
  type ConversationOsTrendSummary,
  type ConversationSupervisorSummary,
  type PremiumDiagnosticsSnapshot,
  type PremiumProviderAvailabilitySnapshot,
  type WriterProviderTrendSummary,
  type WriterDiagnosticsSnapshot,
  WRITER_DIAGNOSTICS_WATCH_INTERVAL_MS,
} from './localAiRuntimeDiagnostics';

type AiSessionTelemetrySnapshot = {
  routeErrors: number;
  productionRedactedErrors: number;
  dedupEvictions: number;
  metadataSanitizationMutations: number;
  durableHydration: {
    attempts: number;
    successes: number;
    misses: number;
    failures: number;
    totalDurationMs: number;
    maxDurationMs: number;
    lastDurationMs: number;
    replayedItems: {
      events: number;
      state: number;
      presence: number;
    };
    replayedPages: {
      events: number;
      state: number;
      presence: number;
    };
  };
  durableHydrationDerived: {
    successRate: number;
    missRate: number;
    failureRate: number;
    averageSuccessDurationMs: number;
    replayedItemsPerSuccess: {
      events: number;
      state: number;
      presence: number;
    };
    replayedPagesPerSuccess: {
      events: number;
      state: number;
      presence: number;
    };
    replayedItemsPerPage: {
      events: number;
      state: number;
      presence: number;
    };
  };
  durableStrictReadFailures: {
    events: number;
    state: number;
    presence: number;
  };
  durableStrictWriteFailures: {
    events: number;
    state: number;
    presence: number;
  };
};

function jitteredBackoffMs(attempt: number, baseMs = 250, maxMs = 1500): number {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  const jitter = exp * 0.25;
  return Math.max(120, Math.floor(exp - jitter + Math.random() * jitter * 2));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchWithRetry(input: RequestInfo, init: RequestInit, attempts = 2): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (response.ok) return response;
      if (response.status < 500 && response.status !== 429) return response;
      lastError = new Error(`Request failed (${response.status})`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts - 1) {
      await sleep(jitteredBackoffMs(attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed');
}


const MODES: Array<{
  value: RuntimeMode;
  label: string;
  description: string;
}> = [
  {
    value: 'fast',
    label: 'Fast',
    description: 'Classifier stack only by default. Heavy local generation stays off unless you explicitly use a remote-backed feature.',
  },
  {
    value: 'balanced',
    label: 'Balanced',
    description: 'Keep the current hot path, and allow lighter local text generation on supported devices.',
  },
  {
    value: 'best_quality',
    label: 'Best quality',
    description: 'Prefer the strongest local text path your device can safely support, while keeping multimodal on-demand.',
  },
];

export default function LocalAiRuntimeSection() {
  const supportsClientTelemetry = import.meta.env.DEV;
  const settingsMode = useRuntimeStore((state) => state.settingsMode);
  const setSettingsMode = useRuntimeStore((state) => state.setSettingsMode);
  const capability = useRuntimeStore((state) => state.capability);
  const activeModel = useRuntimeStore((state) => state.activeModel);
  const loadState = useRuntimeStore((state) => state.loadState);
  const lastError = useRuntimeStore((state) => state.lastError);
  const lastCapabilityProbeAt = useRuntimeStore((state) => state.lastCapabilityProbeAt);
  const runtimeSmoke = useRuntimeStore((state) => state.runtimeSmoke);
  const sessionDid = useSessionStore((state) => state.session?.did ?? null);

  const [refreshing, setRefreshing] = React.useState(false);
  const [smokeRefreshing, setSmokeRefreshing] = React.useState(false);
  const [telemetry, setTelemetry] = React.useState<AiSessionTelemetrySnapshot | null>(null);
  const [telemetryLoading, setTelemetryLoading] = React.useState(false);
  const [telemetryResetting, setTelemetryResetting] = React.useState(false);
  const [telemetryError, setTelemetryError] = React.useState<string | null>(null);
  const [telemetryUpdatedAt, setTelemetryUpdatedAt] = React.useState<number | null>(null);
  const [writerDiagnostics, setWriterDiagnostics] = React.useState<WriterDiagnosticsSnapshot | null>(null);
  const [writerDiagnosticsLoading, setWriterDiagnosticsLoading] = React.useState(false);
  const [writerDiagnosticsResetting, setWriterDiagnosticsResetting] = React.useState(false);
  const [writerDiagnosticsError, setWriterDiagnosticsError] = React.useState<string | null>(null);
  const [writerDiagnosticsUpdatedAt, setWriterDiagnosticsUpdatedAt] = React.useState<number | null>(null);
  const [writerDiagnosticsWatchEnabled, setWriterDiagnosticsWatchEnabled] = React.useState<boolean>(() => import.meta.env.DEV);
  const [premiumDiagnostics, setPremiumDiagnostics] = React.useState<PremiumDiagnosticsSnapshot | null>(null);
  const [premiumProviderAvailability, setPremiumProviderAvailability] = React.useState<PremiumProviderAvailabilitySnapshot | null>(null);
  const [interpolatorMetrics, setInterpolatorMetrics] = React.useState<InterpolatorMetricsSnapshot | null>(
    () => (supportsClientTelemetry ? getInterpolatorMetricsSnapshot() : null),
  );
  const [conversationSupervisorTelemetry, setConversationSupervisorTelemetry] = React.useState<ConversationSupervisorTelemetrySnapshot | null>(
    () => (supportsClientTelemetry ? getConversationSupervisorTelemetrySnapshot() : null),
  );
  const [interpolatorMetricsUpdatedAt, setInterpolatorMetricsUpdatedAt] = React.useState<number | null>(
    () => (supportsClientTelemetry ? Date.now() : null),
  );
  const [conversationOsHistory, setConversationOsHistory] = React.useState<ConversationOsHealthHistoryEntry[]>(
    () => (supportsClientTelemetry ? readConversationOsHealthHistory() : []),
  );
  const [writerProviderHistory, setWriterProviderHistory] = React.useState<WriterEnhancerProviderHistoryEntry[]>(
    () => (supportsClientTelemetry ? readWriterEnhancerProviderHistory() : []),
  );
  const [reviewPack, setReviewPack] = React.useState<ConversationOsHumanReviewPack | null>(null);
  const [reviewScore, setReviewScore] = React.useState<ConversationOsHumanReviewScore | null>(null);
  const [reviewPackLoading, setReviewPackLoading] = React.useState(false);
  const [reviewPackError, setReviewPackError] = React.useState<string | null>(null);
  const [reviewPackCopyState, setReviewPackCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle');
  const resolvedModelSpecs = React.useMemo(() => browserModelManager.getResolvedModelSpecs(), []);

  const hasReadyLocalMultimodal = React.useMemo(() => (
    Object.values(resolvedModelSpecs).some((spec) => (
      spec.sessionKind === 'multimodal' && spec.currentRuntimeSupport === 'ready'
    ))
  ), [resolvedModelSpecs]);

  const refreshCapability = React.useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await browserModelManager.initCapabilityProbe(true);
    } catch (error) {
      console.warn('[RuntimeSettings] Capability reprobe failed', error);
    } finally {
      setRefreshing(false);
    }
  }, [refreshing]);

  const refreshSessionTelemetry = React.useCallback(async () => {
    if (!supportsClientTelemetry) {
      setTelemetry(null);
      setTelemetryUpdatedAt(null);
      setTelemetryError(null);
      return;
    }
    if (!sessionDid) {
      setTelemetryError('Sign in to inspect AI session telemetry.');
      setTelemetry(null);
      return;
    }
    if (telemetryLoading) return;

    setTelemetryLoading(true);
    setTelemetryError(null);

    try {
      const response = await fetch('/api/ai/sessions/telemetry', {
        method: 'GET',
        headers: {
          'X-Glympse-User-Did': sessionDid,
        },
      });
      if (!response.ok) {
        throw new Error(`Telemetry fetch failed (${response.status}).`);
      }

      const body = await response.json() as { telemetry?: AiSessionTelemetrySnapshot };
      if (!body.telemetry) {
        throw new Error('Telemetry response was empty.');
      }

      setTelemetry(body.telemetry);
      setTelemetryUpdatedAt(Date.now());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load AI session telemetry.';
      setTelemetryError(message);
    } finally {
      setTelemetryLoading(false);
    }
  }, [sessionDid, supportsClientTelemetry, telemetryLoading]);

  const refreshRuntimeSmoke = React.useCallback(async () => {
    if (smokeRefreshing) return;
    setSmokeRefreshing(true);
    try {
      await browserModelManager.runRuntimeSmokeCheck();
    } catch (error) {
      console.warn('[RuntimeSettings] Runtime smoke check failed', error);
    } finally {
      setSmokeRefreshing(false);
    }
  }, [smokeRefreshing]);

  const resetSessionTelemetry = React.useCallback(async () => {
    if (!supportsClientTelemetry) {
      setTelemetry(null);
      setTelemetryUpdatedAt(null);
      setTelemetryError(null);
      return;
    }
    if (!sessionDid || telemetryResetting) return;

    setTelemetryResetting(true);
    setTelemetryError(null);
    try {
      const response = await fetch('/api/ai/sessions/telemetry', {
        method: 'DELETE',
        headers: {
          'X-Glympse-User-Did': sessionDid,
        },
      });

      if (!response.ok && response.status !== 204) {
        throw new Error(`Telemetry reset failed (${response.status}).`);
      }

      await refreshSessionTelemetry();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reset AI session telemetry.';
      setTelemetryError(message);
    } finally {
      setTelemetryResetting(false);
    }
  }, [refreshSessionTelemetry, sessionDid, supportsClientTelemetry, telemetryResetting]);

  const refreshWriterDiagnostics = React.useCallback(async () => {
    if (!supportsClientTelemetry) {
      setWriterDiagnostics(null);
      setPremiumDiagnostics(null);
      setPremiumProviderAvailability(null);
      setWriterDiagnosticsUpdatedAt(null);
      setWriterDiagnosticsError(null);
      return;
    }
    if (writerDiagnosticsLoading) return;

    setWriterDiagnosticsLoading(true);
    setWriterDiagnosticsError(null);

    try {
      const response = await fetchWithRetry('/api/llm/admin/diagnostics', { method: 'GET' }, 2);
      if (!response.ok) {
        throw new Error(`Writer diagnostics fetch failed (${response.status}).`);
      }

      const body = await response.json() as {
        writer?: WriterDiagnosticsSnapshot;
        premium?: PremiumDiagnosticsSnapshot;
        premiumProviders?: PremiumProviderAvailabilitySnapshot;
      };
      if (!body.writer) {
        throw new Error('Writer diagnostics response was empty.');
      }

      setWriterDiagnostics(body.writer);
      setPremiumDiagnostics(body.premium ?? null);
      setPremiumProviderAvailability(body.premiumProviders ?? null);
      setWriterDiagnosticsUpdatedAt(Date.now());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load writer diagnostics.';
      setWriterDiagnosticsError(message);
    } finally {
      setWriterDiagnosticsLoading(false);
    }
  }, [supportsClientTelemetry, writerDiagnosticsLoading]);

  const resetWriterDiagnostics = React.useCallback(async () => {
    if (!supportsClientTelemetry) {
      setWriterDiagnostics(null);
      setPremiumDiagnostics(null);
      setPremiumProviderAvailability(null);
      setWriterDiagnosticsUpdatedAt(null);
      setWriterDiagnosticsError(null);
      return;
    }
    if (writerDiagnosticsResetting) return;

    setWriterDiagnosticsResetting(true);
    setWriterDiagnosticsError(null);

    try {
      const response = await fetchWithRetry('/api/llm/admin/diagnostics', { method: 'DELETE' }, 2);
      if (!response.ok && response.status !== 204) {
        throw new Error(`Writer diagnostics reset failed (${response.status}).`);
      }

      await refreshWriterDiagnostics();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reset writer diagnostics.';
      setWriterDiagnosticsError(message);
    } finally {
      setWriterDiagnosticsResetting(false);
    }
  }, [refreshWriterDiagnostics, supportsClientTelemetry, writerDiagnosticsResetting]);

  React.useEffect(() => {
    if (!supportsClientTelemetry) {
      setTelemetry(null);
      setTelemetryUpdatedAt(null);
      setTelemetryError(null);
      return;
    }
    if (!sessionDid) {
      setTelemetry(null);
      setTelemetryUpdatedAt(null);
      return;
    }
    void refreshSessionTelemetry();
  }, [refreshSessionTelemetry, sessionDid, supportsClientTelemetry]);

  React.useEffect(() => {
    if (!supportsClientTelemetry) {
      setWriterDiagnostics(null);
      setWriterDiagnosticsUpdatedAt(null);
      setWriterDiagnosticsError(null);
      return;
    }

    if (writerDiagnosticsWatchEnabled) return;

    void refreshWriterDiagnostics();
  }, [refreshWriterDiagnostics, supportsClientTelemetry, writerDiagnosticsWatchEnabled]);

  const refreshWriterDiagnosticsInWatchMode = React.useEffectEvent(async () => {
    await refreshWriterDiagnostics();
  });

  React.useEffect(() => {
    if (!supportsClientTelemetry || !writerDiagnosticsWatchEnabled) return undefined;

    let cancelled = false;
    let timeoutId: number | null = null;

    const schedule = (delayMs: number) => {
      timeoutId = window.setTimeout(() => {
        if (cancelled) return;
        void (async () => {
          if (document.visibilityState === 'visible') {
            await refreshWriterDiagnosticsInWatchMode();
          }
          if (!cancelled) {
            schedule(WRITER_DIAGNOSTICS_WATCH_INTERVAL_MS);
          }
        })();
      }, delayMs);
    };

    const refreshOnVisibility = () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      void refreshWriterDiagnosticsInWatchMode();
    };

    void refreshWriterDiagnosticsInWatchMode();
    schedule(WRITER_DIAGNOSTICS_WATCH_INTERVAL_MS);
    window.addEventListener('focus', refreshOnVisibility);
    document.addEventListener('visibilitychange', refreshOnVisibility);

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      window.removeEventListener('focus', refreshOnVisibility);
      document.removeEventListener('visibilitychange', refreshOnVisibility);
    };
  }, [refreshWriterDiagnosticsInWatchMode, supportsClientTelemetry, writerDiagnosticsWatchEnabled]);

  React.useEffect(() => {
    if (!supportsClientTelemetry) {
      setInterpolatorMetrics(null);
      setConversationSupervisorTelemetry(null);
      setInterpolatorMetricsUpdatedAt(null);
      setConversationOsHistory([]);
      return undefined;
    }

    return subscribeInterpolatorMetrics((snapshot) => {
      setInterpolatorMetrics(snapshot);
      setInterpolatorMetricsUpdatedAt(Date.now());
    });
  }, [supportsClientTelemetry]);

  React.useEffect(() => {
    if (!supportsClientTelemetry) {
      setConversationSupervisorTelemetry(null);
      return undefined;
    }

    return subscribeConversationSupervisorTelemetry((snapshot) => {
      setConversationSupervisorTelemetry(snapshot);
    });
  }, [supportsClientTelemetry]);

  React.useEffect(() => {
    if (!supportsClientTelemetry || !interpolatorMetrics) return;
    setConversationOsHistory(appendConversationOsHealthHistory(interpolatorMetrics));
  }, [interpolatorMetrics, supportsClientTelemetry]);

  React.useEffect(() => {
    if (!supportsClientTelemetry || !writerDiagnostics) return;
    setWriterProviderHistory(appendWriterEnhancerProviderHistory(writerDiagnostics));
  }, [supportsClientTelemetry, writerDiagnostics]);

  React.useEffect(() => {
    if (!supportsClientTelemetry) {
      setReviewPack(null);
      setReviewScore(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const { readStoredHumanReviewPack } = await import('../evals/conversationOsHumanReview');
        if (cancelled) return;
        setReviewPack(readStoredHumanReviewPack());
      } catch {
        if (!cancelled) {
          setReviewPack(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supportsClientTelemetry]);

  React.useEffect(() => {
    if (!supportsClientTelemetry || !reviewPack) {
      setReviewScore(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      const reviewModule = await import('../evals/conversationOsHumanReview');
      if (cancelled) return;
      reviewModule.writeStoredHumanReviewPack(reviewPack);
      setReviewScore(reviewModule.scoreHumanReviewPack(reviewPack));
    })();

    return () => {
      cancelled = true;
    };
  }, [reviewPack, supportsClientTelemetry]);

  const clearConversationOsTrendHistory = React.useCallback(() => {
    if (!supportsClientTelemetry) {
      setConversationOsHistory([]);
      setWriterProviderHistory([]);
      return;
    }
    clearConversationOsHealthHistory();
    clearWriterEnhancerProviderHistory();
    setConversationOsHistory([]);
    setWriterProviderHistory([]);
  }, [supportsClientTelemetry]);

  const generateReviewPack = React.useCallback(async () => {
    if (!supportsClientTelemetry || reviewPackLoading) return;

    setReviewPackLoading(true);
    setReviewPackError(null);
    setReviewPackCopyState('idle');

    try {
      const [{ buildConversationOsReport }, reviewModule] = await Promise.all([
        import('../evals/conversationOsEval'),
        import('../evals/conversationOsHumanReview'),
      ]);
      const report = await buildConversationOsReport();
      const nextPack = reviewModule.createHumanReviewPack(report, {
        reviewerId: reviewPack?.meta.reviewerId ?? '',
      });
      setReviewPack(nextPack);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate the Conversation OS human review pack.';
      setReviewPackError(message);
    } finally {
      setReviewPackLoading(false);
    }
  }, [reviewPack, reviewPackLoading, supportsClientTelemetry]);

  const clearReviewPack = React.useCallback(async () => {
    setReviewPack(null);
    setReviewScore(null);
    setReviewPackCopyState('idle');
    setReviewPackError(null);
    if (!supportsClientTelemetry) return;

    try {
      const { clearStoredHumanReviewPack } = await import('../evals/conversationOsHumanReview');
      clearStoredHumanReviewPack();
    } catch {
      // best-effort only
    }
  }, [supportsClientTelemetry]);

  const copyReviewPack = React.useCallback(async () => {
    if (!reviewPack || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      setReviewPackCopyState('failed');
      return;
    }

    try {
      await navigator.clipboard.writeText(`${JSON.stringify(reviewPack, null, 2)}\n`);
      setReviewPackCopyState('copied');
    } catch {
      setReviewPackCopyState('failed');
    }
  }, [reviewPack]);

  const updateReviewPack = React.useCallback((updater: (current: ConversationOsHumanReviewPack) => ConversationOsHumanReviewPack) => {
    setReviewPack((current) => (current ? updater(current) : current));
    setReviewPackCopyState('idle');
  }, []);

  const updateReviewerId = React.useCallback((reviewerId: string) => {
    updateReviewPack((current) => ({
      ...current,
      meta: {
        ...current.meta,
        reviewerId: reviewerId.trim() || null,
      },
      reviews: current.reviews.map((review) => ({
        ...review,
        humanReview: {
          ...review.humanReview,
          reviewerId: reviewerId.trim() || null,
        },
      })),
    }));
  }, [updateReviewPack]);

  const updateReviewNotes = React.useCallback((fixtureId: string, notes: string) => {
    updateReviewPack((current) => ({
      ...current,
      reviews: current.reviews.map((review) => (
        review.fixtureId === fixtureId
          ? {
              ...review,
              humanReview: {
                ...review.humanReview,
                notes,
                reviewedAt: new Date().toISOString(),
              },
            }
          : review
      )),
    }));
  }, [updateReviewPack]);

  const updateReviewVerdict = React.useCallback((
    fixtureId: string,
    verdictId: string,
    rating: HumanReviewRating,
  ) => {
    updateReviewPack((current) => ({
      ...current,
      reviews: current.reviews.map((review) => (
        review.fixtureId === fixtureId
          ? {
              ...review,
              humanReview: {
                ...review.humanReview,
                reviewedAt: new Date().toISOString(),
                verdicts: review.humanReview.verdicts.map((verdict) => (
                  verdict.id === verdictId
                    ? {
                        ...verdict,
                        rating: verdict.rating === rating ? null : rating,
                      }
                    : verdict
                )),
              },
            }
          : review
      )),
    }));
  }, [updateReviewPack]);

  const writerAlerts = React.useMemo(
    () => (writerDiagnostics ? deriveWriterDiagnosticsAlerts(writerDiagnostics) : []),
    [writerDiagnostics],
  );
  const premiumAlerts = React.useMemo(
    () => (premiumDiagnostics ? derivePremiumDiagnosticsAlerts(premiumDiagnostics) : []),
    [premiumDiagnostics],
  );
  const premiumProviderAlerts = React.useMemo(
    () => (premiumProviderAvailability ? derivePremiumProviderAvailabilityAlerts(premiumProviderAvailability) : []),
    [premiumProviderAvailability],
  );
  const deltaAlerts = React.useMemo(
    () => (interpolatorMetrics ? deriveConversationDeltaAlerts(interpolatorMetrics.delta) : []),
    [interpolatorMetrics],
  );
  const watchAlerts = React.useMemo(
    () => (
      interpolatorMetrics
        ? deriveConversationWatchAlerts({
            watch: interpolatorMetrics.watch,
            hydration: interpolatorMetrics.hydration,
          })
        : []
    ),
    [interpolatorMetrics],
  );
  const conversationOsHealth = React.useMemo(
    () => deriveConversationOsHealth({
      writer: writerDiagnostics,
      premium: premiumDiagnostics,
      premiumProviders: premiumProviderAvailability,
      metrics: interpolatorMetrics,
      supervisor: conversationSupervisorTelemetry,
    }),
    [conversationSupervisorTelemetry, interpolatorMetrics, premiumDiagnostics, premiumProviderAvailability, writerDiagnostics],
  );
  const conversationSupervisorSummary = React.useMemo<ConversationSupervisorSummary>(
    () => deriveConversationSupervisorSummary(conversationSupervisorTelemetry),
    [conversationSupervisorTelemetry],
  );
  const conversationOsTrend = React.useMemo<ConversationOsTrendSummary>(
    () => deriveConversationOsTrendSummary(conversationOsHistory),
    [conversationOsHistory],
  );
  const writerProviderTrends = React.useMemo<WriterProviderTrendSummary[]>(
    () => deriveWriterProviderTrendSummaries(writerProviderHistory),
    [writerProviderHistory],
  );
  const topEnhancerIssues = React.useMemo(
    () => (writerDiagnostics ? topWriterEnhancerIssues(writerDiagnostics) : []),
    [writerDiagnostics],
  );

  const multimodalStatus = !capability
    ? 'unknown'
    : !capability.multimodalAllowed
      ? 'off'
      : hasReadyLocalMultimodal
        ? 'local on-demand'
        : 'remote-backed on-demand';

  const capabilitySummary = capability
    ? [
        `Tier: ${capability.tier}`,
        `WebGPU: ${capability.webgpu ? 'yes' : 'no'}`,
        `Text generation: ${capability.generationAllowed ? 'allowed' : 'off'}`,
        `Multimodal: ${multimodalStatus}`,
      ].join(' • ')
    : 'Capability probe has not finished yet.';

  return (
    <section
      style={{
        border: '1px solid var(--sep)',
        borderRadius: 12,
        padding: '12px',
        background: 'var(--fill-1)',
        display: 'grid',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--label-2)' }}>
            Local AI runtime
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
            The current classifier worker stack remains the default hot path. Larger browser models are gated and only load on capable devices.
          </p>
        </div>

        <button
          type="button"
          onClick={() => { void refreshCapability(); }}
          disabled={refreshing}
          style={{
            appearance: 'none',
            border: '1px solid var(--sep)',
            background: 'var(--surface, #fff)',
            color: 'var(--label-1)',
            borderRadius: 10,
            minHeight: 34,
            padding: '7px 10px',
            font: 'inherit',
            fontSize: 12,
            fontWeight: 700,
            cursor: refreshing ? 'default' : 'pointer',
            opacity: refreshing ? 0.65 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          {refreshing ? 'Checking…' : 'Re-check device'}
        </button>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {MODES.map((mode) => {
          const selected = settingsMode === mode.value;
          return (
            <button
              key={mode.value}
              type="button"
              onClick={() => setSettingsMode(mode.value)}
              style={{
                appearance: 'none',
                border: selected ? '1px solid color-mix(in srgb, var(--blue) 50%, var(--sep))' : '1px solid var(--sep)',
                background: selected ? 'color-mix(in srgb, var(--blue) 10%, var(--fill-1))' : 'var(--surface, #fff)',
                borderRadius: 10,
                padding: '10px 12px',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(92px, 112px) 1fr',
                  columnGap: 12,
                  alignItems: 'start',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--label-1)', lineHeight: 1.25 }}>{mode.label}</span>
                  {selected && (
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--blue)' }}>
                      Active
                    </span>
                  )}
                </div>
                <div style={{ margin: 0, fontSize: 12, color: 'var(--label-2)', lineHeight: 1.45 }}>
                  {mode.description}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div
        style={{
          border: '1px solid var(--sep)',
          borderRadius: 10,
          padding: '10px 12px',
          background: 'var(--surface, #fff)',
          display: 'grid',
          gap: 6,
        }}
      >
        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--label-1)' }}>
          Runtime status
        </p>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
          {capabilitySummary}
        </p>
        {capability?.reason && (
          <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
            {capability.reason}
          </p>
        )}
        <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
          Load state: <strong style={{ color: 'var(--label-1)' }}>{loadState}</strong>
          {activeModel ? ` • active model: ${activeModel}` : ' • no large model loaded'}
        </p>
        {lastCapabilityProbeAt && (
          <p style={{ margin: 0, fontSize: 11, color: 'var(--label-4)' }}>
            Last checked {new Date(lastCapabilityProbeAt).toLocaleTimeString()}.
          </p>
        )}
        {lastError && (
          <p style={{ margin: 0, fontSize: 11, color: 'var(--red, #d14b4b)', lineHeight: 1.4 }}>
            {lastError}
          </p>
        )}
      </div>

      <div
        style={{
          border: '1px solid var(--sep)',
          borderRadius: 10,
          padding: '10px 12px',
          background: 'var(--surface, #fff)',
          display: 'grid',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--label-1)' }}>
            Runtime smoke check
          </p>
          <button
            type="button"
            onClick={() => { void refreshRuntimeSmoke(); }}
            disabled={smokeRefreshing || runtimeSmoke.overallState === 'running'}
            style={{
              appearance: 'none',
              border: '1px solid var(--sep)',
              background: 'var(--surface, #fff)',
              color: 'var(--label-1)',
              borderRadius: 8,
              minHeight: 28,
              padding: '4px 8px',
              font: 'inherit',
              fontSize: 11,
              fontWeight: 700,
              cursor: (smokeRefreshing || runtimeSmoke.overallState === 'running') ? 'default' : 'pointer',
              opacity: (smokeRefreshing || runtimeSmoke.overallState === 'running') ? 0.65 : 1,
            }}
          >
            {smokeRefreshing || runtimeSmoke.overallState === 'running' ? 'Checking…' : 'Re-run smoke'}
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
          {runtimeSmoke.overallState === 'idle'
            ? 'Runs a bounded readiness check against the local database and browser ML worker without blocking app boot.'
            : runtimeSmoke.overallState === 'passed'
              ? 'Local runtime checks passed.'
              : runtimeSmoke.overallState === 'failed'
                ? 'One or more local runtime checks failed.'
                : 'Runtime smoke check is in progress.'}
        </p>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
          DB: <strong style={{ color: 'var(--label-1)' }}>{runtimeSmoke.db.state}</strong>
          {runtimeSmoke.db.message ? ` • ${runtimeSmoke.db.message}` : ''}
        </p>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
          Browser ML: <strong style={{ color: 'var(--label-1)' }}>{runtimeSmoke.browserMl.state}</strong>
          {runtimeSmoke.browserMl.message ? ` • ${runtimeSmoke.browserMl.message}` : ''}
        </p>
        {runtimeSmoke.lastRunAt && (
          <p style={{ margin: 0, fontSize: 11, color: 'var(--label-4)' }}>
            Last checked {new Date(runtimeSmoke.lastRunAt).toLocaleTimeString()}.
          </p>
        )}
      </div>

      <div
        style={{
          border: '1px solid var(--sep)',
          borderRadius: 10,
          padding: '10px 12px',
          background: 'var(--surface, #fff)',
          display: 'grid',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--label-1)' }}>
            AI session telemetry
          </p>
          <div style={{ display: 'inline-flex', gap: 6 }}>
            <button
              type="button"
              onClick={() => { void refreshSessionTelemetry(); }}
              disabled={!supportsClientTelemetry || !sessionDid || telemetryLoading}
              style={{
                appearance: 'none',
                border: '1px solid var(--sep)',
                background: 'var(--surface, #fff)',
                color: 'var(--label-1)',
                borderRadius: 8,
                minHeight: 28,
                padding: '4px 8px',
                font: 'inherit',
                fontSize: 11,
                fontWeight: 700,
                cursor: (!supportsClientTelemetry || !sessionDid || telemetryLoading) ? 'default' : 'pointer',
                opacity: (!supportsClientTelemetry || !sessionDid || telemetryLoading) ? 0.65 : 1,
              }}
            >
              {telemetryLoading ? 'Loading…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={() => { void resetSessionTelemetry(); }}
              disabled={!supportsClientTelemetry || !sessionDid || telemetryResetting}
              style={{
                appearance: 'none',
                border: '1px solid var(--sep)',
                background: 'var(--surface, #fff)',
                color: 'var(--label-1)',
                borderRadius: 8,
                minHeight: 28,
                padding: '4px 8px',
                font: 'inherit',
                fontSize: 11,
                fontWeight: 700,
                cursor: (!supportsClientTelemetry || !sessionDid || telemetryResetting) ? 'default' : 'pointer',
                opacity: (!supportsClientTelemetry || !sessionDid || telemetryResetting) ? 0.65 : 1,
              }}
            >
              {telemetryResetting ? 'Resetting…' : 'Reset'}
            </button>
          </div>
        </div>

        {!supportsClientTelemetry && (
          <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
            This panel is disabled outside local development. Server-side AI session telemetry stays admin-protected in production and requires a secret that is never exposed to the browser.
          </p>
        )}

        {supportsClientTelemetry && !sessionDid && (
          <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
            Sign in to inspect hydration/replay telemetry.
          </p>
        )}

        {telemetry && (
          <>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
              Hydration attempts: <strong style={{ color: 'var(--label-1)' }}>{telemetry.durableHydration.attempts}</strong>
              {' • '}success {formatRate(telemetry.durableHydrationDerived.successRate)}
              {' • '}miss {formatRate(telemetry.durableHydrationDerived.missRate)}
              {' • '}failure {formatRate(telemetry.durableHydrationDerived.failureRate)}
            </p>

            <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
              Avg success latency: <strong style={{ color: 'var(--label-1)' }}>{telemetry.durableHydrationDerived.averageSuccessDurationMs.toFixed(1)}ms</strong>
              {' • '}max {telemetry.durableHydration.maxDurationMs}ms
              {' • '}last {telemetry.durableHydration.lastDurationMs}ms
            </p>

            <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
              Replay per success:
              {' '}events {telemetry.durableHydrationDerived.replayedItemsPerSuccess.events.toFixed(1)}
              {' • '}state {telemetry.durableHydrationDerived.replayedItemsPerSuccess.state.toFixed(1)}
              {' • '}presence {telemetry.durableHydrationDerived.replayedItemsPerSuccess.presence.toFixed(1)}
            </p>

            <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
              Items/page:
              {' '}events {telemetry.durableHydrationDerived.replayedItemsPerPage.events.toFixed(1)}
              {' • '}state {telemetry.durableHydrationDerived.replayedItemsPerPage.state.toFixed(1)}
              {' • '}presence {telemetry.durableHydrationDerived.replayedItemsPerPage.presence.toFixed(1)}
            </p>

            <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
              Strict read failures:
              {' '}events {telemetry.durableStrictReadFailures.events}
              {' • '}state {telemetry.durableStrictReadFailures.state}
              {' • '}presence {telemetry.durableStrictReadFailures.presence}
            </p>

            <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
              Strict write failures:
              {' '}events {telemetry.durableStrictWriteFailures.events}
              {' • '}state {telemetry.durableStrictWriteFailures.state}
              {' • '}presence {telemetry.durableStrictWriteFailures.presence}
            </p>

            {telemetryUpdatedAt && (
              <p style={{ margin: 0, fontSize: 11, color: 'var(--label-4)' }}>
                Updated {new Date(telemetryUpdatedAt).toLocaleTimeString()}.
              </p>
            )}
          </>
        )}

        {telemetryError && (
          <p style={{ margin: 0, fontSize: 11, color: 'var(--red, #d14b4b)', lineHeight: 1.4 }}>
            {telemetryError}
          </p>
        )}
      </div>

      <div
        style={{
          border: '1px solid var(--sep)',
          borderRadius: 10,
          padding: '10px 12px',
          background: 'var(--surface, #fff)',
          display: 'grid',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--label-1)' }}>
            Writer diagnostics
          </p>
          <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
                color: 'var(--label-3)',
                cursor: supportsClientTelemetry ? 'pointer' : 'default',
                opacity: supportsClientTelemetry ? 1 : 0.65,
              }}
            >
              <input
                type="checkbox"
                checked={writerDiagnosticsWatchEnabled}
                disabled={!supportsClientTelemetry}
                onChange={(event) => setWriterDiagnosticsWatchEnabled(event.target.checked)}
              />
              Watch
            </label>
            <button
              type="button"
              onClick={() => { void refreshWriterDiagnostics(); }}
              disabled={!supportsClientTelemetry || writerDiagnosticsLoading}
              style={{
                appearance: 'none',
                border: '1px solid var(--sep)',
                background: 'var(--surface, #fff)',
                color: 'var(--label-1)',
                borderRadius: 8,
                minHeight: 28,
                padding: '4px 8px',
                font: 'inherit',
                fontSize: 11,
                fontWeight: 700,
                cursor: (!supportsClientTelemetry || writerDiagnosticsLoading) ? 'default' : 'pointer',
                opacity: (!supportsClientTelemetry || writerDiagnosticsLoading) ? 0.65 : 1,
              }}
            >
              {writerDiagnosticsLoading ? 'Loading…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={() => { void resetWriterDiagnostics(); }}
              disabled={!supportsClientTelemetry || writerDiagnosticsResetting}
              style={{
                appearance: 'none',
                border: '1px solid var(--sep)',
                background: 'var(--surface, #fff)',
                color: 'var(--label-1)',
                borderRadius: 8,
                minHeight: 28,
                padding: '4px 8px',
                font: 'inherit',
                fontSize: 11,
                fontWeight: 700,
                cursor: (!supportsClientTelemetry || writerDiagnosticsResetting) ? 'default' : 'pointer',
                opacity: (!supportsClientTelemetry || writerDiagnosticsResetting) ? 0.65 : 1,
              }}
            >
              {writerDiagnosticsResetting ? 'Resetting…' : 'Reset'}
            </button>
            <button
              type="button"
              onClick={clearConversationOsTrendHistory}
              disabled={!supportsClientTelemetry}
              style={{
                appearance: 'none',
                border: '1px solid var(--sep)',
                background: 'var(--surface, #fff)',
                color: 'var(--label-1)',
                borderRadius: 8,
                minHeight: 28,
                padding: '4px 8px',
                font: 'inherit',
                fontSize: 11,
                fontWeight: 700,
                cursor: !supportsClientTelemetry ? 'default' : 'pointer',
                opacity: !supportsClientTelemetry ? 0.65 : 1,
              }}
            >
              Clear trends
            </button>
          </div>
        </div>

        {!supportsClientTelemetry && (
          <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
            Writer diagnostics are intentionally hidden outside local development. Production access remains secret-gated server-side.
          </p>
        )}

        {(writerDiagnostics || premiumDiagnostics || interpolatorMetrics || conversationSupervisorTelemetry) && (
          <>
            <div
              style={{
                border: '1px solid var(--sep)',
                borderRadius: 8,
                padding: '8px 10px',
                background: 'var(--fill-1)',
                display: 'grid',
                gap: 4,
              }}
            >
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: 'var(--label-1)' }}>
                Conversation OS health
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: 11,
                  lineHeight: 1.45,
                  color: conversationOsHealth.status === 'degraded'
                    ? 'var(--red, #d14b4b)'
                    : conversationOsHealth.status === 'watch'
                      ? 'var(--yellow, #c58b16)'
                      : 'var(--green, #228b5a)',
                }}
              >
                {conversationOsHealth.headline}
              </p>
              {conversationOsHealth.details.map((detail) => (
                <p key={detail} style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
                  {detail}
                </p>
              ))}
            </div>

            <div
              style={{
                border: '1px solid var(--sep)',
                borderRadius: 8,
                padding: '8px 10px',
                background: 'var(--fill-1)',
                display: 'grid',
                gap: 4,
              }}
            >
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: 'var(--label-1)' }}>
                Conversation supervisor
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: 11,
                  lineHeight: 1.45,
                  color: conversationSupervisorSummary.status === 'degraded'
                    ? 'var(--red, #d14b4b)'
                    : conversationSupervisorSummary.status === 'watch'
                      ? 'var(--yellow, #c58b16)'
                      : 'var(--green, #228b5a)',
                }}
              >
                {conversationSupervisorSummary.headline}
              </p>
              {conversationSupervisorSummary.details.map((detail) => (
                <p key={detail} style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
                  {detail}
                </p>
              ))}
            </div>

            <div
              style={{
                border: '1px solid var(--sep)',
                borderRadius: 8,
                padding: '8px 10px',
                background: 'var(--fill-1)',
                display: 'grid',
                gap: 4,
              }}
            >
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: 'var(--label-1)' }}>
                Recent trend
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: 11,
                  lineHeight: 1.45,
                  color: conversationOsTrend.status === 'degraded'
                    ? 'var(--red, #d14b4b)'
                    : conversationOsTrend.status === 'watch'
                      ? 'var(--yellow, #c58b16)'
                      : 'var(--green, #228b5a)',
                }}
              >
                {conversationOsTrend.headline}
              </p>
              {conversationOsTrend.details.map((detail) => (
                <p key={detail} style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
                  {detail}
                </p>
              ))}
            </div>

            <div
              style={{
                border: '1px solid var(--sep)',
                borderRadius: 8,
                padding: '8px 10px',
                background: 'var(--fill-1)',
                display: 'grid',
                gap: 8,
              }}
            >
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: 'var(--label-1)' }}>
                Reviewer provider drift
              </p>
              {writerProviderTrends.map((trend) => (
                <div
                  key={trend.provider}
                  style={{
                    border: '1px solid var(--sep)',
                    borderRadius: 8,
                    padding: '8px 10px',
                    background: 'var(--surface, #fff)',
                    display: 'grid',
                    gap: 4,
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: 11,
                      fontWeight: 700,
                      color: trend.status === 'degraded'
                        ? 'var(--red, #d14b4b)'
                        : trend.status === 'watch'
                          ? 'var(--yellow, #c58b16)'
                          : 'var(--green, #228b5a)',
                    }}
                  >
                    {trend.provider}: {trend.headline}
                  </p>
                  {trend.details.map((detail) => (
                    <p key={`${trend.provider}-${detail}`} style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
                      {detail}
                    </p>
                  ))}
                </div>
              ))}
            </div>

            {premiumDiagnostics && (
              <>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                  Premium deep: invocations <strong style={{ color: 'var(--label-1)' }}>{premiumDiagnostics.route.invocations}</strong>
                  {' • '}success {premiumDiagnostics.route.successes}
                  {' • '}failure {premiumDiagnostics.route.failures} ({formatRate(premiumDiagnostics.route.failureRate)})
                </p>

                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                  Premium failover:
                  {' '}attempted {premiumDiagnostics.route.failovers.attempted}
                  {' • '}succeeded {premiumDiagnostics.route.failovers.succeeded}
                  {' • '}failed {premiumDiagnostics.route.failovers.failed}
                  {' • '}success rate {formatRate(premiumDiagnostics.route.failovers.successRate)}
                </p>

                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                  Premium quality gate:
                  {' '}non-additive {premiumDiagnostics.route.qualityRejects.nonAdditive}
                  {' • '}low-signal {premiumDiagnostics.route.qualityRejects.lowSignal}
                  {' • '}reject rate {formatRate(premiumDiagnostics.route.qualityRejects.rejectionRate)}
                </p>

                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                  Premium safety:
                  {' '}runs {premiumDiagnostics.route.safetyFilter.runs}
                  {' • '}mutated {premiumDiagnostics.route.safetyFilter.mutated} ({formatRate(premiumDiagnostics.route.safetyFilter.mutationRate)})
                  {' • '}blocked {premiumDiagnostics.route.safetyFilter.blocked} ({formatRate(premiumDiagnostics.route.safetyFilter.blockRate)})
                </p>

                {Object.entries(premiumDiagnostics.providers)
                  .filter(([, provider]) => provider.attempts > 0)
                  .map(([provider, snapshot]) => (
                    <div key={`premium-${provider}`} style={{ display: 'grid', gap: 2 }}>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                        premium {provider}:
                        {' '}attempts {snapshot.attempts}
                        {' • '}failures {snapshot.failures} ({formatRate(snapshot.failureRate)})
                        {' • '}quality rejects {snapshot.qualityRejects.total} ({formatRate(snapshot.qualityRejects.rejectionRate)})
                        {' • '}avg latency {formatLatency(snapshot.latencyMs.average)}
                        {snapshot.lastModel ? ` • last model ${snapshot.lastModel}` : ''}
                      </p>
                      {snapshot.models && Object.keys(snapshot.models).length > 0 && (
                        <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                          {Object.entries(snapshot.models)
                            .map(([model, modelStats]) => (
                              `${model}: ${modelStats.successes}/${modelStats.attempts} ok`
                            ))
                            .join(' • ')}
                        </p>
                      )}
                    </div>
                  ))}

                {premiumDiagnostics.lastFailure && (
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
                    Last premium failure:
                    {' '}class {premiumDiagnostics.lastFailure.failureClass}
                    {premiumDiagnostics.lastFailure.provider ? ` • provider ${premiumDiagnostics.lastFailure.provider}` : ''}
                    {premiumDiagnostics.lastFailure.attemptKind ? ` • ${premiumDiagnostics.lastFailure.attemptKind}` : ''}
                    {premiumDiagnostics.lastFailure.code ? ` • code ${premiumDiagnostics.lastFailure.code}` : ''}
                    {' • '}updated {formatRelativeAge(premiumDiagnostics.lastFailure.at)}
                  </p>
                )}
              </>
            )}

            {premiumProviderAvailability && (
              <>
                {Object.entries(premiumProviderAvailability.health).map(([provider, health]) => {
                  const readiness = premiumProviderAvailability.readiness[provider];
                  return (
                    <p key={`premium-provider-health-${provider}`} style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
                      premium provider {provider}:
                      {' '}status {health.operational ? 'ready' : 'suppressed'}
                      {health.reason ? ` • reason ${health.reason}` : ''}
                      {readiness?.lastFailureStatus ? ` • status ${readiness.lastFailureStatus}` : ''}
                      {readiness?.lastFailureCode ? ` • code ${readiness.lastFailureCode}` : ''}
                      {health.unavailableUntil ? ` • until ${formatRelativeAge(health.unavailableUntil)}` : ''}
                    </p>
                  );
                })}

                {Object.entries(premiumProviderAvailability.readiness)
                  .filter(([, readiness]) => readiness.lastOutcome && readiness.lastOutcome !== 'success')
                  .map(([provider, readiness]) => (
                    <p key={`premium-provider-readiness-${provider}`} style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
                      readiness {provider}:
                      {' '}{readiness.lastOutcome?.replace('_', ' ')}
                      {readiness.lastFailureReason ? ` • ${readiness.lastFailureReason}` : ''}
                      {readiness.lastFailureStatus ? ` • status ${readiness.lastFailureStatus}` : ''}
                      {readiness.lastFailureMessage ? ` • ${readiness.lastFailureMessage}` : ''}
                    </p>
                  ))}
              </>
            )}

            {writerDiagnostics && (
              <>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                  Remote reviewer: invocations <strong style={{ color: 'var(--label-1)' }}>{writerDiagnostics.enhancer.invocations}</strong>
                  {' • '}reviews <strong style={{ color: 'var(--label-1)' }}>{writerDiagnostics.enhancer.reviews}</strong>
                  {' • '}watch {writerDiagnosticsWatchEnabled ? `on (${WRITER_DIAGNOSTICS_WATCH_INTERVAL_MS / 1000}s)` : 'off'}
                </p>

                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                  Outcomes: model <strong style={{ color: 'var(--label-1)' }}>{writerDiagnostics.clientOutcomes.model}</strong>
                  {' • '}fallback <strong style={{ color: 'var(--label-1)' }}>{writerDiagnostics.clientOutcomes.fallback}</strong>
                  {' • '}fallback rate <strong style={{ color: 'var(--label-1)' }}>{formatRate(writerDiagnostics.clientOutcomes.fallbackRate)}</strong>
                </p>

                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                  Fallback reasons:
                  {' '}abstained {writerDiagnostics.fallbackReasonDistribution['abstained-response-fallback']}
                  {' • '}root-only {writerDiagnostics.fallbackReasonDistribution['root-only-response-fallback']}
                  {' • '}failure {writerDiagnostics.fallbackReasonDistribution['failure-fallback']}
                </p>

                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                  Safety filter:
                  {' '}runs {writerDiagnostics.safetyFilter.runs}
                  {' • '}mutated {writerDiagnostics.safetyFilter.mutated} ({formatRate(writerDiagnostics.safetyFilter.mutationRate)})
                  {' • '}blocked {writerDiagnostics.safetyFilter.blocked} ({formatRate(writerDiagnostics.safetyFilter.blockRate)})
                </p>

                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                  Reviewer decisions:
                  {' '}accept {writerDiagnostics.enhancer.decisionCounts.accept}
                  {' • '}replace {writerDiagnostics.enhancer.decisionCounts.replace}
                  {' • '}takeovers {writerDiagnostics.enhancer.appliedTakeovers.total}
                </p>

                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                  Takeover mix:
                  {' '}candidate {writerDiagnostics.enhancer.appliedTakeovers.candidate} ({formatRate(writerDiagnostics.enhancer.appliedTakeovers.candidateReplacementRate)})
                  {' • '}rescue {writerDiagnostics.enhancer.appliedTakeovers.rescue} ({formatRate(writerDiagnostics.enhancer.appliedTakeovers.rescueRate)})
                </p>

                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                  Reviewer skips/failures:
                  {' '}skip {writerDiagnostics.enhancer.skips.total} ({formatRate(writerDiagnostics.enhancer.skips.skipRate)})
                  {' • '}failure {writerDiagnostics.enhancer.failures.total} ({formatRate(writerDiagnostics.enhancer.failures.failureRate)})
                  {' • '}timeout {writerDiagnostics.enhancer.failures.timeout}
                </p>

                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                  Replacement hygiene:
                  {' '}rejected {writerDiagnostics.enhancer.rejectedReplacements.total}
                  {' • '}invalid {writerDiagnostics.enhancer.rejectedReplacements['invalid-response']}
                  {' • '}abstained {writerDiagnostics.enhancer.rejectedReplacements['abstained-replacement']}
                </p>

                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                  Reviewer latency:
                  {' '}avg <strong style={{ color: 'var(--label-1)' }}>{formatLatency(writerDiagnostics.enhancer.latencyMs.average)}</strong>
                  {' • '}max {formatLatency(writerDiagnostics.enhancer.latencyMs.max)}
                  {' • '}last {formatLatency(writerDiagnostics.enhancer.latencyMs.last)}
                </p>

                {Object.entries(writerDiagnostics.enhancer.providers)
                  .filter(([, provider]) => provider.reviews > 0 || provider.failures > 0)
                  .map(([provider, snapshot]) => (
                    <p key={provider} style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                      {provider}:
                      {' '}reviews {snapshot.reviews}
                      {' • '}failures {snapshot.failures} ({formatRate(snapshot.failureRate)})
                      {' • '}takeovers {snapshot.appliedTakeovers.total} ({formatRate(snapshot.appliedTakeovers.takeoverRate)})
                      {' • '}avg latency {formatLatency(snapshot.latencyMs.average)}
                    </p>
                  ))}

                {topEnhancerIssues.length > 0 && (
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
                    Top reviewer issues:
                    {' '}
                    {topEnhancerIssues.map(([label, count]) => `${humanizeIssueLabel(label)} ${count}`).join(' • ')}
                    {typeof writerDiagnostics.enhancer.issueDistribution.uniqueLabels === 'number'
                      ? ` • unique ${writerDiagnostics.enhancer.issueDistribution.uniqueLabels}`
                      : ''}
                  </p>
                )}
              </>
            )}

            {(premiumAlerts.length > 0 || premiumProviderAlerts.length > 0) && (
              <div style={{ display: 'grid', gap: 4 }}>
                {[...premiumAlerts, ...premiumProviderAlerts].map((alert) => (
                  <p
                    key={`premium-alert-${alert.message}`}
                    style={{
                      margin: 0,
                      fontSize: 11,
                      lineHeight: 1.45,
                      color: alert.severity === 'high' ? 'var(--red, #d14b4b)' : 'var(--yellow, #c58b16)',
                    }}
                  >
                    {alert.message}
                  </p>
                ))}
              </div>
            )}

            {interpolatorMetrics && (
              <>
                <p style={{ margin: '4px 0 0', fontSize: 11, fontWeight: 700, color: 'var(--label-1)' }}>
                  Conversation delta
                </p>

                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                  Decisions: <strong style={{ color: 'var(--label-1)' }}>{interpolatorMetrics.delta.resolutionCount}</strong>
                  {' • '}stored reuse <strong style={{ color: 'var(--label-1)' }}>{formatRate(interpolatorMetrics.delta.storedReuseRate)}</strong>
                  {' • '}rebuild {formatRate(interpolatorMetrics.delta.rebuildRate)}
                </p>

                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                  Self-heal {formatRate(interpolatorMetrics.delta.selfHealRate)}
                  {' • '}summary fallback <strong style={{ color: 'var(--label-1)' }}>{interpolatorMetrics.delta.summaryFallbackCount}</strong>
                  {' • '}watch {writerDiagnosticsWatchEnabled ? `live (${WRITER_DIAGNOSTICS_WATCH_INTERVAL_MS / 1000}s)` : 'manual'}
                </p>

                <p style={{ margin: '4px 0 0', fontSize: 11, fontWeight: 700, color: 'var(--label-1)' }}>
                  Conversation substrate
                </p>

                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                  Modes:
                  {' '}normal {interpolatorMetrics.modes.normal.count}
                  {' • '}descriptive {interpolatorMetrics.modes.descriptive_fallback.count}
                  {' • '}minimal {interpolatorMetrics.modes.minimal_fallback.count}
                </p>

                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                  Gate:
                  {' '}passed {interpolatorMetrics.gate.passed}
                  {' • '}skipped {interpolatorMetrics.gate.skipped}
                  {' • '}fallback {formatRate(interpolatorMetrics.overallFallbackRate)}
                </p>

                <p style={{ margin: '4px 0 0', fontSize: 11, fontWeight: 700, color: 'var(--label-1)' }}>
                  Live thread watch
                </p>

                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                  State <strong style={{ color: 'var(--label-1)' }}>{interpolatorMetrics.watch.currentState}</strong>
                  {' • '}connects {interpolatorMetrics.watch.connectionAttempts}
                  {' • '}ready {interpolatorMetrics.watch.readyCount}
                  {' • '}invalidations {interpolatorMetrics.watch.invalidationCount}
                </p>

                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                  Degraded {interpolatorMetrics.watch.degradedCount}
                  {' • '}reconnects {interpolatorMetrics.watch.reconnectCount}
                  {' • '}last ready {formatRelativeAge(interpolatorMetrics.watch.lastReadyAt)}
                  {' • '}last change {formatRelativeAge(interpolatorMetrics.watch.lastInvalidationAt)}
                </p>

                <p style={{ margin: '4px 0 0', fontSize: 11, fontWeight: 700, color: 'var(--label-1)' }}>
                  Hydration mix
                </p>

                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                  Attempts <strong style={{ color: 'var(--label-1)' }}>{interpolatorMetrics.hydration.totalAttempts}</strong>
                  {' • '}success {formatRate(interpolatorMetrics.hydration.successRate)}
                  {' • '}event share {formatRate(interpolatorMetrics.hydration.eventShare)}
                  {' • '}poll share {formatRate(interpolatorMetrics.hydration.pollShare)}
                </p>

                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                  By phase:
                  {' '}initial {interpolatorMetrics.hydration.phases.initial.attempts}
                  {' • '}event {interpolatorMetrics.hydration.phases.event.attempts}
                  {' • '}poll {interpolatorMetrics.hydration.phases.poll.attempts}
                </p>
              </>
            )}

            {writerAlerts.length > 0 && (
              <div style={{ display: 'grid', gap: 4 }}>
                {writerAlerts.map((alert) => (
                  <p
                    key={alert.message}
                    style={{
                      margin: 0,
                      fontSize: 11,
                      lineHeight: 1.4,
                      color: alert.severity === 'high' ? 'var(--red, #d14b4b)' : 'var(--yellow, #c58b16)',
                    }}
                  >
                    {alert.severity === 'high' ? 'High alert: ' : 'Watch: '}
                    {alert.message}
                  </p>
                ))}
              </div>
            )}

            {deltaAlerts.length > 0 && (
              <div style={{ display: 'grid', gap: 4 }}>
                {deltaAlerts.map((alert) => (
                  <p
                    key={alert.message}
                    style={{
                      margin: 0,
                      fontSize: 11,
                      lineHeight: 1.4,
                      color: alert.severity === 'high' ? 'var(--red, #d14b4b)' : 'var(--yellow, #c58b16)',
                    }}
                  >
                    {alert.severity === 'high' ? 'Delta alert: ' : 'Delta watch: '}
                    {alert.message}
                  </p>
                ))}
              </div>
            )}

            {watchAlerts.length > 0 && (
              <div style={{ display: 'grid', gap: 4 }}>
                {watchAlerts.map((alert) => (
                  <p
                    key={alert.message}
                    style={{
                      margin: 0,
                      fontSize: 11,
                      lineHeight: 1.4,
                      color: alert.severity === 'high' ? 'var(--red, #d14b4b)' : 'var(--yellow, #c58b16)',
                    }}
                  >
                    {alert.severity === 'high' ? 'Watch alert: ' : 'Freshness watch: '}
                    {alert.message}
                  </p>
                ))}
              </div>
            )}

            {(writerDiagnosticsUpdatedAt || interpolatorMetricsUpdatedAt) && (
              <p style={{ margin: 0, fontSize: 11, color: 'var(--label-4)' }}>
                Updated {new Date(
                  Math.max(writerDiagnosticsUpdatedAt ?? 0, interpolatorMetricsUpdatedAt ?? 0),
                ).toLocaleTimeString()}.
              </p>
            )}
          </>
        )}

        {writerDiagnosticsError && (
          <p style={{ margin: 0, fontSize: 11, color: 'var(--red, #d14b4b)', lineHeight: 1.4 }}>
            {writerDiagnosticsError}
          </p>
        )}
      </div>

      <div
        style={{
          border: '1px solid var(--sep)',
          borderRadius: 10,
          padding: '10px 12px',
          background: 'var(--surface, #fff)',
          display: 'grid',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--label-1)' }}>
              Conversation OS human review
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
              Generate the judged review pack in-app, score it here, and keep the operator edits local to this browser by default.
            </p>
          </div>
          <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => { void generateReviewPack(); }}
              disabled={!supportsClientTelemetry || reviewPackLoading}
              style={{
                appearance: 'none',
                border: '1px solid var(--sep)',
                background: 'var(--surface, #fff)',
                color: 'var(--label-1)',
                borderRadius: 8,
                minHeight: 28,
                padding: '4px 8px',
                font: 'inherit',
                fontSize: 11,
                fontWeight: 700,
                cursor: (!supportsClientTelemetry || reviewPackLoading) ? 'default' : 'pointer',
                opacity: (!supportsClientTelemetry || reviewPackLoading) ? 0.65 : 1,
              }}
            >
              {reviewPackLoading ? 'Generating…' : reviewPack ? 'Regenerate pack' : 'Generate pack'}
            </button>
            <button
              type="button"
              onClick={() => { void copyReviewPack(); }}
              disabled={!reviewPack}
              style={{
                appearance: 'none',
                border: '1px solid var(--sep)',
                background: 'var(--surface, #fff)',
                color: 'var(--label-1)',
                borderRadius: 8,
                minHeight: 28,
                padding: '4px 8px',
                font: 'inherit',
                fontSize: 11,
                fontWeight: 700,
                cursor: reviewPack ? 'pointer' : 'default',
                opacity: reviewPack ? 1 : 0.65,
              }}
            >
              {reviewPackCopyState === 'copied' ? 'Copied' : 'Copy JSON'}
            </button>
            <button
              type="button"
              onClick={() => { void clearReviewPack(); }}
              disabled={!reviewPack}
              style={{
                appearance: 'none',
                border: '1px solid var(--sep)',
                background: 'var(--surface, #fff)',
                color: 'var(--label-1)',
                borderRadius: 8,
                minHeight: 28,
                padding: '4px 8px',
                font: 'inherit',
                fontSize: 11,
                fontWeight: 700,
                cursor: reviewPack ? 'pointer' : 'default',
                opacity: reviewPack ? 1 : 0.65,
              }}
            >
              Clear pack
            </button>
          </div>
        </div>

        {!supportsClientTelemetry && (
          <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
            This operator workflow is only enabled in local development.
          </p>
        )}

        {reviewPack && (
          <>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--label-1)' }}>
                Reviewer id
              </span>
              <input
                type="text"
                value={reviewPack.meta.reviewerId ?? ''}
                onChange={(event) => updateReviewerId(event.target.value)}
                placeholder="editor.handle"
                style={{
                  border: '1px solid var(--sep)',
                  borderRadius: 8,
                  minHeight: 34,
                  padding: '6px 10px',
                  font: 'inherit',
                  fontSize: 12,
                  background: 'var(--surface, #fff)',
                  color: 'var(--label-1)',
                }}
              />
            </label>

            {reviewScore && (
              <div
                style={{
                  border: '1px solid var(--sep)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  background: 'var(--fill-1)',
                  display: 'grid',
                  gap: 4,
                }}
              >
                <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: 'var(--label-1)' }}>
                  Review score
                </p>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                  Raw {reviewScore.overall.raw.score}/{reviewScore.overall.raw.total}
                  {' • '}weighted {reviewScore.overall.weighted.score}/{reviewScore.overall.weighted.total}
                  {' • '}completion {formatRate(reviewScore.overall.completionRate)}
                </p>
              </div>
            )}

            <div style={{ display: 'grid', gap: 10 }}>
              {reviewPack.reviews.map((review) => {
                const scoredReview = reviewScore?.reviews.find((entry) => entry.fixtureId === review.fixtureId) ?? null;
                return (
                  <div
                    key={review.fixtureId}
                    style={{
                      border: '1px solid var(--sep)',
                      borderRadius: 10,
                      padding: '10px 12px',
                      background: 'var(--fill-1)',
                      display: 'grid',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'grid', gap: 4 }}>
                      <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--label-1)' }}>
                        {review.description}
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                        Automated score {review.automatedEvaluation.raw.passed}/{review.automatedEvaluation.raw.total}
                        {' • '}weighted {review.automatedEvaluation.weighted.passed}/{review.automatedEvaluation.weighted.total}
                        {scoredReview
                          ? ` • reviewer ${scoredReview.raw.score}/${scoredReview.raw.total}`
                          : ''}
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
                        Projection: {review.systemProjection.summaryMode}
                        {' • '}contributors {review.systemProjection.surfacedContributors.map((entry) => `@${entry.handle}`).join(', ') || 'none'}
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
                        What changed: {review.systemProjection.whatChanged.join(' • ') || 'none'}
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
                        Context to watch: {review.systemProjection.contextToWatch.join(' • ') || 'none'}
                      </p>
                    </div>

                    <label style={{ display: 'grid', gap: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--label-1)' }}>
                        Review notes
                      </span>
                      <textarea
                        value={review.humanReview.notes}
                        onChange={(event) => updateReviewNotes(review.fixtureId, event.target.value)}
                        rows={3}
                        style={{
                          border: '1px solid var(--sep)',
                          borderRadius: 8,
                          padding: '8px 10px',
                          font: 'inherit',
                          fontSize: 12,
                          resize: 'vertical',
                          background: 'var(--surface, #fff)',
                          color: 'var(--label-1)',
                        }}
                      />
                    </label>

                    <div style={{ display: 'grid', gap: 8 }}>
                      {review.humanReview.verdicts.map((verdict) => (
                        <div
                          key={`${review.fixtureId}-${verdict.id}`}
                          style={{
                            border: '1px solid var(--sep)',
                            borderRadius: 8,
                            padding: '8px 10px',
                            background: 'var(--surface, #fff)',
                            display: 'grid',
                            gap: 6,
                          }}
                        >
                          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: 'var(--label-1)' }}>
                            {verdict.description}
                          </p>
                          <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                            {(['pass', 'partial', 'fail'] as const).map((rating) => {
                              const selected = verdict.rating === rating;
                              return (
                                <button
                                  key={rating}
                                  type="button"
                                  onClick={() => updateReviewVerdict(review.fixtureId, verdict.id, rating)}
                                  style={{
                                    appearance: 'none',
                                    border: selected ? '1px solid color-mix(in srgb, var(--blue) 50%, var(--sep))' : '1px solid var(--sep)',
                                    background: selected ? 'color-mix(in srgb, var(--blue) 10%, var(--fill-1))' : 'var(--surface, #fff)',
                                    color: 'var(--label-1)',
                                    borderRadius: 999,
                                    minHeight: 28,
                                    padding: '4px 10px',
                                    font: 'inherit',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                  }}
                                >
                                  {rating}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {reviewPackCopyState === 'failed' && (
          <p style={{ margin: 0, fontSize: 11, color: 'var(--red, #d14b4b)', lineHeight: 1.4 }}>
            Copying the review pack failed in this browser. You can still inspect and score it here.
          </p>
        )}

        {reviewPackError && (
          <p style={{ margin: 0, fontSize: 11, color: 'var(--red, #d14b4b)', lineHeight: 1.4 }}>
            {reviewPackError}
          </p>
        )}
      </div>
    </section>
  );
}
