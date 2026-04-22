import { env } from '../config/env.js';

type OllamaTag = {
  name?: string;
  model?: string;
  digest?: string;
  details?: {
    digest?: string;
  };
};

type OllamaTagsResponse = {
  models?: OllamaTag[];
};

let localUrlPolicyValidated = false;

function isStrictlyLocalHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!normalized) return false;

  if (normalized === 'localhost' || normalized === '::1') {
    return true;
  }

  if (/^127(?:\.\d{1,3}){3}$/.test(normalized)) {
    const octets = normalized.split('.').map((part) => Number(part));
    return octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
  }

  return false;
}

function normalizeModelName(value: string): string {
  return value.trim().toLowerCase();
}

function modelMatches(tag: OllamaTag, expectedModel: string): boolean {
  const expected = normalizeModelName(expectedModel);
  const candidates = [tag.name, tag.model]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => normalizeModelName(value));
  return candidates.includes(expected);
}

function modelDigest(tag: OllamaTag): string | null {
  const digest = tag.digest ?? tag.details?.digest;
  if (typeof digest !== 'string' || !digest.trim()) return null;
  return digest.trim();
}

export function assertOllamaLocalUrlPolicy(baseUrl = env.OLLAMA_BASE_URL): void {
  const localOnly = env.LLM_LOCAL_ONLY !== false;
  if (!localOnly) return;

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('OLLAMA_BASE_URL is not a valid URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('OLLAMA_BASE_URL must use http or https.');
  }

  if (parsed.username || parsed.password) {
    throw new Error('OLLAMA_BASE_URL must not include URL credentials.');
  }

  if (!isStrictlyLocalHostname(parsed.hostname)) {
    throw new Error('OLLAMA_BASE_URL must resolve to localhost/loopback when LLM_LOCAL_ONLY is enabled.');
  }
}

export function ensureOllamaLocalUrlPolicy(baseUrl = env.OLLAMA_BASE_URL): void {
  if (localUrlPolicyValidated) return;
  assertOllamaLocalUrlPolicy(baseUrl);
  localUrlPolicyValidated = true;
}

export function resetOllamaPolicyValidationForTests(): void {
  localUrlPolicyValidated = false;
}

export async function runOllamaStartupChecks(
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!env.LLM_ENABLED || !env.LLM_STARTUP_CHECK) return;

  assertOllamaLocalUrlPolicy();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), env.LLM_STARTUP_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetchImpl(`${env.OLLAMA_BASE_URL}/api/tags`, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Ollama startup check failed with status ${response.status}.`);
  }

  const data = (await response.json()) as OllamaTagsResponse;
  const models = Array.isArray(data.models) ? data.models : [];
  if (models.length === 0) {
    throw new Error('Ollama startup check returned no loaded models.');
  }

  const requiredModels = [
    { key: 'QWEN_WRITER_MODEL', value: env.QWEN_WRITER_MODEL, digest: env.QWEN_WRITER_MODEL_DIGEST },
    { key: 'QWEN_MULTIMODAL_MODEL', value: env.QWEN_MULTIMODAL_MODEL, digest: env.QWEN_MULTIMODAL_MODEL_DIGEST },
  ] as const;

  for (const required of requiredModels) {
    const found = models.find((tag) => modelMatches(tag, required.value));
    if (!found) {
      throw new Error(`Required Ollama model is not loaded: ${required.key}=${required.value}`);
    }

    if (required.digest) {
      const foundDigest = modelDigest(found);
      if (!foundDigest || foundDigest !== required.digest) {
        throw new Error(
          `Digest mismatch for ${required.key}. Expected ${required.digest}, got ${foundDigest ?? 'none'}.`,
        );
      }
    }
  }
}

export async function verifyOllamaStartupHealth(): Promise<void> {
  try {
    await runOllamaStartupChecks();
    console.info('[llm/startup] Ollama startup checks passed.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (env.LLM_STARTUP_FAIL_CLOSED) {
      throw new Error(`LLM startup checks failed: ${message}`);
    }
    console.warn('[llm/startup] Non-fatal startup check failure:', message);
  }
}