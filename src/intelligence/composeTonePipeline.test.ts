import { describe, expect, it, vi } from 'vitest';

import type { AbuseModelResult } from '../lib/abuseModel';
import type {
  ComposerEmotionResult,
  ComposerQualityResult,
  ComposerSentimentResult,
  ComposerTargetedToneResult,
} from '../lib/composerMl';
import type { ToneModelResult } from '../lib/toneModel';
import { analyzeComposeTone } from './composeTonePipeline';

function createToneResult(): ToneModelResult {
  return {
    model: 'test-tone',
    label: 'constructive',
    scores: {
      hostile: 0.04,
      supportive: 0.2,
      constructive: 0.82,
      positive: 0.3,
      neutral: 0.14,
    },
  };
}

function createAbuseResult(): AbuseModelResult {
  return {
    model: 'test-abuse',
    provider: 'local',
    label: 'toxic',
    score: 0.08,
    scores: {
      toxic: 0.08,
      severe_toxic: 0.01,
      obscene: 0.01,
      insult: 0.02,
      identity_hate: 0.01,
      threat: 0.01,
    },
  };
}

function createSentimentResult(): ComposerSentimentResult {
  return {
    model: 'test-sentiment',
    label: 'neutral',
    confidence: 0.76,
    scores: {
      negative: 0.12,
      neutral: 0.76,
      positive: 0.12,
    },
  };
}

function createEmotionResult(): ComposerEmotionResult {
  return {
    model: 'test-emotion',
    emotions: [
      { label: 'trust', score: 0.61 },
      { label: 'optimism', score: 0.22 },
    ],
    scores: {
      anger: 0.03,
      anticipation: 0.08,
      disgust: 0.01,
      fear: 0.02,
      joy: 0.12,
      love: 0.04,
      optimism: 0.22,
      pessimism: 0.02,
      sadness: 0.04,
      surprise: 0.03,
      trust: 0.61,
    },
  };
}

function createTargetedToneResult(target: string): ComposerTargetedToneResult {
  return {
    model: 'test-targeted-tone',
    target,
    label: 'positive',
    confidence: 0.74,
    scores: {
      strongly_negative: 0.02,
      negative: 0.08,
      negative_or_neutral: 0.14,
      positive: 0.74,
      strongly_positive: 0.02,
    },
  };
}

function createQualityResult(): ComposerQualityResult {
  return {
    model: 'test-quality',
    provider: 'local',
    label: 'constructive',
    confidence: 0.81,
    scores: {
      constructive: 0.81,
      supportive: 0.11,
      clarifying: 0.06,
      dismissive: 0.01,
      hostile: 0.0,
      escalating: 0.01,
    },
  };
}

describe('composeTonePipeline', () => {
  it('uses bounded Conversation OS context for tone and quality while keeping other models on raw draft text', async () => {
    const draft = 'I think we should wait for the full memo before we say the cuts are final.';
    const target = '@agency.test';
    const contextSignals = [
      'Deep context: Riders are debating whether the leaked memo is authentic.',
      'Missing context: No official agency statement is visible yet.',
      'Open question: Did the agency publish a full weekend schedule?',
      'Media context: Screenshot of a transit memo with highlighted service cuts (low-authority hint)',
      'Thread state: active / contested',
    ];

    const classifyTone = vi.fn(async (text: string) => createToneResult());
    const scoreAbuse = vi.fn(async (text: string) => createAbuseResult());
    const classifySentiment = vi.fn(async (text: string) => createSentimentResult());
    const classifyEmotion = vi.fn(async (text: string) => createEmotionResult());
    const classifyTargetedTone = vi.fn(async (text: string, seenTarget: string) => createTargetedToneResult(seenTarget));
    const classifyQuality = vi.fn(async (text: string) => createQualityResult());

    const analysis = await analyzeComposeTone(
      draft,
      {
        targetText: target,
        contextSignals,
      },
      {
        classifyTone,
        scoreAbuse,
        classifySentiment,
        classifyEmotion,
        classifyTargetedTone,
        classifyQuality,
      },
    );

    const toneInput = classifyTone.mock.calls[0]?.[0];
    const qualityInput = classifyQuality.mock.calls[0]?.[0];

    expect(toneInput).toContain(draft);
    expect(toneInput).toContain('Conversation context:');
    expect(toneInput).toContain(contextSignals[0]);
    expect(toneInput).toContain(contextSignals[3]);
    expect(toneInput).not.toContain(contextSignals[4]);
    expect(qualityInput).toBe(toneInput);

    expect(scoreAbuse).toHaveBeenCalledWith(draft);
    expect(classifySentiment).toHaveBeenCalledWith(draft);
    expect(classifyEmotion).toHaveBeenCalledWith(draft);
    expect(classifyTargetedTone).toHaveBeenCalledWith(draft, target);

    expect(analysis.toolsUsed).toEqual(expect.arrayContaining([
      'heuristic',
      'zero-shot-tone',
      'abuse-score',
      'sentiment-polarity',
      'emotion',
      'targeted-sentiment',
      'quality-score',
    ]));
    expect(analysis.result.level).toBe('positive');
  });
});
