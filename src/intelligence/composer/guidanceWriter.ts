import { callComposerGuidanceWriter } from '../modelClient';
import type { ComposerGuidanceWriteRequest } from './llmWriterContracts';
import type { ComposerContext, ComposerGuidanceResult } from './types';

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function sanitizeWriterText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function sanitizeBadges(values: string[]): string[] {
  return uniq(
    values
      .map((value) => sanitizeWriterText(value, 24))
      .filter((value): value is string => Boolean(value)),
  ).slice(0, 4);
}

function buildRequest(
  context: ComposerContext,
  guidance: ComposerGuidanceResult,
): ComposerGuidanceWriteRequest | null {
  if (
    guidance.ui.state !== 'positive'
    && guidance.ui.state !== 'caution'
    && guidance.ui.state !== 'warning'
  ) {
    return null;
  }

  return {
    mode: context.mode,
    draftText: context.draftText.trim().slice(0, 1200),
    ...(context.directParent?.text
      ? { parentText: context.directParent.text.trim().slice(0, 500) }
      : {}),
    uiState: guidance.ui.state,
    scores: guidance.scores,
    constructiveSignals: guidance.heuristics.constructiveSignals.slice(0, 4),
    supportiveSignals: guidance.heuristics.supportiveReplySignals.slice(0, 4),
    parentSignals: guidance.heuristics.parentSignals.slice(0, 4),
  };
}

export async function maybeWriteComposerGuidance(
  context: ComposerContext,
  guidance: ComposerGuidanceResult,
  signal?: AbortSignal,
): Promise<ComposerGuidanceResult> {
  const request = buildRequest(context, guidance);
  if (!request) return guidance;

  try {
    const writer = await callComposerGuidanceWriter(request, signal);
    const message = sanitizeWriterText(writer.message, 180);
    const suggestion = sanitizeWriterText(writer.suggestion, 180);
    const badges = sanitizeBadges([...writer.badges, ...guidance.ui.badges]);

    if (!message && !suggestion && badges.length === 0) {
      return guidance;
    }

    return {
      ...guidance,
      toolsUsed: uniq([...guidance.toolsUsed, 'guidance-writer']),
      ui: {
        ...guidance.ui,
        ...(message ? { message } : {}),
        ...(suggestion ? { suggestion } : {}),
        ...(badges.length > 0 ? { badges } : {}),
        copySource: 'llm',
      },
    };
  } catch {
    return guidance;
  }
}
