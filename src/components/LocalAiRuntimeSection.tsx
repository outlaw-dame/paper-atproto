import React from 'react';
import { browserModelManager } from '../runtime/modelManager';
import type { RuntimeMode } from '../runtime/modelPolicy';
import { useRuntimeStore } from '../runtime/runtimeStore';
import { useSessionStore } from '../store/sessionStore';

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

type WriterDiagnosticsSnapshot = {
  startedAt: string;
  lastUpdatedAt: string;
  telemetryEvents: number;
  clientOutcomes: {
    model: number;
    fallback: number;
    total: number;
    modelToFallbackRatio: number | null;
    fallbackRate: number;
  };
  fallbackReasonDistribution: {
    'abstained-response-fallback': number;
    'root-only-response-fallback': number;
    'failure-fallback': number;
    totalFallbacks: number;
  };
  safetyFilter: {
    runs: number;
    mutated: number;
    blocked: number;
    mutationRate: number;
    blockRate: number;
  };
};

type WriterDiagnosticsAlert = {
  severity: 'high' | 'medium';
  message: string;
};

const WRITER_ALERT_THRESHOLDS = {
  fallbackRateHigh: 0.45,
  fallbackRateMedium: 0.25,
  rootOnlyFallbackRateHigh: 0.30,
  rootOnlyFallbackRateMedium: 0.15,
  failureFallbackRateHigh: 0.15,
  mutationRateHigh: 0.35,
  mutationRateMedium: 0.20,
  blockRateHigh: 0.05,
} as const;

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

function formatRate(value: number): string {
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
}

function deriveWriterDiagnosticsAlerts(snapshot: WriterDiagnosticsSnapshot): WriterDiagnosticsAlert[] {
  const alerts: WriterDiagnosticsAlert[] = [];
  const fallbackRate = snapshot.clientOutcomes.fallbackRate;
  const totalFallbacks = Math.max(1, snapshot.fallbackReasonDistribution.totalFallbacks);
  const rootOnlyRate = snapshot.fallbackReasonDistribution['root-only-response-fallback'] / totalFallbacks;
  const failureRate = snapshot.fallbackReasonDistribution['failure-fallback'] / totalFallbacks;
  const mutationRate = snapshot.safetyFilter.mutationRate;
  const blockRate = snapshot.safetyFilter.blockRate;

  if (fallbackRate >= WRITER_ALERT_THRESHOLDS.fallbackRateHigh) {
    alerts.push({ severity: 'high', message: 'High fallback rate detected. Model outputs are being replaced too often.' });
  } else if (fallbackRate >= WRITER_ALERT_THRESHOLDS.fallbackRateMedium) {
    alerts.push({ severity: 'medium', message: 'Fallback rate is elevated. Review prompt quality and reply grounding.' });
  }

  if (rootOnlyRate >= WRITER_ALERT_THRESHOLDS.rootOnlyFallbackRateHigh) {
    alerts.push({ severity: 'high', message: 'Root-only fallback is dominating fallback traffic. Replies may be under-utilized.' });
  } else if (rootOnlyRate >= WRITER_ALERT_THRESHOLDS.rootOnlyFallbackRateMedium) {
    alerts.push({ severity: 'medium', message: 'Root-only fallback is rising. Verify summary-reply grounding behavior.' });
  }

  if (failureRate >= WRITER_ALERT_THRESHOLDS.failureFallbackRateHigh) {
    alerts.push({ severity: 'high', message: 'Provider failure fallback is elevated. Investigate upstream reliability and latency.' });
  }

  if (mutationRate >= WRITER_ALERT_THRESHOLDS.mutationRateHigh) {
    alerts.push({ severity: 'high', message: 'Safety mutation rate is high. Writer outputs may be too close to safety boundaries.' });
  } else if (mutationRate >= WRITER_ALERT_THRESHOLDS.mutationRateMedium) {
    alerts.push({ severity: 'medium', message: 'Safety mutation rate is elevated. Monitor for readability degradation.' });
  }

  if (blockRate >= WRITER_ALERT_THRESHOLDS.blockRateHigh) {
    alerts.push({ severity: 'high', message: 'Safety block rate is high. Some outputs are being fully suppressed.' });
  }

  return alerts;
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

      const body = await response.json() as { writer?: WriterDiagnosticsSnapshot };
      if (!body.writer) {
        throw new Error('Writer diagnostics response was empty.');
      }

      setWriterDiagnostics(body.writer);
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

    void refreshWriterDiagnostics();
  }, [refreshWriterDiagnostics, supportsClientTelemetry]);

  const writerAlerts = React.useMemo(
    () => (writerDiagnostics ? deriveWriterDiagnosticsAlerts(writerDiagnostics) : []),
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--label-1)' }}>{mode.label}</span>
                {selected && (
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--blue)' }}>
                    Active
                  </span>
                )}
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--label-3)', lineHeight: 1.4 }}>
                {mode.description}
              </p>
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
          <div style={{ display: 'inline-flex', gap: 6 }}>
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
          </div>
        </div>

        {!supportsClientTelemetry && (
          <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
            Writer diagnostics are intentionally hidden outside local development. Production access remains secret-gated server-side.
          </p>
        )}

        {writerDiagnostics && (
          <>
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

            {writerDiagnosticsUpdatedAt && (
              <p style={{ margin: 0, fontSize: 11, color: 'var(--label-4)' }}>
                Updated {new Date(writerDiagnosticsUpdatedAt).toLocaleTimeString()}.
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
    </section>
  );
}
