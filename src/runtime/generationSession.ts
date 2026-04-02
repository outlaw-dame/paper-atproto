import { assertLocalModelIntegrity } from './modelIntegrity';
import {
  finalizeLocalTextGenerationResult,
  prepareLocalTextGenerationRequest,
} from './localPolicyGateway';

/**
 * Pre-initialize ONNX Runtime configuration to prevent "registerBackend" errors
 * Should be called early in app bootstrap before async transformers imports
 */
export async function preConfigureOnnxRuntime(): Promise<void> {
  try {
    const transformers = await import('@xenova/transformers');
    configureTransformersRuntime(transformers.env, false);
    // Mark that ONNX has been pre-configured
    console.debug('[ONNX] Runtime pre-configured successfully');
  } catch (err) {
    // Silently handle configuration failures - transformers may not be used
    if (err instanceof Error) {
      console.debug('[ONNX] Pre-configuration skipped:', err.message);
    }
  }
}

export interface GenerateTextRequest {
  prompt: string;
  systemPrompt?: string;
  maxNewTokens?: number;
  temperature?: number;
  topP?: number;
  signal?: AbortSignal;
}

export interface GenerateTextResult {
  text: string;
  tokensGenerated?: number;
}

export interface LocalTextGenerationConfig {
  modelId: string;
  label: string;
  device?: 'webgpu' | 'wasm';
  localOnly?: boolean;
  loadTimeoutMs?: number;
  inferenceTimeoutMs?: number;
  quantized?: boolean;
}

type TransformersTextPipeline = {
  (input: string, options?: Record<string, unknown>): Promise<unknown>;
  dispose?: () => Promise<void> | void;
};

type TransformersModule = {
  env: Record<string, any>;
  pipeline: (
    task: 'text-generation',
    modelId: string,
    options?: Record<string, unknown>,
  ) => Promise<TransformersTextPipeline>;
};

const DEFAULT_LOAD_TIMEOUT_MS = 30_000;
const DEFAULT_INFERENCE_TIMEOUT_MS = 45_000;

export class LocalGenerationSession {
  private pipelineInstance: TransformersTextPipeline | null = null;

  constructor(private readonly config: LocalTextGenerationConfig) {}

  async load(signal?: AbortSignal): Promise<void> {
    if (this.pipelineInstance) return;

    const transformers = await import('@xenova/transformers') as TransformersModule;
    configureTransformersRuntime(transformers.env, this.config.localOnly === true);

    if (this.config.localOnly === true) {
      await assertLocalModelIntegrity(this.config.modelId, { basePath: '/models' });
    }

    this.pipelineInstance = await withTimeout(
      transformers.pipeline('text-generation', this.config.modelId, {
        ...(this.config.device === 'webgpu'
          ? {
              device: 'webgpu',
              dtype: 'q4f16',
            }
          : {}),
        ...(this.config.quantized === false ? {} : { quantized: true }),
      }),
      this.config.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS,
      `${this.config.label} load timed out`,
      signal,
    );
  }

  async generate(request: GenerateTextRequest): Promise<GenerateTextResult> {
    if (!this.pipelineInstance) {
      throw new Error(`${this.config.label} is not loaded.`);
    }

    const policySafeRequest = prepareLocalTextGenerationRequest(request);
    const prompt = buildPrompt(policySafeRequest.systemPrompt, policySafeRequest.prompt);
    const response = await withTimeout(
      this.pipelineInstance(prompt, {
        max_new_tokens: clampInteger(policySafeRequest.maxNewTokens, 48, 16, 256),
        temperature: clampNumber(policySafeRequest.temperature, 0.4, 0, 1.5),
        top_p: clampNumber(policySafeRequest.topP, 0.92, 0.05, 1),
        do_sample: clampNumber(policySafeRequest.temperature, 0.4, 0, 1.5) > 0,
        return_full_text: false,
      }),
      this.config.inferenceTimeoutMs ?? DEFAULT_INFERENCE_TIMEOUT_MS,
      `${this.config.label} inference timed out`,
      policySafeRequest.signal,
    );

    return finalizeLocalTextGenerationResult(normalizeGenerationResponse(response));
  }

  async dispose(): Promise<void> {
    if (!this.pipelineInstance) return;

    try {
      await this.pipelineInstance.dispose?.();
    } finally {
      this.pipelineInstance = null;
    }
  }
}

function configureTransformersRuntime(env: Record<string, any>, localOnly: boolean): void {
  env.localModelPath = '/models/';
  env.allowLocalModels = true;
  env.backends ??= {};
  env.backends.onnx ??= {};
  env.backends.onnx.wasm ??= {};
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
  if ('allowRemoteModels' in env) {
    env.allowRemoteModels = localOnly ? false : env.allowRemoteModels;
  }
}

function buildPrompt(systemPrompt: string | undefined, prompt: string): string {
  const cleanPrompt = sanitizeGeneratedText(prompt, 4000);
  if (!cleanPrompt) {
    throw new Error('Prompt must not be empty.');
  }

  const cleanSystem = sanitizeGeneratedText(systemPrompt ?? '', 1200);
  if (!cleanSystem) return cleanPrompt;

  return `System: ${cleanSystem}\n\nUser: ${cleanPrompt}\n\nAssistant:`;
}

function normalizeGenerationResponse(response: unknown): GenerateTextResult {
  const candidates = Array.isArray(response) ? response : [response];
  const generated = candidates.find((candidate) => {
    if (typeof candidate === 'string') return true;
    if (candidate && typeof candidate === 'object' && typeof (candidate as Record<string, unknown>).generated_text === 'string') {
      return true;
    }
    return false;
  });

  const rawText = typeof generated === 'string'
    ? generated
    : typeof generated === 'object' && generated !== null
      ? String((generated as Record<string, unknown>).generated_text ?? '')
      : '';

  const text = sanitizeGeneratedText(rawText, 2000);
  if (!text) {
    throw new Error('Generation returned an empty response.');
  }

  return { text };
}

function sanitizeGeneratedText(value: string, maxLen: number): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  const normalized = Number.isFinite(value) ? Math.round(value as number) : fallback;
  return Math.max(min, Math.min(max, normalized));
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  const normalized = Number.isFinite(value) ? Number(value) : fallback;
  return Math.max(min, Math.min(max, normalized));
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  signal?: AbortSignal,
): Promise<T> {
  let timeoutId: number | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  const abortPromise = new Promise<T>((_, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    signal.addEventListener('abort', () => {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

  try {
    return await Promise.race(signal ? [promise, timeoutPromise, abortPromise] : [promise, timeoutPromise]);
  } finally {
    if (typeof timeoutId === 'number') {
      window.clearTimeout(timeoutId);
    }
  }
}
