// ─── Network Health Probe ─────────────────────────────────────────────────────
// Distinguishes "degraded" from binary online/offline via a real connectivity probe.
import { applyNetworkHealthResult } from './offlineState.js';
// Probe a small same-origin static asset.
const PROBE_URL = '/paper-atproto/manifest.json';
const PROBE_TIMEOUT_MS = 4000;
// Backoff config for active probe cycles.
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const MAX_ATTEMPTS = 4;
let _probeTimer = null;
let _consecutiveFailures = 0;
export async function probeNetworkHealth() {
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
    }
    catch {
        clearTimeout(timeout);
        _consecutiveFailures++;
        const state = _consecutiveFailures >= 2 ? 'offline' : 'degraded';
        applyNetworkHealthResult(state);
        return { state, checkedAt };
    }
}
/** Schedule periodic health probes with bounded exponential backoff. */
export function startNetworkHealthPolling() {
    let attempt = 0;
    let stopped = false;
    function scheduleNext() {
        if (stopped)
            return;
        const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
        // Full jitter.
        const jitteredDelay = Math.floor(Math.random() * delay);
        _probeTimer = setTimeout(async () => {
            if (stopped)
                return;
            const result = await probeNetworkHealth();
            attempt = result.state === 'online' ? 0 : Math.min(attempt + 1, MAX_ATTEMPTS);
            scheduleNext();
        }, jitteredDelay);
    }
    scheduleNext();
    return () => {
        stopped = true;
        if (_probeTimer !== null) {
            clearTimeout(_probeTimer);
            _probeTimer = null;
        }
    };
}
//# sourceMappingURL=networkHealth.js.map