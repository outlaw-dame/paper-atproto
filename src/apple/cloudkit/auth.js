// ─── CloudKit Auth ────────────────────────────────────────────────────────────
// Lazy init and auth state for CloudKit JS.
// Entirely separate from ATProto session — never influences core login state.
// Never logs tokens or raw auth responses.
import { CloudKitConfigError, CloudKitAuthError, CloudKitTransportError } from './errors.js';
import { ensureCloudKitLoaded, hasCloudKitConfiguration } from './loader.js';
let _authState = null;
let _initPromise = null;
const CLOUDKIT_CONTAINER_ID = import.meta.env.VITE_CLOUDKIT_CONTAINER_ID;
const CLOUDKIT_API_TOKEN = import.meta.env.VITE_CLOUDKIT_API_TOKEN;
const CLOUDKIT_ENV = import.meta.env.VITE_CLOUDKIT_ENVIRONMENT ??
    import.meta.env.VITE_CLOUDKIT_ENV ??
    'production';
/** Initialize CloudKit JS. Must be called lazily — never blocks app boot. */
export async function initializeCloudKit(options = {}) {
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
        }
        catch (error) {
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
    }
    catch (error) {
        _authState = null;
        throw error;
    }
    finally {
        _initPromise = null;
    }
}
async function _doInit() {
    if (!hasCloudKitConfiguration() || !CLOUDKIT_CONTAINER_ID || !CLOUDKIT_API_TOKEN) {
        return { ready: false, signedIn: false, errorCode: 'config-missing' };
    }
    await ensureCloudKitLoaded();
    const CK = window.CloudKit;
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
    }
    catch (err) {
        if (err instanceof CloudKitConfigError ||
            err instanceof CloudKitAuthError ||
            err instanceof CloudKitTransportError) {
            throw err;
        }
        const msg = err instanceof Error ? err.message : 'unknown';
        if (msg.includes('auth') || msg.includes('token')) {
            throw new CloudKitAuthError('CloudKit auth failed', err);
        }
        throw new CloudKitConfigError('CloudKit init failed', err);
    }
}
export function getCloudKitAuthState() {
    return _authState ?? { ready: false, signedIn: false };
}
export async function signInToCloudKit() {
    await ensureCloudKitLoaded();
    const CK = window.CloudKit;
    if (!CK)
        return { ready: false, signedIn: false, errorCode: 'script-not-loaded' };
    try {
        const container = CK.getDefaultContainer();
        const result = await container.signIn();
        _authState = { ready: true, signedIn: result?.isSignedIn === true };
        return _authState;
    }
    catch (err) {
        throw new CloudKitAuthError('CloudKit sign-in failed', err);
    }
}
