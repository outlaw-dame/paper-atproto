import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __internalProtocolHandler,
  consumePendingProtocolPayload,
  handleProtocolHandlerIfPresent,
} from './protocolHandler';

describe('protocolHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState(null, '', '/');
    consumePendingProtocolPayload();
  });

  it('parses DID profile payload', () => {
    const payload = __internalProtocolHandler.parseProtocolPayload('web+at://did:plc:abc123');
    expect(payload.type).toBe('profile');
    expect(payload.parsed.did).toBe('did:plc:abc123');
  });

  it('parses at:// post payload', () => {
    const payload = __internalProtocolHandler.parseProtocolPayload(
      'web+at://at://did:plc:abc123/app.bsky.feed.post/3kxy123',
    );
    expect(payload.type).toBe('post');
    expect(payload.parsed.atUri).toBe('at://did:plc:abc123/app.bsky.feed.post/3kxy123');
  });

  it('handles protocol URL, cleans route, and dispatches event', () => {
    const spy = vi.fn();
    window.addEventListener('paper:protocol-handler', spy);

    history.replaceState(
      null,
      '',
      '/paper-atproto/open?uri=web%2Bat%3A%2F%2Fdid%3Aplc%3Aabc123',
    );

    const payload = handleProtocolHandlerIfPresent();
    expect(payload?.type).toBe('profile');
    expect(window.location.pathname).toBe('/paper-atproto/');

    vi.runAllTimers();
    expect(spy).toHaveBeenCalled();

    const consumed = consumePendingProtocolPayload();
    expect(consumed?.parsed.did).toBe('did:plc:abc123');

    window.removeEventListener('paper:protocol-handler', spy);
  });

  it('returns null when path is not protocol handler route', () => {
    history.replaceState(null, '', '/paper-atproto/?uri=web%2Bat%3A%2F%2Fdid%3Aplc%3Aabc123');
    const payload = handleProtocolHandlerIfPresent();
    expect(payload).toBeNull();
  });

  it('sanitizes control characters from incoming URI', () => {
    const payload = __internalProtocolHandler.parseProtocolPayload('web+at://did:plc:abc\u0000\u0007xyz');
    expect(payload.parsed.did).toBe('did:plc:abcxyz');
  });
});
