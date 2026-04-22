export type RuntimeTier = 'high' | 'mid' | 'low';
export type BrowserFamily = 'chromium' | 'safari' | 'firefox' | 'unknown';

export type RuntimeCapability = {
  webgpu: boolean;
  tier: RuntimeTier;
  generationAllowed: boolean;
  multimodalAllowed: boolean;
  reason?: string;
  browserFamily?: BrowserFamily;
  deviceMemoryGiB?: number | null;
  hardwareConcurrency?: number | null;
  maxStorageBufferBindingSize?: number | null;
  warmupPassed?: boolean;
  modelWarmupPassed?: boolean;
};

export interface CapabilityProbeOptions {
  includeModelWarmup?: boolean;
  signal?: AbortSignal;
  smallModelWarmup?: () => Promise<boolean>;
}

const HIGH_DEVICE_MEMORY_GIB = 8;
const MID_DEVICE_MEMORY_GIB = 4;
const HIGH_CONCURRENCY = 8;
const MID_CONCURRENCY = 6;
const HIGH_STORAGE_BUFFER_BYTES = 512 * 1024 * 1024;
const MID_STORAGE_BUFFER_BYTES = 256 * 1024 * 1024;

type RuntimeHintSet = {
  browserFamily: BrowserFamily;
  deviceMemoryGiB: number | null;
  hardwareConcurrency: number | null;
  maxStorageBufferBindingSize: number | null;
};

type WebGpuWarmupResult = {
  ok: boolean;
  reason?: string;
  maxStorageBufferBindingSize?: number | null;
};

type NavigatorWithGpu = Navigator & {
  gpu?: {
    requestAdapter: (options?: { powerPreference?: 'high-performance' | 'low-power' }) => Promise<{
      requestDevice: () => Promise<{
        createBuffer: (options: { size: number; usage: number }) => { destroy: () => void };
        createCommandEncoder: () => { finish: () => unknown };
        queue: { submit: (commands: unknown[]) => void };
        limits?: { maxStorageBufferBindingSize?: number };
        destroy?: () => void;
      }>;
    } | null>;
  };
};

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  }
}

function getNavigatorHints(): RuntimeHintSet {
  if (typeof navigator === 'undefined') {
    return {
      browserFamily: 'unknown',
      deviceMemoryGiB: null,
      hardwareConcurrency: null,
      maxStorageBufferBindingSize: null,
    };
  }

  const browserFamily = detectBrowserFamily(
    navigator.userAgent,
    (navigator as Navigator & { userAgentData?: { brands?: Array<{ brand?: string }> } }).userAgentData?.brands,
  );

  const deviceMemoryGiB = (() => {
    const value = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? NaN);
    return Number.isFinite(value) && value > 0 ? value : null;
  })();

  const hardwareConcurrency = (() => {
    const value = Number(navigator.hardwareConcurrency ?? NaN);
    return Number.isFinite(value) && value > 0 ? value : null;
  })();

  return {
    browserFamily,
    deviceMemoryGiB,
    hardwareConcurrency,
    maxStorageBufferBindingSize: null,
  };
}

export function detectBrowserFamily(
  userAgent: string | undefined,
  brands?: Array<{ brand?: string }>,
): BrowserFamily {
  const brandText = Array.isArray(brands)
    ? brands
        .map((entry) => entry.brand?.toLowerCase?.() ?? '')
        .join(' ')
    : '';
  const ua = (userAgent ?? '').toLowerCase();

  if (/\bfirefox\b/.test(ua) || /\bfirefox\b/.test(brandText)) {
    return 'firefox';
  }

  const looksSafari = /\bsafari\b/.test(ua) && !/\bchrome\b|\bchromium\b|\bedg\//.test(ua);
  if (looksSafari || /\bsafari\b/.test(brandText)) {
    return 'safari';
  }

  if (
    /\bchrome\b|\bchromium\b|\bedg\//.test(ua)
    || /\bchrome\b|\bchromium\b|\bedge\b/.test(brandText)
  ) {
    return 'chromium';
  }

  return 'unknown';
}

export function classifyRuntimeTier(hints: RuntimeHintSet): RuntimeTier {
  const score =
    scoreDeviceMemory(hints.deviceMemoryGiB)
    + scoreConcurrency(hints.hardwareConcurrency)
    + scoreStorageBuffer(hints.maxStorageBufferBindingSize)
    + scoreBrowserFamily(hints.browserFamily);

  if (score >= 5) return 'high';
  if (score >= 2) return 'mid';
  return 'low';
}

function scoreDeviceMemory(deviceMemoryGiB: number | null): number {
  if (deviceMemoryGiB === null) return 0;
  if (deviceMemoryGiB >= HIGH_DEVICE_MEMORY_GIB) return 2;
  if (deviceMemoryGiB >= MID_DEVICE_MEMORY_GIB) return 1;
  return -1;
}

function scoreConcurrency(hardwareConcurrency: number | null): number {
  if (hardwareConcurrency === null) return 0;
  if (hardwareConcurrency >= HIGH_CONCURRENCY) return 2;
  if (hardwareConcurrency >= MID_CONCURRENCY) return 1;
  return -1;
}

