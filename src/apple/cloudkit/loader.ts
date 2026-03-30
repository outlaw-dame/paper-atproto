// ─── CloudKit Script Loader ──────────────────────────────────────────────────
// Loads Apple's CloudKit JS library lazily and safely.
// Only allows the official Apple CDN or a same-origin override.
// Never auto-loads during app boot; callers decide when to initialize it.

import { CloudKitConfigError, CloudKitTransportError } from './errors.js';

const DEFAULT_CLOUDKIT_JS_SRC = 'https://cdn.apple-cloudkit.com/ck/2/cloudkit.js';
const CLOUDKIT_SCRIPT_ATTR = 'data-paper-cloudkit';
const CLOUDKIT_SCRIPT_TIMEOUT_MS = 12_000;
const CLOUDKIT_SCRIPT_MAX_ATTEMPTS = 3;
const CLOUDKIT_SCRIPT_BASE_DELAY_MS = 600;
const CLOUDKIT_SCRIPT_MAX_DELAY_MS = 4_000;
const ALLOWED_REMOTE_HOSTS = new Set(['cdn.apple-cloudkit.com']);

const CLOUDKIT_CONTAINER_ID = import.meta.env.VITE_CLOUDKIT_CONTAINER_ID as string | undefined;
const CLOUDKIT_API_TOKEN = import.meta.env.VITE_CLOUDKIT_API_TOKEN as string | undefined;
const CLOUDKIT_JS_SRC = import.meta.env.VITE_CLOUDKIT_JS_SRC as string | undefined;

let loadPromise: Promise<void> | null = null;

export function hasCloudKitConfiguration(): boolean {
  return isNonEmptyString(CLOUDKIT_CONTAINER_ID) && isNonEmptyString(CLOUDKIT_API_TOKEN);
}

export function isCloudKitLoaded(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return typeof (window as typeof window & { CloudKit?: unknown }).CloudKit !== 'undefined';
}

export function canLoadCloudKitScript(currentOrigin?: string): boolean {
  if (!hasCloudKitConfiguration()) {
    return false;
  }

  try {
    void resolveCloudKitScriptUrl(currentOrigin);
    return true;
  } catch {
    return false;
  }
}

export function resolveCloudKitScriptUrl(currentOrigin?: string): string {
  const raw = normalizeEnvValue(CLOUDKIT_JS_SRC) ?? DEFAULT_CLOUDKIT_JS_SRC;
  return sanitizeCloudKitScriptUrl(raw, currentOrigin ?? getWindowOrigin());
}

export function sanitizeCloudKitScriptUrl(raw: string, currentOrigin?: string): string {
  const candidate = raw.trim();
  if (candidate.length === 0) {
    throw new CloudKitConfigError('CloudKit script URL is empty');
  }

  let url: URL;
  try {
    url = currentOrigin ? new URL(candidate, currentOrigin) : new URL(candidate);
  } catch (error) {
    throw new CloudKitConfigError('CloudKit script URL is invalid', error);
  }

  if (url.username || url.password) {
    throw new CloudKitConfigError('CloudKit script URL must not include credentials');
  }

  if (url.hash) {
    throw new CloudKitConfigError('CloudKit script URL must not include a fragment');
  }

  if (!/\.js$/i.test(url.pathname)) {
    throw new CloudKitConfigError('CloudKit script URL must reference a JavaScript asset');
  }

  const sameOrigin = isSameOriginUrl(url, currentOrigin);
  if (!sameOrigin && url.protocol !== 'https:') {
    throw new CloudKitConfigError('CloudKit script URL must use HTTPS unless it is same-origin');
  }

  if (!sameOrigin && !ALLOWED_REMOTE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new CloudKitConfigError('CloudKit script host is not allowed');
  }

  return url.toString();
}

export async function ensureCloudKitLoaded(): Promise<void> {
  if (isCloudKitLoaded()) {
    return;
  }

  if (!hasCloudKitConfiguration()) {
    throw new CloudKitConfigError('CloudKit configuration missing');
  }

  if (typeof document === 'undefined' || typeof window === 'undefined') {
    throw new CloudKitConfigError('CloudKit requires a browser document');
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = loadCloudKitScriptWithRetry();
  try {
    await loadPromise;
  } catch (error) {
    loadPromise = null;
    throw error;
  }
}

async function loadCloudKitScriptWithRetry(): Promise<void> {
  const src = resolveCloudKitScriptUrl();
  let lastError: unknown = null;

  for (let attempt = 0; attempt < CLOUDKIT_SCRIPT_MAX_ATTEMPTS; attempt++) {
    try {
      await injectCloudKitScript(src);
      if (!isCloudKitLoaded()) {
        throw new CloudKitTransportError('CloudKit script loaded without exposing window.CloudKit');
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= CLOUDKIT_SCRIPT_MAX_ATTEMPTS - 1) {
        break;
      }

      const ceiling = Math.min(
        CLOUDKIT_SCRIPT_BASE_DELAY_MS * Math.pow(2, attempt),
        CLOUDKIT_SCRIPT_MAX_DELAY_MS,
      );
      await delay(Math.floor(Math.random() * ceiling));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new CloudKitTransportError('CloudKit script failed to load');
}

function injectCloudKitScript(src: string): Promise<void> {
  if (isCloudKitLoaded()) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const existing = findCloudKitScript(src);
    const script = existing ?? document.createElement('script');
    const created = existing === null;
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };

    const onLoad = () => {
      finish(() => {
        script.dataset.paperCloudkitLoaded = 'true';
        resolve();
      });
    };

    const onError = (event: Event | string) => {
      finish(() => {
        if (created) {
          script.remove();
        }
        reject(new CloudKitTransportError('CloudKit script failed to load', event));
      });
    };

    const timeoutId = window.setTimeout(() => {
      finish(() => {
        if (created) {
          script.remove();
        }
        reject(new CloudKitTransportError('CloudKit script load timed out'));
      });
    }, CLOUDKIT_SCRIPT_TIMEOUT_MS);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError as EventListener);
    };

    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError as EventListener, { once: true });

    if (created) {
      script.src = src;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.referrerPolicy = 'strict-origin';
      script.setAttribute(CLOUDKIT_SCRIPT_ATTR, '1');
      (document.head ?? document.documentElement).appendChild(script);
    } else if (script.dataset.paperCloudkitLoaded === 'true') {
      finish(resolve);
    }
  });
}

function findCloudKitScript(src: string): HTMLScriptElement | null {
  if (typeof document === 'undefined') {
    return null;
  }

  return Array.from(document.getElementsByTagName('script')).find((script) => {
    return script.getAttribute(CLOUDKIT_SCRIPT_ATTR) === '1' || script.src === src;
  }) ?? null;
}

function isSameOriginUrl(url: URL, currentOrigin?: string): boolean {
  if (!currentOrigin) {
    return false;
  }

  try {
    return url.origin === new URL(currentOrigin).origin;
  } catch {
    return false;
  }
}

function getWindowOrigin(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return window.location.origin;
}

function isNonEmptyString(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeEnvValue(value: string | undefined): string | undefined {
  if (!isNonEmptyString(value)) {
    return undefined;
  }
  return value!.trim();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
