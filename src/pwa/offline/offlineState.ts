// ─── Offline State ────────────────────────────────────────────────────────────
// Observable online/offline/degraded state.
// Does NOT claim "online" from navigator.onLine alone — requires actual probe confirmation.

import type { NetworkState } from '../types';

export interface OfflineState {
  network: NetworkState;
  lastOnlineAt?: string;
  lastOfflineAt?: string;
}

let _state: OfflineState = {
  network: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'online',
};

const _listeners = new Set<(state: OfflineState) => void>();

const OFFLINE_STATE_INIT_KEY = '__paperOfflineStateListenersInstalled__';

function getGlobalScope(): Record<string, unknown> | null {
  if (typeof globalThis === 'undefined') return null;
  return globalThis as unknown as Record<string, unknown>;
}

function notify() {
  _listeners.forEach((fn) => fn({ ..._state }));
}

function setState(partial: Partial<OfflineState>) {
  _state = { ..._state, ...partial };
  notify();
}

if (typeof window !== 'undefined') {
  const globalScope = getGlobalScope();
  const alreadyInstalled = globalScope?.[OFFLINE_STATE_INIT_KEY] === true;

  if (!alreadyInstalled) {
    window.addEventListener('online', () => {
      setState({ network: 'online', lastOnlineAt: new Date().toISOString() });
    });
    window.addEventListener('offline', () => {
      setState({ network: 'offline', lastOfflineAt: new Date().toISOString() });
    });

    if (globalScope) {
      globalScope[OFFLINE_STATE_INIT_KEY] = true;
    }
  }
}

export function getOfflineState(): OfflineState {
  return { ..._state };
}

export function subscribeOfflineState(listener: (state: OfflineState) => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

/** Called by networkHealth probe to update degraded/online status. */
export function applyNetworkHealthResult(result: NetworkState): void {
  const now = new Date().toISOString();
  if (result === 'online') {
    setState({ network: 'online', lastOnlineAt: now });
  } else if (result === 'degraded') {
    setState({ network: 'degraded' });
  } else {
    setState({ network: 'offline', lastOfflineAt: now });
  }
}
