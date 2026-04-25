import {
  LocalGenerationSession,
  type GenerateTextRequest,
  type GenerateTextResult,
  type LocalTextGenerationConfig,
} from './generationSession';
import type {
  FunctionGemmaRouterRuntime,
  FunctionGemmaRouterRuntimeRequest,
} from './functionGemmaRouterInvoker';

export interface FunctionGemmaTextSession {
  load(signal?: AbortSignal): Promise<void>;
  generate(request: GenerateTextRequest): Promise<GenerateTextResult>;
  dispose?(): Promise<void> | void;
}

export interface FunctionGemmaLocalRouterRuntimeOptions {
  /**
   * Caller-owned model id or local model directory. Intentionally required so we
   * do not hardcode or silently download an unverified FunctionGemma artifact.
   */
  modelId: string;
  device?: LocalTextGenerationConfig['device'];
  localOnly?: boolean;
  loadTimeoutMs?: number;
  inferenceTimeoutMs?: number;
  quantized?: boolean;
  session?: FunctionGemmaTextSession;
  maxJsonChars?: number;
}

const DEFAULT_MAX_JSON_CHARS = 4096;
const LOAD_RETRY_BACKOFF_MS = 75;

export class FunctionGemmaLocalRouterRuntime implements FunctionGemmaRouterRuntime {
  readonly id = 'functiongemma_270m' as const;
  readonly available = true;

  private readonly session: FunctionGemmaTextSession;
  private readonly maxJsonChars: number;
  private loadPromise: Promise<void> | null = null;

  constructor(options: FunctionGemmaLocalRouterRuntimeOptions) {
    const modelId = sanitizeModelId(options.modelId);
    this.maxJsonChars = clampInteger(options.maxJsonChars, DEFAULT_MAX_JSON_CHARS, 512, 16_384);
    this.session = options.session ?? new LocalGenerationSession({
      modelId,
      label: 'FunctionGemma router',
      device: options.device,
      localOnly: options.localOnly ?? true,
      loadTimeoutMs: options.loadTimeoutMs,
      inferenceTimeoutMs: options.inferenceTimeoutMs,
      quantized: options.quantized,
    });
  }

  async route(request: FunctionGemmaRouterRuntimeRequest): Promise<unknown> {
    await this.ensureLoaded(request.signal);
    const prompt = buildRouterPrompt(request);
    const result = await this.session.generate({
      systemPrompt: request.systemPrompt,
      prompt,
      maxNewTokens: request.maxOutputTokens,
      temperature: request.temperature,
      topP: 1,
      signal: request.signal,
    });

    return parseRouterJson(result.text, this.maxJsonChars);
  }

  async dispose(): Promise<void> {
    this.loadPromise = null;
    await this.session.dispose?.();
  }

  private async ensureLoaded(signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (!this.loadPromise) {
      this.loadPromise = loadWithSingleRetry(this.session, signal).catch(async (error) => {
        this.loadPromise = null;
        try {
          await this.session.dispose?.();
        } catch {
          // Best-effort cleanup only. The original load error is the useful one.
        }
        throw error;
      });
    }
    await this.loadPromise;
    throwIfAborted(signal);
  }
}

export function createFunctionGemmaLocalRouterRuntime(
  options: FunctionGemmaLocalRouterRuntimeOptions,
): FunctionGemmaRouterRuntime {
  return new FunctionGemmaLocalRouterRuntime(options);
}

function buildRouterPrompt(request: FunctionGemmaRouterRuntimeRequest): string {
  const body = JSON.stringify({
    input: request.input,
    outputJsonSchema: request.outputJsonSchema,
  });

  return [
    'Route the following request. Return only a single JSON object matching outputJsonSchema.',
    body,
  ].join('\n\n');
}

async function loadWithSingleRetry(session: FunctionGemmaTextSession, signal: AbortSignal): Promise<void> {
  try {
    await session.load(signal);
  } catch (firstError) {
    throwIfAborted(signal);
    await delay(LOAD_RETRY_BACKOFF_MS, signal);
    try {
      await session.load(signal);
    } catch {
      throw firstError;
    }
  }
}

function parseRouterJson(text: string, maxJsonChars: number): unknown {
  const bounded = sanitizeModelText(text, maxJsonChars);
  const jsonText = extractFirstJsonObject(bounded);
  if (!jsonText) {
    throw new Error('FunctionGemma router did not return a JSON object.');
  }

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new Error('FunctionGemma router returned invalid JSON.', { cause: error });
  }
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
      if (depth < 0) return null;
    }
  }

  return null;
}

function sanitizeModelId(value: string): string {
  const modelId = value.trim();
  if (!modelId || modelId.length > 240) {
    throw new Error('FunctionGemma modelId must be a non-empty string under 240 characters.');
  }
  if (!/^[A-Za-z0-9._/@:-]+$/.test(modelId)) {
    throw new Error('FunctionGemma modelId contains unsupported characters.');
  }
  if (modelId.includes('..')) {
    throw new Error('FunctionGemma modelId must not contain parent-directory segments.');
  }
  return modelId;
}

function sanitizeModelText(value: string, maxLen: number): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  const normalized = Number.isFinite(value) ? Math.round(value as number) : fallback;
  return Math.max(min, Math.min(max, normalized));
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  throwIfAborted(signal);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  }
}