function scoreStorageBuffer(maxStorageBufferBindingSize: number | null): number {
  if (maxStorageBufferBindingSize === null) return 0;
  if (maxStorageBufferBindingSize >= HIGH_STORAGE_BUFFER_BYTES) return 2;
  if (maxStorageBufferBindingSize >= MID_STORAGE_BUFFER_BYTES) return 1;
  return -1;
}

function scoreBrowserFamily(browserFamily: BrowserFamily): number {
  if (browserFamily === 'chromium') return 1;
  if (browserFamily === 'safari') return 0;
  if (browserFamily === 'firefox') return -2;
  return 0;
}

async function runWebGpuWarmup(signal?: AbortSignal): Promise<WebGpuWarmupResult> {
  aborted(signal);

  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return {
      ok: false,
      reason: 'WebGPU is unavailable in this browser.',
      maxStorageBufferBindingSize: null,
    };
  }

  try {
    const gpu = (navigator as NavigatorWithGpu).gpu;
    const adapter = await gpu?.requestAdapter({
      powerPreference: 'high-performance',
    });

    aborted(signal);

    if (!adapter) {
      return {
        ok: false,
        reason: 'WebGPU adapter allocation failed.',
        maxStorageBufferBindingSize: null,
      };
    }

    const device = await adapter.requestDevice();
    aborted(signal);

    const copyDstUsage = 0x0008;
    const buffer = device.createBuffer({
      size: 256,
      usage: copyDstUsage,
    });
    buffer.destroy();

    const encoder = device.createCommandEncoder();
    device.queue.submit([encoder.finish()]);

    const maxStorageBufferBindingSize =
      typeof device.limits?.maxStorageBufferBindingSize === 'number'
        ? device.limits.maxStorageBufferBindingSize
        : null;

    device.destroy?.();

    return {
      ok: true,
      maxStorageBufferBindingSize,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'WebGPU warmup failed.',
      maxStorageBufferBindingSize: null,
    };
  }
}

export async function probeRuntimeCapability(
  options: CapabilityProbeOptions = {},
): Promise<RuntimeCapability> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      webgpu: false,
      tier: 'low',
      generationAllowed: false,
      multimodalAllowed: false,
      reason: 'Browser runtime APIs are unavailable.',
    };
  }

  const hints = getNavigatorHints();
  if (!('gpu' in navigator)) {
    return {
      webgpu: false,
      tier: classifyRuntimeTier(hints),
      generationAllowed: false,
      multimodalAllowed: false,
      browserFamily: hints.browserFamily,
      deviceMemoryGiB: hints.deviceMemoryGiB,
      hardwareConcurrency: hints.hardwareConcurrency,
      reason: 'WebGPU is unavailable, so the worker-only hot path remains the default.',
    };
  }

  const warmup = await runWebGpuWarmup(options.signal);
  const tier = classifyRuntimeTier({
    ...hints,
    maxStorageBufferBindingSize: warmup.maxStorageBufferBindingSize ?? null,
  });

  if (!warmup.ok) {
    return {
      webgpu: true,
      tier,
      generationAllowed: false,
      multimodalAllowed: false,
      browserFamily: hints.browserFamily,
      deviceMemoryGiB: hints.deviceMemoryGiB,
      hardwareConcurrency: hints.hardwareConcurrency,
      maxStorageBufferBindingSize: warmup.maxStorageBufferBindingSize ?? null,
      warmupPassed: false,
      reason: warmup.reason ?? 'WebGPU warmup failed.',
    };
  }

  if (hints.browserFamily === 'firefox') {
    return {
      webgpu: true,
      tier,
      generationAllowed: false,
      multimodalAllowed: false,
      browserFamily: hints.browserFamily,
      deviceMemoryGiB: hints.deviceMemoryGiB,
      hardwareConcurrency: hints.hardwareConcurrency,
      maxStorageBufferBindingSize: warmup.maxStorageBufferBindingSize ?? null,
      warmupPassed: true,
      reason: 'Firefox WebGPU remains too uneven for premium local generation in this runtime.',
    };
  }

  let modelWarmupPassed: boolean | undefined;
  if (options.includeModelWarmup && options.smallModelWarmup) {
    try {
      aborted(options.signal);
      modelWarmupPassed = await options.smallModelWarmup();
    } catch {
      modelWarmupPassed = false;
    }
  }

  const warmupNote =
    hints.browserFamily === 'safari'
      ? 'Safari passed the probe, but heavy models should stay on-demand.'
      : 'WebGPU warmup passed.';

  const modelWarmupNote = modelWarmupPassed === false
    ? ' A small model warmup failed, so premium local generation is disabled for this session.'
    : '';

  const generationAllowed = modelWarmupPassed === false ? false : true;
  const multimodalAllowed = modelWarmupPassed === false ? false : true;

  return {
    webgpu: true,
    tier,
    generationAllowed,
    multimodalAllowed,
    browserFamily: hints.browserFamily,
    deviceMemoryGiB: hints.deviceMemoryGiB,
    hardwareConcurrency: hints.hardwareConcurrency,
    maxStorageBufferBindingSize: warmup.maxStorageBufferBindingSize ?? null,
    warmupPassed: true,
    ...(typeof modelWarmupPassed === 'boolean' ? { modelWarmupPassed } : {}),
    reason: `${warmupNote}${modelWarmupNote}`.trim(),
  };
}
