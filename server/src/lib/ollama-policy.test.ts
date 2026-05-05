import { beforeEach, describe, expect, it, vi } from 'vitest';

const { envMock } = vi.hoisted(() => ({
  envMock: {
    OLLAMA_BASE_URL: 'http://localhost:11434',
    LLM_LOCAL_ONLY: true,
    LLM_ENABLED: true,
    LLM_STARTUP_CHECK: true,
    LLM_STARTUP_FAIL_CLOSED: false,
    LLM_STARTUP_TIMEOUT_MS: 2_000,
    QWEN_WRITER_MODEL: 'phi4-mini:latest',
    GEMMA_WRITER_MODELS: '',
    QWEN_MULTIMODAL_MODEL: 'qwen3-vl:4b-instruct-q4_K_M',
    QWEN_WRITER_MODEL_DIGEST: undefined,
    GEMMA_WRITER_MODEL_DIGESTS: undefined,
    QWEN_MULTIMODAL_MODEL_DIGEST: undefined,
  },
}));

vi.mock('../config/env.js', () => ({
  env: envMock,
}));

describe('ollama policy', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    envMock.OLLAMA_BASE_URL = 'http://localhost:11434';
    envMock.LLM_LOCAL_ONLY = true;
    envMock.LLM_ENABLED = true;
    envMock.LLM_STARTUP_CHECK = true;
    envMock.QWEN_WRITER_MODEL_DIGEST = undefined;
    envMock.GEMMA_WRITER_MODELS = '';
    envMock.GEMMA_WRITER_MODEL_DIGESTS = undefined;
    envMock.QWEN_MULTIMODAL_MODEL_DIGEST = undefined;
  });

  it('rejects remote ollama host when local-only policy is enabled', async () => {
    envMock.OLLAMA_BASE_URL = 'https://ollama.example.com';
    const { assertOllamaLocalUrlPolicy } = await import('./ollama-policy.js');

    expect(() => assertOllamaLocalUrlPolicy()).toThrow(/localhost\/loopback/);
  });

  it('passes startup checks when required models are present', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn(async () => ({
        models: [
          { name: 'phi4-mini:latest', digest: 'sha256:a' },
          { name: 'qwen3-vl:4b-instruct-q4_K_M', digest: 'sha256:b' },
        ],
      })),
    });

    const { runOllamaStartupChecks } = await import('./ollama-policy.js');
    await expect(runOllamaStartupChecks(fetchMock as unknown as typeof fetch)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails startup checks when required model is missing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn(async () => ({
        models: [{ name: 'phi4-mini:latest' }],
      })),
    });

    const { runOllamaStartupChecks } = await import('./ollama-policy.js');
    await expect(runOllamaStartupChecks(fetchMock as unknown as typeof fetch))
      .rejects
      .toThrow(/QWEN_MULTIMODAL_MODEL/);
  });

  it('checks configured Gemma writer models when present', async () => {
    envMock.GEMMA_WRITER_MODELS = 'gemma4:e2b,gemma4:e4b';
    envMock.GEMMA_WRITER_MODEL_DIGESTS = 'gemma4:e2b=sha256:c,gemma4:e4b=sha256:d';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn(async () => ({
        models: [
          { name: 'phi4-mini:latest', digest: 'sha256:a' },
          { name: 'qwen3-vl:4b-instruct-q4_K_M', digest: 'sha256:b' },
          { name: 'gemma4:e2b', digest: 'sha256:c' },
          { name: 'gemma4:e4b', digest: 'sha256:d' },
        ],
      })),
    });

    const { runOllamaStartupChecks } = await import('./ollama-policy.js');
    await expect(runOllamaStartupChecks(fetchMock as unknown as typeof fetch)).resolves.toBeUndefined();
  });
});