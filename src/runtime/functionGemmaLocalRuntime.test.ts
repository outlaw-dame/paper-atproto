import { describe, expect, it, vi } from 'vitest';
import type { FunctionGemmaRouterRuntimeRequest } from './functionGemmaRouterInvoker';
import {
  FunctionGemmaLocalRouterRuntime,
  type FunctionGemmaTextSession,
} from './functionGemmaLocalRuntime';
import { functionGemmaRouterPromptV1, type RouterPromptInput } from './prompts';

function request(overrides: Partial<FunctionGemmaRouterRuntimeRequest> = {}): FunctionGemmaRouterRuntimeRequest {
  return {
    systemPrompt: functionGemmaRouterPromptV1.system,
    input: {
      contractId: 'contract:test',
      contract: {
        schemaVersion: 1,
        contractId: 'contract:test',
        generatedAtEpochMs: 1_000,
        expiresAtEpochMs: 2_000,
        allowedRoutes: [
          {
            routeId: 'model:test',
            allowed: true,
            priority: 1,
            runtime: 'local_transformers_js',
            modelId: 'test-model',
            reasonCodes: ['policy_selected_primary'],
          },
        ],
        defaultRouteId: 'model:test',
        safetyGates: [],
      },
      taskSummary: 'Route a test job.',
      userVisibleIntent: 'Test routing.',
      inputStats: {
        textLength: 10,
        estimatedPromptTokens: 8,
        hasImages: false,
        hasLinks: false,
        hasCode: false,
        hasSensitiveLocalData: false,
      },
      runtimeHealth: {
        batterySaver: false,
        thermalState: 'nominal',
        sustainedLatencyMs: null,
        storageAvailableGiB: 8,
      },
    } as RouterPromptInput,
    outputJsonSchema: functionGemmaRouterPromptV1.outputJsonSchema,
    maxInputTokens: 1024,
    maxOutputTokens: 128,
    temperature: 0,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function sessionReturning(text: string): FunctionGemmaTextSession & {
  load: ReturnType<typeof vi.fn>;
  generate: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  return {
    load: vi.fn(async () => undefined),
    generate: vi.fn(async () => ({ text })),
    dispose: vi.fn(async () => undefined),
  };
}

describe('FunctionGemmaLocalRouterRuntime', () => {
  it('loads lazily and parses the first valid JSON object from generated text', async () => {
    const session = sessionReturning(
      'preface {"schemaVersion":1,"selectedRouteId":"model:test","reasonCodes":["policy_selected_primary"]} trailing text',
    );
    const runtime = new FunctionGemmaLocalRouterRuntime({ modelId: 'local/functiongemma-router', session });

    const output = await runtime.route(request());

    expect(output).toEqual({
      schemaVersion: 1,
      selectedRouteId: 'model:test',
      reasonCodes: ['policy_selected_primary'],
    });
    expect(session.load).toHaveBeenCalledTimes(1);
    expect(session.generate).toHaveBeenCalledTimes(1);
    expect(session.generate.mock.calls[0]?.[0]).toMatchObject({
      systemPrompt: functionGemmaRouterPromptV1.system,
      maxNewTokens: 128,
      temperature: 0,
      topP: 1,
    });
    expect(String(session.generate.mock.calls[0]?.[0]?.prompt)).toContain('outputJsonSchema');
  });

  it('shares a single in-flight load across concurrent route calls', async () => {
    let resolveLoad: (() => void) | undefined;
    const session = sessionReturning('{"schemaVersion":1}');
    session.load.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const runtime = new FunctionGemmaLocalRouterRuntime({ modelId: 'local/functiongemma-router', session });

    const first = runtime.route(request());
    const second = runtime.route(request());

    expect(session.load).toHaveBeenCalledTimes(1);
    resolveLoad?.();

    await expect(first).resolves.toEqual({ schemaVersion: 1 });
    await expect(second).resolves.toEqual({ schemaVersion: 1 });
    expect(session.generate).toHaveBeenCalledTimes(2);
  });

  it('retries load once after a transient load failure', async () => {
    const session = sessionReturning('{"schemaVersion":1}');
    session.load
      .mockRejectedValueOnce(new Error('transient load failure'))
      .mockResolvedValueOnce(undefined);
    const runtime = new FunctionGemmaLocalRouterRuntime({ modelId: 'local/functiongemma-router', session });

    await expect(runtime.route(request())).resolves.toEqual({ schemaVersion: 1 });

    expect(session.load).toHaveBeenCalledTimes(2);
    expect(session.generate).toHaveBeenCalledTimes(1);
  });

  it('cleans up and lets a later call retry after repeated load failure', async () => {
    const session = sessionReturning('{"schemaVersion":1}');
    const firstError = new Error('first load failure');
    session.load
      .mockRejectedValueOnce(firstError)
      .mockRejectedValueOnce(new Error('second load failure'))
      .mockResolvedValueOnce(undefined);
    const runtime = new FunctionGemmaLocalRouterRuntime({ modelId: 'local/functiongemma-router', session });

    await expect(runtime.route(request())).rejects.toBe(firstError);
    await expect(runtime.route(request())).resolves.toEqual({ schemaVersion: 1 });

    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(session.load).toHaveBeenCalledTimes(3);
  });

  it('throws on non-JSON model output so the invoker can fall back safely', async () => {
    const session = sessionReturning('I refuse to return JSON.');
    const runtime = new FunctionGemmaLocalRouterRuntime({ modelId: 'local/functiongemma-router', session });

    await expect(runtime.route(request())).rejects.toThrow('did not return a JSON object');
  });

  it('throws on malformed JSON so the invoker can fall back safely', async () => {
    const session = sessionReturning('{"schemaVersion":');
    const runtime = new FunctionGemmaLocalRouterRuntime({ modelId: 'local/functiongemma-router', session });

    await expect(runtime.route(request())).rejects.toThrow('did not return a JSON object');
  });

  it('rejects unsafe model ids before creating a session', () => {
    expect(() => new FunctionGemmaLocalRouterRuntime({ modelId: '../escape' })).toThrow('parent-directory');
    expect(() => new FunctionGemmaLocalRouterRuntime({ modelId: 'bad model id' })).toThrow('unsupported characters');
    expect(() => new FunctionGemmaLocalRouterRuntime({ modelId: '' })).toThrow('non-empty');
  });

  it('propagates aborts before load/generation', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('Aborted', 'AbortError'));
    const session = sessionReturning('{"schemaVersion":1}');
    const runtime = new FunctionGemmaLocalRouterRuntime({ modelId: 'local/functiongemma-router', session });

    await expect(runtime.route(request({ signal: controller.signal }))).rejects.toThrow('Aborted');
    expect(session.load).not.toHaveBeenCalled();
    expect(session.generate).not.toHaveBeenCalled();
  });
});
