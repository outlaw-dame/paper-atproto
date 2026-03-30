import type { ComposerContext, ComposerGuidanceScores, ComposerGuidanceUi, ComposerGuidanceUiState } from './types';
import type { ComposerMLSignals } from './classifierContracts';
import type { AbuseModelResult } from '../../lib/abuseModel';
import type { SentimentResult } from '../../lib/sentiment';

function getTitle(mode: ComposerContext['mode'], state: ComposerGuidanceUiState): string {
  if (state === 'alert') return 'Content notice';
  if (mode === 'hosted_thread') return 'Prompt guidance';
  if (mode === 'reply') {
    if (state === 'positive') return 'Reply context · Constructive signal';
    if (state === 'neutral') return 'Reply context';
    return 'Reply context · Tone check';
  }

  return state === 'positive' ? 'Constructive signal' : 'Tone check';
}

function getPositiveMessage(
  context: ComposerContext,
  heuristics: SentimentResult,
  ml: ComposerMLSignals,
  scores: ComposerGuidanceScores,
): string {
  if (context.mode === 'hosted_thread') {
    if (scores.supportiveness >= 0.58 && scores.constructiveness >= 0.52) {
      return 'This prompt feels open and inviting.';
    }
    if (scores.clarifying >= 0.56) {
      return 'This prompt looks clear and respectful.';
    }
    return 'This framing feels likely to encourage thoughtful replies.';
  }

  if (scores.supportiveness >= 0.62 && scores.constructiveness >= 0.56) {
    return context.mode === 'reply'
      ? 'This reply adds context without escalating.'
      : 'This reads as supportive and constructive.';
  }
  if (scores.supportiveness >= 0.62 || heuristics.supportiveReplySignals.length > 0) {
    return 'This reads as supportive.';
  }
  if (scores.constructiveness >= 0.58 || heuristics.constructiveSignals.length > 0) {
    return 'This looks constructive and clear.';
  }
  if (scores.trust >= 0.5 || scores.optimism >= 0.5 || ml.sentiment?.label === 'positive') {
    return 'This feels likely to keep the conversation productive.';
  }

  return 'This reads as constructive.';
}

function getCautionMessage(
  context: ComposerContext,
  heuristics: SentimentResult,
  scores: ComposerGuidanceScores,
): string {
  if (context.mode === 'hosted_thread') {
    return 'This prompt may frame the discussion more combatively than you intend.';
  }
  if (scores.dismissiveness >= 0.45) {
    return 'This could land as dismissive.';
  }
  if (scores.targetedNegativity >= 0.38) {
    return 'You may want to focus more on the point than the person.';
  }
  if (heuristics.signals.some((signal) => /\bdismissive\b/i.test(signal))) {
    return 'This could land as dismissive.';
  }
  if (context.mode === 'reply') {
    return 'This may read as sharp in this reply context.';
  }
  return 'This may read as sharp.';
}

function getWarningMessage(
  context: ComposerContext,
  scores: ComposerGuidanceScores,
  abuseScore: AbuseModelResult | null,
): string {
  if (context.mode === 'hosted_thread') {
    return 'This framing may steer the discussion toward conflict.';
  }
  if (abuseScore?.label === 'insult' || abuseScore?.label === 'toxic') {
    return 'This may come across as hostile.';
  }
  if (scores.targetedNegativity >= 0.5 && scores.hostility >= 0.58) {
    return 'This reads more like an attack than a response.';
  }
  return 'This may come across as hostile.';
}

function getAlertMessage(heuristics: SentimentResult): string {
  if (heuristics.hasMentalHealthCrisis) {
    return 'This draft suggests someone may need support or crisis resources.';
  }
  return 'This contains language that could cause harm.';
}

function getNeutralMessage(context: ComposerContext): string {
  if (context.mode === 'reply') {
    return 'Reply context is active; a little context can help this land well.';
  }
  if (context.mode === 'hosted_thread') {
    return 'Open framing usually leads to better discussion.';
  }
  return '';
}

function getFootnote(state: ComposerGuidanceUiState, context: ComposerContext): string {
  if (state === 'positive') {
    return context.mode === 'hosted_thread'
      ? 'Prompts framed like this usually invite more thoughtful discussion.'
      : 'Constructive framing like this usually helps conversations stay more useful.';
  }
  if (state === 'neutral') {
    return context.mode === 'reply'
      ? 'No tone issues detected — this context is just for awareness.'
      : '';
  }
  if (state === 'alert') {
    return 'You can still post, but this is a stronger heads-up.';
  }
  return 'You can still post — this is just guidance.';
}

function getBadges(
  context: ComposerContext,
  heuristics: SentimentResult,
  scores: ComposerGuidanceScores,
): string[] {
  const badges: string[] = [];

  if (heuristics.parentSignals.length > 0 && context.mode === 'reply') {
    badges.push('Reply context');
  }
  if (scores.supportiveness >= 0.56 || heuristics.supportiveReplySignals.length > 0) {
    badges.push(context.mode === 'hosted_thread' ? 'Inviting tone' : 'Supportive reply');
  }
  if (scores.constructiveness >= 0.52 || heuristics.constructiveSignals.length > 0) {
    badges.push(context.mode === 'hosted_thread' ? 'Clear framing' : 'Constructive signal');
  }
  if (scores.clarifying >= 0.56 && context.mode !== 'hosted_thread') {
    badges.push('Clear point');
  }

  return badges;
}

function getSuggestion(
  state: ComposerGuidanceUiState,
  context: ComposerContext,
  scores: ComposerGuidanceScores,
): string | undefined {
  if (state === 'warning' || state === 'caution') {
    if (context.mode === 'reply' && scores.targetedNegativity >= 0.38) {
      return 'Try shifting from naming the person to naming the point you disagree with.';
    }
    if (scores.dismissiveness >= 0.45) {
      return 'A little more explanation or evidence would likely make this land better.';
    }
  }

  return undefined;
}

export function buildComposerGuidanceUi(
  context: ComposerContext,
  heuristics: SentimentResult,
  state: ComposerGuidanceUiState,
  abuseScore: AbuseModelResult | null,
  ml: ComposerMLSignals,
  scores: ComposerGuidanceScores,
): ComposerGuidanceUi {
  const title = getTitle(context.mode, state);
  const badges = getBadges(context, heuristics, scores);
  const footnote = getFootnote(state, context);

  let message = '';
  if (state === 'positive') {
    message = getPositiveMessage(context, heuristics, ml, scores);
  } else if (state === 'caution') {
    message = getCautionMessage(context, heuristics, scores);
  } else if (state === 'warning') {
    message = getWarningMessage(context, scores, abuseScore);
  } else if (state === 'alert') {
    message = getAlertMessage(heuristics);
  } else {
    message = getNeutralMessage(context);
  }

  return {
    state,
    title,
    message,
    badges,
    footnote,
    suggestion: getSuggestion(state, context, scores),
    copySource: 'template',
  };
}
