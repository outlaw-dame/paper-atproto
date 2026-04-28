// ─── Network Health Probe ─────────────────────────────────────────────────────
// Distinguishes "degraded" from binary online/offline via a real connectivity probe.

import type { NetworkState } from '../types';
import { applyNetworkHealthResult } from './offlineState';

export interface NetworkHealthResult {
  state: NetworkState;
  checkedAt: string;
  latencyMs?: number;
}

// Probe a small same-origin static asset.
const PROBE_URL = '/paper-atproto/manifest.json';
const PROBE_TIMEOUT_MS = 4000;
const MIN_DELAY_MS = 4000;

// Backoff config for active probe cycles.
const BASE_DELAY_MS = 8000;
const MAX_DELAY_MS = 30_000;
const MAX_ATTEMPTS = 4;

let _probeTimer: ReturnType<typeof setTimeout> | null = null;
let _consecutiveFailures = 0;
let _activePollers = 0;
let _probeInFlight = false;

export async function probeNetworkHealth(): Promise<NetworkHealthResult> {
  const checkedAt = new Date().toISOString();

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    applyNetworkHealthResult('offline');
    return { state: 'offline', checkedAt };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const t0 = performance.now();

  try {
    const res = await fetch(`${PROBE_URL}?_probe=${Date.now()}`, {
      method: 'HEAD',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const latencyMs = Math.round(performance.now() - t0);

    if (res.ok) {
      _consecutiveFailures = 0;
      applyNetworkHealthResult('online');
      return { state: 'online', checkedAt, latencyMs };
    }

    // Non-OK but reachable — treat as degraded.
    applyNetworkHealthResult('degraded');
    return { state: 'degraded', checkedAt, latencyMs };
  } catch {
    clearTimeout(timeout);
    _consecutiveFailures++;

    const state: NetworkState = _consecutiveFailures >= 2 ? 'offline' : 'degraded';
    applyNetworkHealthResult(state);
    return { state, checkedAt };
  }
}

/** Schedule periodic health probes with bounded exponential backoff. */
export function startNetworkHealthPolling(): () => void {
  _activePollers += 1;
  if (_activePollers > 1) {
    return () => {
      _activePollers = Math.max(0, _activePollers - 1);
    };
  }

  let attempt = 0;
  let stopped = false;

  function scheduleNext() {
    if (stopped) return;
    const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
    // Full jitter with a floor to avoid accidental near-zero tight loops.
    const jitteredDelay = Math.max(MIN_DELAY_MS, Math.floor(Math.random() * delay));
    _probeTimer = setTimeout(async () => {
      if (stopped) return;
      if (_probeInFlight) {
        scheduleNext();
        return;
      }
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        attempt = Math.min(attempt + 1, MAX_ATTEMPTS);
        scheduleNext();
        return;
      }
      _probeInFlight = true;
      const result = await probeNetworkHealth();
      _probeInFlight = false;
      attempt = result.state === 'online' ? 0 : Math.min(attempt + 1, MAX_ATTEMPTS);
      scheduleNext();
    }, jitteredDelay);
  }

  scheduleNext();

  return () => {
    _activePollers = Math.max(0, _activePollers - 1);
    if (_activePollers > 0) {
      return;
    }
    stopped = true;
    if (_probeTimer !== null) {
      clearTimeout(_probeTimer);
      _probeTimer = null;
    }
    _probeInFlight = false;
  };
}
