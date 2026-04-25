import type { CoordinationContract } from './routerCoordinatorContract';
import { evaluateRouterPromptOutput, type RouterExecutionResult } from './routerExecutionAdapter';
import {
  functionGemmaRouterPromptV1,
  type RouterPromptInput,
  type RouterPromptOutput,
} from './prompts';

export type FunctionGemmaRouterInvocationStatus =
  | 'accepted'
  | 'fallback'
  | 'unavailable'
  | 'timed_out'
  | 'aborted'
  | 'runtime_error';

export interface FunctionGemmaRouterRuntimeRequest {
  systemPrompt: string;
  input: RouterPromptInput;
  outputJsonSchema: typeof functionGemmaRouterPromptV1.outputJsonSchema;
  maxInputTokens: number;
  maxOutputTokens: number;
  temperature: 0;
  signal: AbortSignal;
}

export interface FunctionGemmaRouterRuntime {
  readonly id: 'functiongemma_270m';
  readonly available: boolean;
  route(request: FunctionGemmaRouterRuntimeRequest): Promise<unknown>;
}

export interface FunctionGemmaRouterInvocationResult {
  schemaVersion: 1;
  status: FunctionGemmaRouterInvocationStatus;
  execution: RouterExecutionResult;
  diagnostics: {
    promptId: typeof functionGemmaRouterPromptV1.id;
    promptVersion: typeof functionGemmaRouterPromptV1.version;
    runtimeAvailable: boolean;
    timedOut: boolean;
    aborted: boolean;
    durationMs: number;
  };
}

export interface InvokeFunctionGemmaRouterOptions {
  contract: CoordinationContract;
  contractId: string;
  promptInput: RouterPromptInput;
  runtime: FunctionGemmaRouterRuntime | null;
  timeoutMs?: number;
  nowEpochMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_ROUTER_TIMEOUT_MS = 2_000;

function createTimeoutController(timeoutMs: number, outerSignal?: AbortSignal): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort('timeout'), Math.max(1, timeoutMs));
  const abortFromOuter = () => controller.abort(outerSignal?.reason ?? 'aborted');

  if (outerSignal) {
    if (outerSignal.aborted) abortFromOuter();
    else outerSignal.addEventListener('abort', abortFromOuter, { once: true });
  }

  return {
    controller,
    cleanup: () => {
      window.clearTimeout(timeout);
      outerSignal?.removeEventListener('abort', abortFromOuter);
    },
  };
}

function fallbackExecution(params: {
  contract: CoordinationContract;
  contractId: string;
  nowEpochMs?: number;
}): RouterExecutionResult {
  return evaluateRouterPromptOutput({
    contract: params.contract,
    contractId: params.contractId,
    output: null,
    nowEpochMs: params.nowEpochMs,
  });
}

function statusFromExecution(execution: RouterExecutionResult): FunctionGemmaRouterInvocationStatus {
  return execution.status === 'accepted' ? 'accepted' : 'fallback';
}

export async function invokeFunctionGemmaRouter(
  options: InvokeFunctionGemmaRouterOptions,
): Promise<FunctionGemmaRouterInvocationResult> {
  const startedAt = Date.now();

  if (!options.runtime?.available) {
    const execution = fallbackExecution({
      contract: options.contract,
      contractId: options.contractId,
      nowEpochMs: options.nowEpochMs,
    });
    return {
      schemaVersion: 1,
      status: 'unavailable',
      execution,
      diagnostics: {
        promptId: functionGemmaRouterPromptV1.id,
        promptVersion: functionGemmaRouterPromptV1.version,
        runtimeAvailable: false,
        timedOut: false,
        aborted: false,
        durationMs: Date.now() - startedAt,
      },
    };
  }

  const { controller, cleanup } = createTimeoutController(
    options.timeoutMs ?? DEFAULT_ROUTER_TIMEOUT_MS,
    options.signal,
  );

  try {
    const output = await options.runtime.route({
      systemPrompt: functionGemmaRouterPromptV1.system,
      input: functionGemmaRouterPromptV1.buildInput(options.promptInput),
      outputJsonSchema: functionGemmaRouterPromptV1.outputJsonSchema,
      maxInputTokens: functionGemmaRouterPromptV1.maxInputTokens,
      maxOutputTokens: functionGemmaRouterPromptV1.maxOutputTokens,
      temperature: functionGemmaRouterPromptV1.temperature,
      signal: controller.signal,
    });
    const execution = evaluateRouterPromptOutput({
      contract: options.contract,
      contractId: options.contractId,
      output: output as RouterPromptOutput,
      nowEpochMs: options.nowEpochMs,
    });

    return {
      schemaVersion: 1,
      status: statusFromExecution(execution),
      execution,
      diagnostics: {
        promptId: functionGemmaRouterPromptV1.id,
        promptVersion: functionGemmaRouterPromptV1.version,
        runtimeAvailable: true,
        timedOut: false,
        aborted: false,
        durationMs: Date.now() - startedAt,
      },
    };
  } catch (error) {
    const aborted = controller.signal.aborted || options.signal?.aborted === true;
    const timedOut = controller.signal.reason === 'timeout';
    const execution = fallbackExecution({
      contract: options.contract,
      contractId: options.contractId,
      nowEpochMs: options.nowEpochMs,
    });

    return {
      schemaVersion: 1,
      status: timedOut ? 'timed_out' : aborted ? 'aborted' : 'runtime_error',
      execution,
      diagnostics: {
        promptId: functionGemmaRouterPromptV1.id,
        promptVersion: functionGemmaRouterPromptV1.version,
        runtimeAvailable: true,
        timedOut,
        aborted,
        durationMs: Date.now() - startedAt,
      },
    };
  } finally {
    cleanup();
  }
}
