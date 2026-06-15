// ─── Native Network Bridge ────────────────────────────────────────────────────
// Integrates Capacitor's Network plugin with the app's connectivity state.
//
// On native: uses @capacitor/network for accurate connection-type info and
// change events (wifi vs cellular vs none).
// On web: falls back to navigator.onLine + online/offline events.
//
// Does NOT replace existing web online/offline handling — supplements it
// with richer native signals (connection type, realistic offline detection).

import { Network, type ConnectionStatus, type ConnectionType } from '@capacitor/network';
import { isNativePlatform } from './capacitorRuntime';

export interface NetworkState {
  /** Whether the device has any network connectivity. */
  connected: boolean;
  /** Connection type: 'wifi', 'cellular', 'none', or 'unknown'. */
  connectionType: ConnectionType | 'unknown';
}

export type NetworkChangeHandler = (state: NetworkState) => void;

let initialized = false;
let currentState: NetworkState = {
  connected: typeof navigator !== 'undefined' ? navigator.onLine : true,
  connectionType: 'unknown',
};
const changeHandlers: Set<NetworkChangeHandler> = new Set();

/**
 * Returns the current network state snapshot.
 */
export function getNetworkState(): NetworkState {
  return { ...currentState };
}

/**
 * Register a handler to be called when network state changes.
 * Returns an unsubscribe function.
 */
export function onNetworkChange(handler: NetworkChangeHandler): () => void {
  changeHandlers.add(handler);
  return () => { changeHandlers.delete(handler); };
}

/**
 * Initialize the native network bridge.
 *
 * On native: subscribes to Capacitor Network plugin events.
 * On web: subscribes to browser online/offline events.
 *
 * Safe to call multiple times — only initializes once.
 */
export async function initNativeNetworkBridge(): Promise<void> {
  if (initialized) return;
  initialized = true;

  if (isNativePlatform()) {
    try {
      // Get initial state
      const status: ConnectionStatus = await Network.getStatus();
      currentState = {
        connected: status.connected,
        connectionType: status.connectionType ?? 'unknown',
      };

      // Subscribe to changes
      await Network.addListener('networkStatusChange', (status: ConnectionStatus) => {
        const newState: NetworkState = {
          connected: status.connected,
          connectionType: status.connectionType ?? 'unknown',
        };
        // Only notify if state actually changed
        if (
          newState.connected !== currentState.connected ||
          newState.connectionType !== currentState.connectionType
        ) {
          currentState = newState;
          notifyHandlers();
        }
      });
    } catch {
      // Network plugin unavailable — fall through to web fallback.
      initWebFallback();
    }
    return;
  }

  // Web fallback
  initWebFallback();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initWebFallback(): void {
  if (typeof window === 'undefined') return;

  currentState = {
    connected: navigator.onLine,
    connectionType: 'unknown',
  };

  window.addEventListener('online', () => {
    if (!currentState.connected) {
      currentState = { connected: true, connectionType: 'unknown' };
      notifyHandlers();
    }
  });

  window.addEventListener('offline', () => {
    if (currentState.connected) {
      currentState = { connected: false, connectionType: 'none' };
      notifyHandlers();
    }
  });
}

function notifyHandlers(): void {
  const snapshot = { ...currentState };
  for (const handler of changeHandlers) {
    try {
      handler(snapshot);
    } catch {
      // Handlers must not crash the network bridge.
    }
  }
}
