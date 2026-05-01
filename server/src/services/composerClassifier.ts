import { z } from 'zod';
import type {
  ComposerClassifierResponseSchema,
  ComposerClassifierSchema,
} from '../llm/schemas.js';

type ComposerClassifierRequest = z.infer<typeof ComposerClassifierSchema>;
type ComposerClassifierResponse = z.infer<typeof ComposerClassifierResponseSchema>;
type AbuseScore = NonNullable<ComposerClassifierResponse['abuseScore']>;
type AbuseScoreLabel = keyof AbuseScore['scores'];
type SentimentLabel = NonNullable<ComposerClassifierResponse['ml']['sentiment']>['label'];

type UnitScores = Record<AbuseScoreLabel, number>;

type PatternRule = {
  re: RegExp;
  weight: number;
};

const EDGE_CLASSIFIER_MODEL = 'composer-edge-classifier-v1' as const;
const EDGE_CLASSIFIER_PROVIDER = 'edge-heuristic' as const;

const NEGATIVE_RULES: PatternRule[] = [
  { re: /\b(stupid|idiot|moron|dumb|pathetic|trash|garbage|clown|loser|delusional)\b/i, weight: 0.28 },
  { re: /\b(shut\s+up|stfu|go\s+away|get\s+lost)\b/i, weight: 0.32 },
  { re: /\b(liar|lying|fake|fraud|corrupt)\b/i, weight: 0.22 },
  { re: /\b(i\s+hate|despise|loathe)\b/i, weight: 0.22 },
  { re: /\b(always|never|everyone|nobody)\b.{0,50}\b(wrong|lying|stupid|bad)\b/i, weight: 0.18 },
];

