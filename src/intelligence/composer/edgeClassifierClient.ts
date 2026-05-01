import { getConfiguredApiBaseUrl, resolveApiUrl } from '../../lib/apiBase';
import { composeAbortSignals, sleepWithAbort } from '../../lib/abortSignals';
import type {
  ComposerEdgeClassifierRequest,
  ComposerEdgeClassifierResponse,
} from './edgeClassifierContracts';

const BASE_URL = getConfiguredApiBaseUrl(
  (import.meta as any).env?.VITE_GLYMPSE_LLM_BASE_URL,
  (import.meta as any).env?.VITE_GLYMPSE_API_BASE_URL,
);

const EDGE_CLASSIFIER_PATH = '/api/llm/analyze/composer-classifier';
const DEFAULT_TIMEOUT_MS = 4_500;
const RETRY_ATTEMPTS = 2;
const RETRY_BASE_MS = 220;
const RETRY_MAX_MS = 1_200;
const RETRY_JITTER = 0.25;

type AttemptSignal = {
  signal: AbortSignal;
  cleanup: () => void;
};

function clamp01(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function backoffWithJitterMs(attempt: number): number {
  const exp = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
  const jitter = exp * RETRY_JITTER;
  return Math.max(80, Math.floor(exp - jitter + Math.random() * jitter * 2));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function validateEdgeClassifierResponse(value: unknown): ComposerEdgeClassifierResponse {
  if (!isRecord(value)) {
    throw new Error('Composer edge classifier returned non-object response');
  }

  const ml = isRecord(value.ml) ? value.ml : {};
  const confidence = clamp01(value.confidence);
  if (confidence === null) {
    throw new Error('Composer edge classifier returned invalid confidence');
  }

  const toolsUsed = isStringArray(value.toolsUsed)
    ? value.toolsUsed.filter((tool): tool is ComposerEdgeClassifierResponse['toolsUsed'][number] => (
        tool === 'edge-classifier'
        || tool === 'sentiment-polarity'
        || tool === 'emotion'
        || tool === 'targeted-sentiment'
        || tool === 'quality-score'
        || tool === 'abuse-score'
      ))
    : [];

  if (!toolsUsed.includes('edge-classifier')) {
    toolsUsed.unshift('edge-classifier');
  }

  return {
    provider: 'edge-heuristic',
    model: 'composer-edge-classifier-v1',
    confidence,
    toolsUsed,
    ml: ml as ComposerEdgeClassifierResponse['ml'],
    abuseScore: isRecord(value.abuseScore) ? value.abuseScore as ComposerEdgeClassifierResponse['abuseScore'] : null,
  };
}

function createAttemptSignal(parentSignal?: AbortSignal): AttemptSignal {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort(new DOMException('Composer edge classifier timed out', 'TimeoutError'));
  }, DEFAULT_TIMEOUT_MS);

  const signal = parentSignal
    ? composeAbortSignals([parentSignal, controller.signal])
    : controller.signal;

  return {
    signal,
    cleanup: () => {
      globalThis.clearTimeout(timeoutId);
    },
  };
}

export async function callComposerEdgeClassifier(
  request: ComposerEdgeClassifierRequest,
  signal?: AbortSignal,
): Promise<ComposerEdgeClassifierResponse> {
  const endpoint = resolveApiUrl(EDGE_CLASSIFIER_PATH, BASE_URL);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
    const attemptSignal = createAttemptSignal(signal);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        signal: attemptSignal.signal,
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const message = `Composer edge classifier failed with ${response.status}`;
        if (!isRetryableStatus(response.status) || attempt === RETRY_ATTEMPTS - 1) {
          throw Object.assign(new Error(message), { status: response.status });
        }
        lastError = Object.assign(new Error(message), { status: response.status });
      } else {
        return validateEdgeClassifierResponse(await response.json());
      }
    } catch (error) {
      lastError = error;
      if (signal?.aborted || attempt === RETRY_ATTEMPTS - 1) {
        break;
      }
    } finally {
      attemptSignal.cleanup();
    }

    await sleepWithAbort(backoffWithJitterMs(attempt), signal);
  }

  throw lastError instanceof Error ? lastError : new Error('Composer edge classifier failed');
}
