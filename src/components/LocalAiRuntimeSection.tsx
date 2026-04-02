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

function formatRate(value: number): string {
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
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
  }, [sessionDid, telemetryLoading]);

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
  }, [refreshSessionTelemetry, sessionDid, telemetryResetting]);

  React.useEffect(() => {
    if (!sessionDid) {
      setTelemetry(null);
      setTelemetryUpdatedAt(null);
      return;
    }
    void refreshSessionTelemetry();
  }, [refreshSessionTelemetry, sessionDid]);

  const capabilitySummary = capability
    ? [
        `Tier: ${capability.tier}`,
        `WebGPU: ${capability.webgpu ? 'yes' : 'no'}`,
        `Text generation: ${capability.generationAllowed ? 'allowed' : 'off'}`,
        `Multimodal: ${capability.multimodalAllowed ? 'on-demand only' : 'off'}`,
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
              disabled={!sessionDid || telemetryLoading}
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
                cursor: (!sessionDid || telemetryLoading) ? 'default' : 'pointer',
                opacity: (!sessionDid || telemetryLoading) ? 0.65 : 1,
              }}
            >
              {telemetryLoading ? 'Loading…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={() => { void resetSessionTelemetry(); }}
              disabled={!sessionDid || telemetryResetting}
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
                cursor: (!sessionDid || telemetryResetting) ? 'default' : 'pointer',
                opacity: (!sessionDid || telemetryResetting) ? 0.65 : 1,
              }}
            >
              {telemetryResetting ? 'Resetting…' : 'Reset'}
            </button>
          </div>
        </div>

        {!sessionDid && (
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
    </section>
  );
}
