import type {
  InterpolatorWriteResult,
  SummaryMode,
  ThreadStateForWriter,
} from '../intelligence/llmContracts';

export const CONVERSATION_COORDINATOR_WRITER_STAGE_VERSION = 1 as const;

export type ConversationCoordinatorWriterStatus = 'ready' | 'error';

export type ConversationCoordinatorWriterReasonCode =
  | 'writer_result_ready'
  | 'writer_result_redacted'
  | 'writer_result_invalid'
  | 'writer_result_missing_summary'
  | 'writer_result_normalized'
  | 'writer_execution_failed';

export type ConversationCoordinatorWriterFunction = (
  input: ThreadStateForWriter,
  signal?: AbortSignal,
) => Promise<unknown>;

export type ConversationCoordinatorWriterRedactor = (
  result: InterpolatorWriteResult,
) => InterpolatorWriteResult;

export type ConversationCoordinatorWriterOutcome =
  | {
      schemaVersion: typeof CONVERSATION_COORDINATOR_WRITER_STAGE_VERSION;
      status: 'ready';
      result: InterpolatorWriteResult;
      durationMs: number;
      reasonCodes: ConversationCoordinatorWriterReasonCode[];
      diagnostics: {
        abstained: boolean;
        mode: SummaryMode;
        redacted: boolean;
        normalized: boolean;
      };
    }
  | {
      schemaVersion: typeof CONVERSATION_COORDINATOR_WRITER_STAGE_VERSION;
      status: 'error';
      error: string;
      durationMs: number;
      reasonCodes: ConversationCoordinatorWriterReasonCode[];
      diagnostics: {
        redacted: false;
        normalized: false;
      };
    };

export interface ConversationCoordinatorWriterExecutionInput {
  writerInput: ThreadStateForWriter;
  write: ConversationCoordinatorWriterFunction;
  signal?: AbortSignal;
  redactResult?: ConversationCoordinatorWriterRedactor;
  nowMs?: () => number;
}

interface NormalizedWriterResult {
  result: InterpolatorWriteResult;
  normalized: boolean;
}

export async function executeConversationCoordinatorWriterStage(
  input: ConversationCoordinatorWriterExecutionInput,
): Promise<ConversationCoordinatorWriterOutcome> {
  const now = input.nowMs ?? defaultNowMs;
  const startedAt = now();

  assertNotAborted(input.signal);

  try {
    const rawResult = await input.write(input.writerInput, input.signal);
    assertNotAborted(input.signal);

    const normalized = normalizeWriterResult(rawResult, input.writerInput.summaryMode);
    if (!normalized) {
      return buildErrorOutcome({
        error: 'Interpolator writer returned an invalid result.',
        durationMs: elapsedMs(startedAt, now()),
        reasonCodes: ['writer_result_invalid'],
      });
    }

    if (normalized.result.collapsedSummary.length === 0) {
      return buildErrorOutcome({
        error: 'Interpolator writer returned an empty summary.',
        durationMs: elapsedMs(startedAt, now()),
        reasonCodes: ['writer_result_missing_summary'],
      });
    }

    const redactedResult = input.redactResult
      ? normalizeWriterResult(input.redactResult(normalized.result), normalized.result.mode)
      : normalized;

    if (!redactedResult || redactedResult.result.collapsedSummary.length === 0) {
      return buildErrorOutcome({
        error: 'Interpolator writer redaction produced an invalid result.',
        durationMs: elapsedMs(startedAt, now()),
        reasonCodes: ['writer_result_invalid'],
      });
    }

    const redacted = Boolean(input.redactResult);
    const outputNormalized = normalized.normalized || redactedResult.normalized;

    return {
      schemaVersion: CONVERSATION_COORDINATOR_WRITER_STAGE_VERSION,
      status: 'ready',
      result: redactedResult.result,
      durationMs: elapsedMs(startedAt, now()),
      reasonCodes: unique([
        'writer_result_ready',
        ...(redacted ? ['writer_result_redacted' as const] : []),
        ...(outputNormalized ? ['writer_result_normalized' as const] : []),
      ]),
      diagnostics: {
        abstained: redactedResult.result.abstained,
        mode: redactedResult.result.mode,
        redacted,
        normalized: outputNormalized,
      },
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    return buildErrorOutcome({
      error: sanitizeErrorMessage(error, 'Interpolator writer failed.'),
      durationMs: elapsedMs(startedAt, now()),
      reasonCodes: ['writer_execution_failed'],
    });
  }
}

function normalizeWriterResult(raw: unknown, fallbackMode: SummaryMode): NormalizedWriterResult | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.collapsedSummary !== 'string') return null;
  if (!Array.isArray(raw.whatChanged)) return null;
  if (!Array.isArray(raw.contributorBlurbs)) return null;
  if (typeof raw.abstained !== 'boolean') return null;

  let normalized = false;
  const collapsedSummary = normalizeText(raw.collapsedSummary, 1_200);
  if (collapsedSummary !== raw.collapsedSummary) normalized = true;

  const expandedSummary = typeof raw.expandedSummary === 'string'
    ? normalizeText(raw.expandedSummary, 4_000)
    : undefined;
  if (expandedSummary !== undefined && expandedSummary !== raw.expandedSummary) normalized = true;

  const whatChanged = normalizeStringArray(raw.whatChanged, 8, 280);
  if (whatChanged.length !== raw.whatChanged.length || whatChanged.some((value, index) => value !== raw.whatChanged[index])) {
    normalized = true;
  }

  const contributorBlurbs = normalizeContributorBlurbs(raw.contributorBlurbs);
  if (contributorBlurbs.length !== raw.contributorBlurbs.length) {
    normalized = true;
  }

  const mode = normalizeSummaryMode(raw.mode, fallbackMode);
  if (mode !== raw.mode) normalized = true;

  return {
    result: {
      collapsedSummary,
      ...(expandedSummary ? { expandedSummary } : {}),
      whatChanged,
      contributorBlurbs,
      abstained: raw.abstained,
      mode,
    },
    normalized,
  };
}

