import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function stubSafeWindow() {
  const open = vi.fn();
  vi.stubGlobal('window', {
    open,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      result: {
        url: 'https://example.com/path',
        checked: true,
        status: 'safe',
        safe: true,
        blocked: false,
        threats: [],
      },
    }),
  })));
  return open;
}

async function flushGuardOpen(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
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

    expect(addEventListener).toHaveBeenCalledWith('click', expect.any(Function), true);
    expect(addEventListener).toHaveBeenCalledWith('auxclick', expect.any(Function), true);
    expect(addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    expect(addEventListener).toHaveBeenCalledTimes(3);
  });

  it('intercepts target=_blank anchor clicks and routes through guarded opener', async () => {
    const addEventListener = vi.fn();
    const open = stubSafeWindow();
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
    await flushGuardOpen();

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://example.com/path', '_blank', 'noopener,noreferrer');
  });

  it('blocks malformed external urls before any open call', async () => {
    const addEventListener = vi.fn();
    const open = stubSafeWindow();
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
    await flushGuardOpen();

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it('intercepts middle-click activation through auxclick', async () => {
    const addEventListener = vi.fn();
    const open = stubSafeWindow();
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
    await flushGuardOpen();

    expect((event as { preventDefault: ReturnType<typeof vi.fn> }).preventDefault).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://example.com/path', '_blank', 'noopener,noreferrer');
  });

  it('intercepts Enter-key activation on target=_blank links', async () => {
    const addEventListener = vi.fn();
    const open = stubSafeWindow();
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
    await flushGuardOpen();

    expect((event as { preventDefault: ReturnType<typeof vi.fn> }).preventDefault).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://example.com/path', '_blank', 'noopener,noreferrer');
  });

  it('does not intercept links that do not target a new tab', async () => {
    const addEventListener = vi.fn();
    const open = stubSafeWindow();
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
    expect(open).not.toHaveBeenCalled();
  });

  it('does nothing for already-prevented click events', async () => {
    const addEventListener = vi.fn();
    const open = stubSafeWindow();
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
    expect(open).not.toHaveBeenCalled();
  });
});
