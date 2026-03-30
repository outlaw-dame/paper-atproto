// ─── CloudKit Auth ────────────────────────────────────────────────────────────
// Lazy init and auth state for CloudKit JS.
// Entirely separate from ATProto session — never influences core login state.
// Never logs tokens or raw auth responses.

import { CloudKitConfigError, CloudKitAuthError, CloudKitTransportError } from './errors.js';
import { ensureCloudKitLoaded, hasCloudKitConfiguration } from './loader.js';

export interface CloudKitAuthState {
  ready: boolean;
  signedIn: boolean;
  errorCode?: string;
}

export interface InitializeCloudKitOptions {
  interactive?: boolean;
}

let _authState: CloudKitAuthState | null = null;
let _initPromise: Promise<CloudKitAuthState> | null = null;

const CLOUDKIT_CONTAINER_ID = import.meta.env.VITE_CLOUDKIT_CONTAINER_ID as string | undefined;
const CLOUDKIT_API_TOKEN = import.meta.env.VITE_CLOUDKIT_API_TOKEN as string | undefined;
const CLOUDKIT_ENV =
  (import.meta.env.VITE_CLOUDKIT_ENVIRONMENT as string | undefined) ??
  (import.meta.env.VITE_CLOUDKIT_ENV as string | undefined) ??
  'production';

type CloudKitGlobal = {
  configure(config: object): void;
  getDefaultContainer(): CloudKitContainer;
};

type CloudKitContainer = {
  setUpAuth(): Promise<{ isSignedIn?: boolean }>;
  signIn(): Promise<{ isSignedIn?: boolean }>;
  signOut(): Promise<void>;
};

/** Initialize CloudKit JS. Must be called lazily — never blocks app boot. */
export async function initializeCloudKit(
  options: InitializeCloudKitOptions = {},
): Promise<CloudKitAuthState> {
  if (_authState) {
    if (options.interactive && _authState.ready && !_authState.signedIn) {
      return signInToCloudKit();
    }
    return _authState;
  }

  if (_initPromise) {
    try {
      const state = await _initPromise;
      if (options.interactive && state.ready && !state.signedIn) {
        return signInToCloudKit();
      }
      return state;
    } catch (error) {
      _initPromise = null;
      throw error;
    }
  }

  _initPromise = _doInit();

  try {
    _authState = await _initPromise;
    if (options.interactive && _authState.ready && !_authState.signedIn) {
      return signInToCloudKit();
    }
    return _authState;
  } catch (error) {
    _authState = null;
    throw error;
  } finally {
    _initPromise = null;
  }
}

async function _doInit(): Promise<CloudKitAuthState> {
  if (!hasCloudKitConfiguration() || !CLOUDKIT_CONTAINER_ID || !CLOUDKIT_API_TOKEN) {
    return { ready: false, signedIn: false, errorCode: 'config-missing' };
  }

  await ensureCloudKitLoaded();

  const CK = (window as typeof window & { CloudKit?: CloudKitGlobal }).CloudKit;
  if (!CK) {
    return { ready: false, signedIn: false, errorCode: 'script-not-loaded' };
  }

  try {
    CK.configure({
      containers: [
        {
          containerIdentifier: CLOUDKIT_CONTAINER_ID,
          apiTokenAuth: {
            apiToken: CLOUDKIT_API_TOKEN,
            persist: true,
          },
          environment: CLOUDKIT_ENV,
        },
      ],
    });

    const container = CK.getDefaultContainer();
    const result = await container.setUpAuth();

    const signedIn = result?.isSignedIn === true;
    return { ready: true, signedIn };
  } catch (err) {
    if (
      err instanceof CloudKitConfigError ||
      err instanceof CloudKitAuthError ||
      err instanceof CloudKitTransportError
    ) {
      throw err;
    }

    const msg = err instanceof Error ? err.message : 'unknown';
    if (msg.includes('auth') || msg.includes('token')) {
      throw new CloudKitAuthError('CloudKit auth failed', err);
    }
    throw new CloudKitConfigError('CloudKit init failed', err);
  }
}

export function getCloudKitAuthState(): CloudKitAuthState {
  return _authState ?? { ready: false, signedIn: false };
}

export async function signInToCloudKit(): Promise<CloudKitAuthState> {
  await ensureCloudKitLoaded();

  const CK = (window as typeof window & { CloudKit?: CloudKitGlobal }).CloudKit;
  if (!CK) return { ready: false, signedIn: false, errorCode: 'script-not-loaded' };
  try {
    const container = CK.getDefaultContainer();
    const result = await container.signIn();
    _authState = { ready: true, signedIn: result?.isSignedIn === true };
    return _authState;
  } catch (err) {
    throw new CloudKitAuthError('CloudKit sign-in failed', err);
  }
}
