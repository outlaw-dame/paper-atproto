import { callComposerGuidanceWriter } from '../modelClient';
import type { ComposerGuidanceWriteRequest } from './llmWriterContracts';
import type { ComposerContext, ComposerGuidanceResult, ComposerGuidanceTool } from './types';

function uniqTools(values: ComposerGuidanceTool[]): ComposerGuidanceTool[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function sanitizeWriterText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function sanitizeBadges(values: string[]): string[] {
  return uniqStrings(
    values
      .map((value) => sanitizeWriterText(value, 24))
      .filter((value): value is string => Boolean(value)),
  ).slice(0, 4);
}

function buildPremiumContextSignals(
  context: ComposerContext,
): string[] {
  const premiumContext = context.summaries?.premiumContext;
  if (!premiumContext) return [];

  const deepSummary = sanitizeWriterText(premiumContext.deepSummary, 110);
  const groundedContext = sanitizeWriterText(premiumContext.groundedContext, 120);
  const perspectiveGaps = uniqStrings(
    premiumContext.perspectiveGaps
      .map((value) => sanitizeWriterText(value, 90))
      .filter((value): value is string => Boolean(value)),
  ).slice(0, 2);
  const followUpQuestions = uniqStrings(
    premiumContext.followUpQuestions
      .map((value) => sanitizeWriterText(value, 90))
      .filter((value): value is string => Boolean(value)),
  ).slice(0, 2);

  const signals: string[] = [];
  const contextParts: string[] = [];

  if (groundedContext) {
    contextParts.push(`Deep context: ${groundedContext}`);
  } else if (deepSummary) {
    contextParts.push(`Deep summary: ${deepSummary}`);
  }

  if (perspectiveGaps.length > 0) {
    contextParts.push(`Missing context: ${perspectiveGaps.join(' | ')}`);
  }

  if (contextParts.length > 0) {
    signals.push(contextParts.join(' '));
  }

  if (followUpQuestions.length > 0) {
    signals.push(
      `${followUpQuestions.length > 1 ? 'Open questions' : 'Open question'}: ${followUpQuestions.join(' | ')}`,
    );
  }

  return uniqStrings(signals).slice(0, 3);
}

function buildMediaContextSignals(
  context: ComposerContext,
): string[] {
  const mediaContext = context.summaries?.mediaContext;
  if (!mediaContext) return [];

  const summary = sanitizeWriterText(mediaContext.summary, 120);
  const caution = sanitizeWriterText(mediaContext.cautionFlags[0], 60);
  if (!summary && !caution) return [];

  const parts: string[] = [];
  if (summary) {
    parts.push(summary);
  } else if (mediaContext.primaryKind) {
    parts.push(`Key media appears to be a ${mediaContext.primaryKind}.`);
  }
  if (caution) {
    parts.push(`Caution: ${caution}.`);
  }
  if (mediaContext.analysisStatus === 'degraded') {
    parts.push('Use this as a low-authority media hint.');
  }
  if (mediaContext.moderationStatus === 'unavailable') {
    parts.push('Moderation status is unavailable.');
  }

  return [`Media context: ${parts.join(' ')}`];
}

function buildParentSignals(
  context: ComposerContext,
  guidance: ComposerGuidanceResult,
): string[] {
  const heuristicSignals = uniqStrings(
    guidance.heuristics.parentSignals
      .map((value) => sanitizeWriterText(value, 100))
      .filter((value): value is string => Boolean(value)),
  );
  const premiumSignals = buildPremiumContextSignals(context);
  const mediaSignals = buildMediaContextSignals(context);
  const prioritizedContextSignals = uniqStrings([
    ...premiumSignals,
    ...mediaSignals,
  ]).slice(0, 3);
  const heuristicBudget = Math.max(0, 4 - prioritizedContextSignals.length);

  return uniqStrings([
    ...prioritizedContextSignals,
    ...heuristicSignals.slice(0, heuristicBudget),
  ]).slice(0, 4);
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
    parentSignals: buildParentSignals(context, guidance),
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
      toolsUsed: uniqTools([...guidance.toolsUsed, 'guidance-writer']),
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
