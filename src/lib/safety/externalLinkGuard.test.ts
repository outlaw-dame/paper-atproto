import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./externalUrl', () => ({
  sanitizeExternalUrl: vi.fn((url: string) => url),
  openExternalUrl: vi.fn(async () => true),
}));

import { openExternalUrl, sanitizeExternalUrl } from './externalUrl';

class FakeElement {
  closest(_selector: string): FakeAnchor | null {
    return null;
  }
}

class FakeAnchor extends FakeElement {
  target = '_blank';

  constructor(public href: string) {
    super();
  }

  getAttribute(name: string): string | null {
    if (name === 'href') return this.href;
    return null;
  }
}

describe('externalLinkGuard', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    vi.stubGlobal('Element', FakeElement as unknown as typeof Element);
    vi.stubGlobal('HTMLAnchorElement', FakeAnchor as unknown as typeof HTMLAnchorElement);
  });

  it('installs the capture listener only once', async () => {
    const addEventListener = vi.fn();
    vi.stubGlobal('document', { addEventListener });

    const { installExternalLinkGuard } = await import('./externalLinkGuard');

    installExternalLinkGuard();
    installExternalLinkGuard();

    expect(addEventListener).toHaveBeenCalledTimes(3);
    expect(addEventListener).toHaveBeenCalledWith('click', expect.any(Function), true);
    expect(addEventListener).toHaveBeenCalledWith('auxclick', expect.any(Function), true);
    expect(addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);
  });

  it('intercepts target=_blank anchor clicks and routes through guarded opener', async () => {
    const addEventListener = vi.fn();
    vi.stubGlobal('document', { addEventListener });

    const { installExternalLinkGuard } = await import('./externalLinkGuard');
    installExternalLinkGuard();

    const anchor = new FakeAnchor('https://example.com/path');
    const target = new FakeElement();
    target.closest = vi.fn(() => anchor);

    const handler = addEventListener.mock.calls.find((call) => call[0] === 'click')?.[1] as
      | ((event: unknown) => void)
      | undefined;
    if (!handler) {
      throw new Error('click handler was not installed');
    }

    const preventDefault = vi.fn();
    handler({
      defaultPrevented: false,
      target,
      preventDefault,
    });

    expect(vi.mocked(sanitizeExternalUrl)).toHaveBeenCalledWith('https://example.com/path');
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(vi.mocked(openExternalUrl)).toHaveBeenCalledWith('https://example.com/path');
  });

  it('blocks malformed external urls before any open call', async () => {
    vi.mocked(sanitizeExternalUrl).mockReturnValueOnce(null);

    const addEventListener = vi.fn();
    vi.stubGlobal('document', { addEventListener });

    const { installExternalLinkGuard } = await import('./externalLinkGuard');
    installExternalLinkGuard();

    const anchor = new FakeAnchor('javascript:alert(1)');
    const target = new FakeElement();
    target.closest = vi.fn(() => anchor);

    const handler = addEventListener.mock.calls.find((call) => call[0] === 'click')?.[1] as
      | ((event: unknown) => void)
      | undefined;
    if (!handler) {
      throw new Error('click handler was not installed');
    }

    const preventDefault = vi.fn();
    handler({
      defaultPrevented: false,
      target,
      preventDefault,
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(vi.mocked(openExternalUrl)).not.toHaveBeenCalled();
  });

  it('intercepts middle-click activation through auxclick', async () => {
    const addEventListener = vi.fn();
    vi.stubGlobal('document', { addEventListener });

    const mouseEventCtor = function MouseEvent(this: unknown, _type: string, init?: { button?: number }) {
      Object.assign(this as object, init ?? {});
    } as unknown as typeof MouseEvent;
    vi.stubGlobal('MouseEvent', mouseEventCtor);

    const { installExternalLinkGuard } = await import('./externalLinkGuard');
    installExternalLinkGuard();

    const anchor = new FakeAnchor('https://example.com/path');
    const target = new FakeElement();
    target.closest = vi.fn(() => anchor);

    const handler = addEventListener.mock.calls.find((call) => call[0] === 'auxclick')?.[1] as
      | ((event: unknown) => void)
      | undefined;
    if (!handler) {
      throw new Error('auxclick handler was not installed');
    }

    const event = new (mouseEventCtor as any)('auxclick', { button: 1 });
    Object.assign(event, {
      defaultPrevented: false,
      target,
      preventDefault: vi.fn(),
    });

    handler(event);

    expect((event as { preventDefault: ReturnType<typeof vi.fn> }).preventDefault).toHaveBeenCalledTimes(1);
    expect(vi.mocked(openExternalUrl)).toHaveBeenCalledWith('https://example.com/path');
  });

  it('intercepts Enter-key activation on target=_blank links', async () => {
    const addEventListener = vi.fn();
    vi.stubGlobal('document', { addEventListener });

    const keyboardEventCtor = function KeyboardEvent(this: unknown, _type: string, init?: { key?: string }) {
      Object.assign(this as object, init ?? {});
    } as unknown as typeof KeyboardEvent;
    vi.stubGlobal('KeyboardEvent', keyboardEventCtor);

    const { installExternalLinkGuard } = await import('./externalLinkGuard');
    installExternalLinkGuard();

    const anchor = new FakeAnchor('https://example.com/path');
    const target = new FakeElement();
    target.closest = vi.fn(() => anchor);

    const handler = addEventListener.mock.calls.find((call) => call[0] === 'keydown')?.[1] as
      | ((event: unknown) => void)
      | undefined;
    if (!handler) {
      throw new Error('keydown handler was not installed');
    }

    const event = new (keyboardEventCtor as any)('keydown', { key: 'Enter' });
    Object.assign(event, {
      defaultPrevented: false,
      target,
      preventDefault: vi.fn(),
    });

    handler(event);

    expect((event as { preventDefault: ReturnType<typeof vi.fn> }).preventDefault).toHaveBeenCalledTimes(1);
    expect(vi.mocked(openExternalUrl)).toHaveBeenCalledWith('https://example.com/path');
  });

  it('does not intercept links that do not target a new tab', async () => {
    const addEventListener = vi.fn();
    vi.stubGlobal('document', { addEventListener });

    const { installExternalLinkGuard } = await import('./externalLinkGuard');
    installExternalLinkGuard();

    const anchor = new FakeAnchor('https://example.com/path');
    anchor.target = '_self';

    const target = new FakeElement();
    target.closest = vi.fn(() => anchor);

    const handler = addEventListener.mock.calls.find((call) => call[0] === 'click')?.[1] as
      | ((event: unknown) => void)
      | undefined;
    if (!handler) {
      throw new Error('click handler was not installed');
    }

    const preventDefault = vi.fn();
    handler({
      defaultPrevented: false,
      target,
      preventDefault,
    });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(vi.mocked(openExternalUrl)).not.toHaveBeenCalled();
  });

  it('does nothing for already-prevented click events', async () => {
    const addEventListener = vi.fn();
    vi.stubGlobal('document', { addEventListener });

    const { installExternalLinkGuard } = await import('./externalLinkGuard');
    installExternalLinkGuard();

    const handler = addEventListener.mock.calls.find((call) => call[0] === 'click')?.[1] as
      | ((event: unknown) => void)
      | undefined;
    if (!handler) {
      throw new Error('click handler was not installed');
    }

    const preventDefault = vi.fn();
    handler({
      defaultPrevented: true,
      target: new FakeElement(),
      preventDefault,
    });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(vi.mocked(sanitizeExternalUrl)).not.toHaveBeenCalled();
    expect(vi.mocked(openExternalUrl)).not.toHaveBeenCalled();
  });
});