const POSITIVE_RULES: PatternRule[] = [
  { re: /\b(i\s+hear\s+you|i\s+understand|that\s+sounds\s+hard|you'?re\s+not\s+alone)\b/i, weight: 0.35 },
  { re: /\b(thank\s+you|thanks\s+for|good\s+point|well\s+said|i\s+agree)\b/i, weight: 0.24 },
  { re: /\b(if\s+it\s+helps|no\s+pressure|take\s+your\s+time|rooting\s+for\s+you)\b/i, weight: 0.28 },
];

const CONSTRUCTIVE_RULES: PatternRule[] = [
  { re: /\b(source|citation|evidence|data|study|according\s+to|link)\b/i, weight: 0.24 },
  { re: /\b(can\s+you\s+clarify|what\s+do\s+you\s+mean|help\s+me\s+understand|genuine\s+question)\b/i, weight: 0.3 },
  { re: /\b(in\s+my\s+experience|what\s+worked\s+for\s+me|one\s+thing\s+that\s+helped)\b/i, weight: 0.28 },
  { re: /\b(could|might|consider|maybe|try)\b/i, weight: 0.12 },
];

const ABUSE_RULES: Array<PatternRule & { label: AbuseScoreLabel }> = [
  { re: /\b(kill\s+your?self|kys|go\s+die|drop\s+dead)\b/i, weight: 0.9, label: 'threat' },
  { re: /\bf[a4*]gg?[o0*]t(s)?\b/i, weight: 0.95, label: 'identity_hate' },
  { re: /\bn[i1!*][g9][g9][ae3*]r?(s)?\b/i, weight: 0.98, label: 'identity_hate' },
  { re: /\br[e3*]t[a4*]rd(ed)?\b/i, weight: 0.75, label: 'identity_hate' },
  { re: /\b(c[u*]nt|fuck\s+you|asshole|bitch)\b/i, weight: 0.62, label: 'obscene' },
  { re: /\b(stupid|idiot|moron|pathetic|trash|garbage|clown|loser)\b/i, weight: 0.48, label: 'insult' },
];

const ANGER_RULES: PatternRule[] = [
  { re: /\b(angry|furious|rage|hate|despise|sick\s+of)\b/i, weight: 0.28 },
  { re: /!{2,}/, weight: 0.16 },
  { re: /\b(stupid|idiot|liar|trash|garbage)\b/i, weight: 0.22 },
];

const TRUST_RULES: PatternRule[] = [
  { re: /\b(thanks|thank\s+you|appreciate|fair\s+point|i\s+hear\s+you)\b/i, weight: 0.3 },
  { re: /\b(source|citation|evidence|according\s+to)\b/i, weight: 0.16 },
];

const OPTIMISM_RULES: PatternRule[] = [
  { re: /\b(hope|helpful|rooting|glad|better|progress|good\s+news)\b/i, weight: 0.3 },
  { re: /\b(we\s+can|you\s+can|it\s+can\s+help)\b/i, weight: 0.22 },
];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round3(value: number): number {
  return Math.round(clamp01(value) * 1000) / 1000;
}

function sanitizeText(value: string, maxLength: number): string {
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function scoreRules(text: string, rules: PatternRule[], baseline = 0): number {
  return round3(rules.reduce((score, rule) => score + (rule.re.test(text) ? rule.weight : 0), baseline));
}

function strongestLabel<T extends string>(scores: Record<T, number>): T {
  return Object.entries(scores).sort(([, left], [, right]) => Number(right) - Number(left))[0]![0] as T;
}

function allCapsIntensity(text: string): number {
  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 24) return 0;
  const upperCount = (text.match(/[A-Z]/g) ?? []).length;
  return clamp01((upperCount / letters.length - 0.45) * 2);
}

function exclamationIntensity(text: string): number {
  return clamp01(((text.match(/!/g) ?? []).length - 1) / 4);
}

function buildSentiment(text: string): {
  label: SentimentLabel;
  confidence: number;
  scores: Record<SentimentLabel, number>;
} {
  const negativeRaw = scoreRules(text, NEGATIVE_RULES, 0.08);
  const positiveRaw = scoreRules(text, POSITIVE_RULES, 0.08);
  const intensity = clamp01(allCapsIntensity(text) * 0.16 + exclamationIntensity(text) * 0.12);
  const negative = round3(negativeRaw + intensity);
  const positive = round3(positiveRaw);
  const neutral = round3(1 - Math.max(positive, negative) * 0.72);
  const scores: Record<SentimentLabel, number> = { negative, neutral, positive };
  const label = strongestLabel(scores);
  return {
    label,
    confidence: scores[label],
    scores,
  };
}

function buildQuality(text: string, parentText?: string) {
  const constructive = scoreRules(text, CONSTRUCTIVE_RULES, 0.08);
  const supportive = scoreRules(text, POSITIVE_RULES, 0.06);
  const clarifying = round3((/\?/.test(text) ? 0.22 : 0) + scoreRules(text, [CONSTRUCTIVE_RULES[1]!], 0.04));
  const hostile = round3(scoreRules(text, NEGATIVE_RULES, 0.04) + allCapsIntensity(text) * 0.18);
  const dismissive = round3(scoreRules(text, [NEGATIVE_RULES[0]!, NEGATIVE_RULES[1]!], 0.03));
  const escalating = round3(hostile * 0.62 + exclamationIntensity(text) * 0.2 + (parentText ? 0.08 : 0));
  return {
    constructive,
    supportive,
    clarifying,
    dismissive,
    hostile,
    escalating,
  };
}

function buildEmotions(text: string) {
  const anger = scoreRules(text, ANGER_RULES, 0.04);
  const trust = scoreRules(text, TRUST_RULES, 0.04);
  const optimism = scoreRules(text, OPTIMISM_RULES, 0.04);
  const joy = scoreRules(text, [{ re: /\b(happy|glad|great|love\s+this)\b/i, weight: 0.24 }], 0.03);
  return [
    { label: 'anger' as const, score: anger },
    { label: 'trust' as const, score: trust },
    { label: 'optimism' as const, score: optimism },
    { label: 'joy' as const, score: joy },
  ]
    .filter((item) => item.score >= 0.08)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);
}

function buildTargetedTone(text: string, targetText?: string) {
  if (!targetText?.trim()) return undefined;
  const negative = scoreRules(text, NEGATIVE_RULES, 0.04);
  const positive = scoreRules(text, POSITIVE_RULES, 0.04);

  if (negative >= 0.72) {
    return { label: 'strongly_negative' as const, confidence: negative };
  }
  if (negative >= 0.36) {
    return { label: 'negative' as const, confidence: negative };
  }
  if (positive >= 0.42) {
    return { label: 'positive' as const, confidence: positive };
  }
  return { label: 'negative_or_neutral' as const, confidence: round3(Math.max(negative, 0.28)) };
}

function buildAbuseScore(text: string): ComposerClassifierResponse['abuseScore'] {
  const scores: UnitScores = {
    toxic: 0,
    insult: 0,
    obscene: 0,
    identity_hate: 0,
    threat: 0,
    severe_toxic: 0,
  };

  for (const rule of ABUSE_RULES) {
    if (rule.re.test(text)) {
      scores[rule.label] = Math.max(scores[rule.label], rule.weight);
    }
  }

  scores.toxic = Math.max(scores.toxic, scores.insult * 0.72, scores.obscene * 0.62, scores.threat * 0.8);
  scores.severe_toxic = Math.max(scores.severe_toxic, scores.threat * 0.78, scores.identity_hate * 0.72);

  const rounded: AbuseScore['scores'] = {
    toxic: round3(scores.toxic),
    insult: round3(scores.insult),
    obscene: round3(scores.obscene),
    identity_hate: round3(scores.identity_hate),
    threat: round3(scores.threat),
    severe_toxic: round3(scores.severe_toxic),
  };
  const label = strongestLabel(rounded);
  const score = rounded[label];

  if (score < 0.2) return null;

  return {
    model: 'composer-edge-abuse-v1',
    provider: EDGE_CLASSIFIER_PROVIDER,
    label,
    score,
    scores: rounded,
  };
}

export async function runComposerClassifier(
  request: ComposerClassifierRequest,
): Promise<ComposerClassifierResponse> {
  const draftText = sanitizeText(request.draftText, 1200);
  const parentText = request.parentText ? sanitizeText(request.parentText, 500) : undefined;
  const targetText = request.targetText ?? parentText;
  const contextText = [draftText, ...(request.contextSignals ?? [])].join(' ');

  const sentiment = buildSentiment(contextText);
  const emotions = buildEmotions(contextText);
  const targetedTone = buildTargetedTone(draftText, targetText);
  const conversationQuality = buildQuality(contextText, parentText);
  const abuseScore = buildAbuseScore(draftText);
  const confidence = round3(
    0.34 * sentiment.confidence
    + 0.22 * Math.max(...emotions.map((item) => item.score), 0.12)
    + 0.24 * Math.max(...Object.values(conversationQuality))
    + 0.2 * Math.max(abuseScore?.score ?? 0.12, targetedTone?.confidence ?? 0.12),
  );

  return {
    provider: EDGE_CLASSIFIER_PROVIDER,
    model: EDGE_CLASSIFIER_MODEL,
    confidence,
    toolsUsed: [
      'edge-classifier',
      'sentiment-polarity',
      'emotion',
      ...(targetedTone ? ['targeted-sentiment' as const] : []),
      'quality-score',
      ...(abuseScore ? ['abuse-score' as const] : []),
    ],
    ml: {
      sentiment: {
        label: sentiment.label,
        confidence: sentiment.confidence,
      },
      emotions,
      ...(targetedTone ? { targetedTone } : {}),
      conversationQuality,
    },
    abuseScore,
  };
}
