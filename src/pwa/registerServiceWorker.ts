// ─── Service Worker Registration ─────────────────────────────────────────────

import type { ServiceWorkerErrorCode, ServiceWorkerRegistrationState } from './types.js';

const BASE_URL = import.meta.env.BASE_URL || '/';
const SW_FILENAME = 'sw.js';
const SW_PREFLIGHT_TIMEOUT_MS = 4_000;
const SUPPORTED_SW_MIME_TYPES = new Set([
  'application/javascript',
  'application/x-javascript',
  'text/javascript',
  'text/ecmascript',
  'application/ecmascript',
]);

let _registration: ServiceWorkerRegistration | null = null;

// Notify listeners when an update is ready.
const _updateListeners = new Set<() => void>();

export function onServiceWorkerUpdate(fn: () => void): () => void {
  _updateListeners.add(fn);
  return () => _updateListeners.delete(fn);
}

function parseCurrentUrl(currentHref?: string): URL | null {
  const href = currentHref
    ?? (typeof document !== 'undefined' ? document.baseURI : undefined)
    ?? (typeof window !== 'undefined' ? window.location.href : undefined);
  if (!href) return null;

  try {
    return new URL(href);
  } catch {
    return null;
  }
}

export function normalizeServiceWorkerBasePath(value: string): string {
  const raw = value.trim();
  if (!raw) return '/';

  let pathname = raw;
  try {
    pathname = new URL(raw, 'https://glimpse.invalid').pathname;
  } catch {
    pathname = raw.split(/[?#]/, 1)[0] ?? raw;
  }

  if (!pathname.startsWith('/')) {
    pathname = `/${pathname}`;
  }

  pathname = pathname.replace(/\/{2,}/g, '/');
  if (pathname === '/') return '/';

  if (!pathname.endsWith('/')) {
    const lastSlash = pathname.lastIndexOf('/');
    const lastSegment = pathname.slice(lastSlash + 1);
    pathname = lastSegment.includes('.') ? pathname.slice(0, lastSlash + 1) : `${pathname}/`;
  }

  return pathname || '/';
}

export function deriveServiceWorkerScope(
  currentHref?: string,
  configuredBasePath: string = BASE_URL,
): string {
  const configuredBase = normalizeServiceWorkerBasePath(configuredBasePath);
  const currentUrl = parseCurrentUrl(currentHref);
  if (!currentUrl) {
    return configuredBase;
  }

  const runtimeBase = normalizeServiceWorkerBasePath(currentUrl.pathname);
  if (configuredBase !== '/' && runtimeBase.startsWith(configuredBase)) {
    return configuredBase;
  }

  return runtimeBase;
}

function joinAppPath(basePath: string, relativePath: string): string {
  const normalizedBasePath = normalizeServiceWorkerBasePath(basePath);
  if (!relativePath) {
    return normalizedBasePath;
  }

  return `${normalizedBasePath}${relativePath.replace(/^\/+/, '')}`;
}

export function buildServiceWorkerScriptUrl(
  currentHref?: string,
  configuredBasePath: string = BASE_URL,
): string {
  const currentUrl = parseCurrentUrl(currentHref);
  const origin = currentUrl?.origin ?? (typeof window !== 'undefined' ? window.location.origin : 'https://glimpse.invalid');
  const scope = deriveServiceWorkerScope(currentHref, configuredBasePath);
  return new URL(joinAppPath(scope, SW_FILENAME), origin).toString();
}

export function hasSupportedServiceWorkerContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return true;

  const mimeType = contentType.split(';', 1)[0]?.trim().toLowerCase();
  if (!mimeType) return true;

  return SUPPORTED_SW_MIME_TYPES.has(mimeType);
}

async function preflightServiceWorkerScript(scriptUrl: string): Promise<{
  ok: true;
} | {
  ok: false;
  errorCode: ServiceWorkerErrorCode;
}> {
  if (typeof window === 'undefined') {
    return { ok: true };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(scriptUrl, window.location.origin);
  } catch {
    return { ok: false, errorCode: 'script-fetch-failed' };
  }

  if (parsedUrl.origin !== window.location.origin) {
    return { ok: false, errorCode: 'script-fetch-failed' };
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), SW_PREFLIGHT_TIMEOUT_MS);

  try {
    const response = await fetch(parsedUrl.toString(), {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        Accept: 'application/javascript, text/javascript, application/ecmascript, text/ecmascript, */*;q=0.8',
      },
    });

    if (!response.ok) {
      return { ok: false, errorCode: 'script-fetch-failed' };
    }

    const contentType = response.headers.get('content-type');
    if (!hasSupportedServiceWorkerContentType(contentType)) {
      return { ok: false, errorCode: 'script-invalid-content-type' };
    }

    const responseUrl = response.url ? new URL(response.url, window.location.origin) : parsedUrl;
    if (responseUrl.origin !== window.location.origin) {
      return { ok: false, errorCode: 'script-fetch-failed' };
    }

    return { ok: true };
  } catch {
    return { ok: false, errorCode: 'script-fetch-failed' };
  } finally {
    clearTimeout(timeout);
  }
}

function classifyServiceWorkerRegistrationError(error: unknown): ServiceWorkerErrorCode {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('mime') || message.includes('content-type')) {
    return 'script-invalid-content-type';
  }
  if (message.includes('script')) {
    return 'script-fetch-failed';
  }
  return 'registration-failed';
}

export async function registerAppServiceWorker(): Promise<ServiceWorkerRegistrationState> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return { supported: false, registered: false, updateAvailable: false, errorCode: 'unsupported' };
  }

  // Skip SW registration in dev — the Vite dev server serves files in a way
  // that causes Chrome to receive a text/html response for the SW script fetch,
  // and dev builds don't benefit from caching anyway.
  if (import.meta.env.DEV) {
    return { supported: true, registered: false, updateAvailable: false };
  }

  if (!window.isSecureContext) {
    return { supported: true, registered: false, updateAvailable: false, errorCode: 'insecure-context' };
  }

  try {
    const swScope = deriveServiceWorkerScope();
    const swScriptUrl = buildServiceWorkerScriptUrl(undefined, swScope);
    const preflight = await preflightServiceWorkerScript(swScriptUrl);
    if (!preflight.ok) {
      console.warn('[SW] Registration skipped:', preflight.errorCode);
      return {
        supported: true,
        registered: false,
        updateAvailable: false,
        errorCode: preflight.errorCode,
      };
    }

    const reg = await navigator.serviceWorker.register(swScriptUrl, { scope: swScope, type: 'classic' });
    _registration = reg;

    reg.addEventListener('updatefound', () => {
      const incoming = reg.installing;
      if (!incoming) return;
      incoming.addEventListener('statechange', () => {
        if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
          _updateListeners.forEach((fn) => fn());
        }
      });
    });

    return { supported: true, registered: true, updateAvailable: false };
  } catch (err) {
    const errorCode = classifyServiceWorkerRegistrationError(err);
    console.warn('[SW] Registration failed:', errorCode);
    return { supported: true, registered: false, updateAvailable: false, errorCode };
  }
}

/** Tell the waiting service worker to take over immediately. */
export function activatePendingUpdate(): void {
  try {
    if (_registration?.waiting) {
      _registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  } catch {
    // Non-fatal.
  }
}

export function getServiceWorkerRegistration(): ServiceWorkerRegistration | null {
  return _registration;
}
