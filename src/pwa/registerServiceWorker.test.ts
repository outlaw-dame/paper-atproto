import { describe, expect, it } from 'vitest';
import {
  buildServiceWorkerScriptUrl,
  deriveServiceWorkerScope,
  hasSupportedServiceWorkerContentType,
  normalizeServiceWorkerBasePath,
} from './registerServiceWorker.js';

describe('registerServiceWorker helpers', () => {
  it('normalizes configured base paths into safe app scopes', () => {
    expect(normalizeServiceWorkerBasePath('/paper-atproto')).toBe('/paper-atproto/');
    expect(normalizeServiceWorkerBasePath('/paper-atproto/index.html')).toBe('/paper-atproto/');
    expect(normalizeServiceWorkerBasePath('paper-atproto')).toBe('/paper-atproto/');
  });

  it('prefers the configured base when the runtime URL lives under it', () => {
    expect(deriveServiceWorkerScope('https://example.com/paper-atproto/', '/paper-atproto/')).toBe('/paper-atproto/');
    expect(deriveServiceWorkerScope('https://example.com/paper-atproto/index.html', '/paper-atproto/')).toBe('/paper-atproto/');
  });

  it('falls back to the runtime deployment path when the configured base does not match', () => {
    expect(deriveServiceWorkerScope('https://example.com/', '/paper-atproto/')).toBe('/');
    expect(buildServiceWorkerScriptUrl('https://example.com/', '/paper-atproto/')).toBe('https://example.com/sw.js');
  });

  it('accepts javascript service worker MIME types and rejects html responses', () => {
    expect(hasSupportedServiceWorkerContentType('application/javascript; charset=utf-8')).toBe(true);
    expect(hasSupportedServiceWorkerContentType('text/javascript')).toBe(true);
    expect(hasSupportedServiceWorkerContentType(undefined)).toBe(true);
    expect(hasSupportedServiceWorkerContentType('text/html; charset=utf-8')).toBe(false);
    expect(hasSupportedServiceWorkerContentType('text/plain')).toBe(false);
  });
});
