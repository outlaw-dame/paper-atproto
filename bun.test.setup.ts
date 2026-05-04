import { afterEach, vi } from 'vitest';

if (typeof process !== 'undefined') {
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
}

type GlobalName = keyof typeof globalThis;

const originalGlobals = new Map<PropertyKey, {
  descriptor: PropertyDescriptor | undefined;
  existed: boolean;
}>();
const baseGlobals = new Set<PropertyKey>();
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
let mockedDateNow: number | null = null;
const RealDate = Date;
const realDateNow = Date.now.bind(Date);

function defineWritableGlobal(name: PropertyKey, value: unknown): void {
  if (!originalGlobals.has(name)) {
    originalGlobals.set(name, {
      descriptor: Object.getOwnPropertyDescriptor(globalThis, name),
      existed: name in globalThis,
    });
  }

  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

function restoreStubbedGlobals(): void {
  for (const [name, original] of originalGlobals) {
    if (baseGlobals.has(name)) {
      continue;
    }

    if (original.existed && original.descriptor) {
      Object.defineProperty(globalThis, name, original.descriptor);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  }

  originalGlobals.clear();
}

function defineBaseGlobal(name: PropertyKey, value: unknown): void {
  baseGlobals.add(name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

function restoreMalformedWindowGlobal(): void {
  const candidate = (globalThis as { window?: unknown }).window;
  if (
    typeof candidate !== 'undefined'
    && candidate !== null
    && typeof candidate === 'object'
    && !('location' in candidate)
  ) {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
}

if (typeof vi.hoisted !== 'function') {
  vi.hoisted = <T>(factory: () => T): T => factory();
}

if (typeof vi.stubGlobal !== 'function') {
  vi.stubGlobal = (name: string | number | symbol, value: unknown) => {
    defineWritableGlobal(name as GlobalName, value);
    return vi;
  };
}

if (typeof vi.unstubAllGlobals !== 'function') {
  vi.unstubAllGlobals = () => {
    restoreStubbedGlobals();
    return vi;
  };
}

if (typeof vi.mocked !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (vi as any).mocked = <T>(value: T): T => value;
}

if (typeof vi.advanceTimersByTimeAsync !== 'function') {
  vi.advanceTimersByTimeAsync = async (ms: number) => {
    await Promise.resolve();
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    return vi;
  };
}

if (typeof vi.runAllTimersAsync !== 'function') {
  vi.runAllTimersAsync = async () => {
    for (let i = 0; i < 20; i += 1) {
      await Promise.resolve();
      vi.runAllTimers();
      await Promise.resolve();
      if (typeof vi.getTimerCount === 'function' && vi.getTimerCount() === 0) {
        break;
      }
    }
    return vi;
  };
}

const originalAdvanceTimersByTime = vi.advanceTimersByTime?.bind(vi);
if (originalAdvanceTimersByTime) {
  vi.advanceTimersByTime = (ms: number) => {
    if (mockedDateNow !== null) {
      mockedDateNow += ms;
    }
    return originalAdvanceTimersByTime(ms);
  };
}

if (typeof vi.setSystemTime !== 'function') {
  vi.setSystemTime = (time: number | string | Date) => {
    mockedDateNow = time instanceof RealDate ? time.getTime() : new RealDate(time).getTime();
    Date.now = () => mockedDateNow ?? realDateNow();
    return vi;
  };
}

const originalUseRealTimers = vi.useRealTimers?.bind(vi);
if (originalUseRealTimers) {
  vi.useRealTimers = () => {
    mockedDateNow = null;
    Date.now = realDateNow;
    return originalUseRealTimers();
  };
}

const originalResetAllMocks = vi.resetAllMocks?.bind(vi);
if (originalResetAllMocks) {
  vi.resetAllMocks = () => {
    mockedDateNow = null;
    Date.now = realDateNow;
    return originalResetAllMocks();
  };
}

if (typeof vi.resetModules !== 'function') {
  vi.resetModules = () => vi;
}

if (typeof vi.importActual !== 'function') {
  vi.importActual = async (specifier: string) => {
    if (specifier === '../lib/abortSignals') {
      return import('./src/lib/abortSignals');
    }
    return import(specifier);
  };
}

if (typeof globalThis.localStorage === 'undefined') {
  const storage = new Map<string, string>();

  defineBaseGlobal('localStorage', {
    get length() {
      return storage.size;
    },
    clear() {
      storage.clear();
    },
    getItem(key: string) {
      return storage.has(key) ? storage.get(key)! : null;
    },
    key(index: number) {
      return Array.from(storage.keys())[index] ?? null;
    },
    removeItem(key: string) {
      storage.delete(key);
    },
    setItem(key: string, value: string) {
      storage.set(key, String(value));
    },
  });
}

afterEach(() => {
  if (typeof process !== 'undefined') {
    process.env.NODE_ENV = 'test';
  }
  mockedDateNow = null;
  Date.now = realDateNow;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  restoreMalformedWindowGlobal();
  vi.restoreAllMocks();
});