function normalizeContributorBlurbs(value: unknown[]): InterpolatorWriteResult['contributorBlurbs'] {
  const normalized: InterpolatorWriteResult['contributorBlurbs'] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (!isRecord(entry)) continue;
    if (typeof entry.handle !== 'string' || typeof entry.blurb !== 'string') continue;

    const handle = normalizeHandle(entry.handle);
    const blurb = normalizeText(entry.blurb, 320);
    if (!handle || !blurb) continue;

    const key = `${handle.toLowerCase()}\u0000${blurb.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    normalized.push({ handle, blurb });
    if (normalized.length >= 6) break;
  }

  return normalized;
}

function normalizeStringArray(value: unknown[], maxItems: number, maxChars: number): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = normalizeText(item, maxChars);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(text);
    if (normalized.length >= maxItems) break;
  }

  return normalized;
}

function normalizeSummaryMode(value: unknown, fallbackMode: SummaryMode): SummaryMode {
  return value === 'normal' || value === 'descriptive_fallback' || value === 'minimal_fallback'
    ? value
    : fallbackMode;
}

function normalizeHandle(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^@+/, '')
    .slice(0, 120);
}

function normalizeText(value: string, maxChars: number): string {
  return value
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars)
    .trim();
}

function buildErrorOutcome(params: {
  error: string;
  durationMs: number;
  reasonCodes: readonly ConversationCoordinatorWriterReasonCode[];
}): ConversationCoordinatorWriterOutcome {
  return {
    schemaVersion: CONVERSATION_COORDINATOR_WRITER_STAGE_VERSION,
    status: 'error',
    error: params.error,
    durationMs: params.durationMs,
    reasonCodes: unique(params.reasonCodes),
    diagnostics: {
      redacted: false,
      normalized: false,
    },
  };
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw createAbortError();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function createAbortError(): Error {
  const error = new Error('Writer execution aborted.');
  error.name = 'AbortError';
  return error;
}

function sanitizeErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error ?? fallback);
  const sanitized = raw.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();
  return (sanitized || fallback).slice(0, 220);
}

function elapsedMs(startedAt: number, endedAt: number): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return 0;
  return Math.max(0, Math.round(endedAt - startedAt));
}

function defaultNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}
