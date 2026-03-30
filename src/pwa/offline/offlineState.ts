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

function notify() {
  _listeners.forEach((fn) => fn({ ..._state }));
}

function setState(partial: Partial<OfflineState>) {
  _state = { ..._state, ...partial };
  notify();
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    setState({ network: 'online', lastOnlineAt: new Date().toISOString() });
  });
  window.addEventListener('offline', () => {
    setState({ network: 'offline', lastOfflineAt: new Date().toISOString() });
  });
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
