import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consumePendingSharedPayload,
  handleShareTargetIfPresent,
} from './shareTarget';

describe('shareTarget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState(null, '', '/');
    consumePendingSharedPayload();
  });

  it('handles share-target payload, cleans route, and dispatches event', () => {
    const spy = vi.fn();
    window.addEventListener('paper:share-target', spy);

    history.replaceState(
      null,
      '',
      '/paper-atproto/share-target?title=Hello&text=World&url=https%3A%2F%2Fexample.com',
    );

    const payload = handleShareTargetIfPresent();
    expect(payload).toEqual({
      title: 'Hello',
      text: 'World',
      url: 'https://example.com',
    });
    expect(window.location.pathname).toBe('/paper-atproto/');

    vi.runAllTimers();
    expect(spy).toHaveBeenCalled();

    const consumed = consumePendingSharedPayload();
    expect(consumed?.title).toBe('Hello');

    window.removeEventListener('paper:share-target', spy);
  });

  it('returns null when path is not share-target route', () => {
    history.replaceState(
      null,
      '',
      '/paper-atproto/?title=Hello&text=World&url=https%3A%2F%2Fexample.com',
    );
    const payload = handleShareTargetIfPresent();
    expect(payload).toBeNull();
  });

  it('sanitizes control characters in shared input', () => {
    history.replaceState(
      null,
      '',
      '/paper-atproto/share-target?title=Hi%00There&text=%07Body&url=https%3A%2F%2Fexample.com',
    );

    const payload = handleShareTargetIfPresent();
    expect(payload).toEqual({
      title: 'HiThere',
      text: 'Body',
      url: 'https://example.com',
    });
  });
});
