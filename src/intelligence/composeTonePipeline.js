import { analyzeSentiment, analyzeSentimentWithModel, } from '../lib/sentiment.js';
const ABUSE_WARN_THRESHOLD = 0.72;
const ABUSE_HIGH_SEVERITY_THRESHOLD = 0.42;
const ABUSE_INSULT_THRESHOLD = 0.78;
const ABUSE_TOXIC_THRESHOLD = 0.76;
const ML_MIN_LENGTH = 12;
let inferenceClientModulePromise = null;
async function getInferenceClientModule() {
    if (!inferenceClientModulePromise) {
        inferenceClientModulePromise = import('../workers/InferenceClient.js');
    }
    return inferenceClientModulePromise;
}
async function getDefaultToneClassifier() {
    const { inferenceClient } = await getInferenceClientModule();
    return (text) => inferenceClient.classifyTone(text);
}
async function getDefaultAbuseScorer() {
    const { inferenceClient } = await getInferenceClientModule();
    return (text) => inferenceClient.scoreAbuse(text);
}
async function getDefaultSentimentClassifier() {
    const { inferenceClient } = await getInferenceClientModule();
    return (text) => inferenceClient.classifySentiment(text);
}
async function getDefaultEmotionClassifier() {
    const { inferenceClient } = await getInferenceClientModule();
    return (text) => inferenceClient.classifyEmotion(text);
}
async function getDefaultTargetedToneClassifier() {
    const { inferenceClient } = await getInferenceClientModule();
    return (text, target) => inferenceClient.classifyTargetedTone(text, target);
}
async function getDefaultQualityClassifier() {
    const { inferenceClient } = await getInferenceClientModule();
    return (text) => inferenceClient.classifyComposerQuality(text);
}
function getAbuseSignal(abuse) {
    const label = abuse.label;
    if (label === 'threat') {
        return 'This reads as threatening or intimidating language — consider rephrasing before posting.';
    }
    if (label === 'identity_hate') {
        return 'This reads as identity-based abuse — consider rephrasing before posting.';
    }
    if (label === 'severe_toxic') {
        return 'This reads as severely abusive language — consider rephrasing before posting.';
    }
    if (label === 'obscene') {
        return 'This reads as abusive or obscene language — consider rephrasing before posting.';
    }
    if (label === 'insult') {
        return 'This reads as a personal insult — consider rephrasing before posting.';
    }
    return 'This reads as likely abusive or demeaning — consider rephrasing before posting.';
}
function shouldWarnFromAbuse(abuse) {
    if (!abuse)
        return false;
    if (abuse.score >= ABUSE_WARN_THRESHOLD)
        return true;
    return (abuse.scores.threat >= ABUSE_HIGH_SEVERITY_THRESHOLD
        || abuse.scores.identity_hate >= ABUSE_HIGH_SEVERITY_THRESHOLD
        || abuse.scores.severe_toxic >= ABUSE_HIGH_SEVERITY_THRESHOLD
        || abuse.scores.insult >= ABUSE_INSULT_THRESHOLD
        || abuse.scores.toxic >= ABUSE_TOXIC_THRESHOLD);
}
function mergeAbuseScore(sentiment, abuse) {
    if (!abuse || !shouldWarnFromAbuse(abuse) || sentiment.level === 'alert') {
        return sentiment;
    }
    return {
        ...sentiment,
        level: 'warn',
        signals: Array.from(new Set([
            ...sentiment.signals,
            getAbuseSignal(abuse),
        ])),
        constructiveSignals: [],
        supportiveReplySignals: [],
    };
}
function toComposerMLSignals(input) {
    const ml = {};
    if (input.sentiment) {
        ml.sentiment = {
            label: input.sentiment.label,
            confidence: input.sentiment.confidence,
        };
    }
    if (input.emotion) {
        ml.emotions = input.emotion.emotions;
    }
    if (input.targetedTone) {
        ml.targetedTone = {
            label: input.targetedTone.label,
            confidence: input.targetedTone.confidence,
        };
    }
    if (input.quality) {
        ml.conversationQuality = input.quality.scores;
    }
    return ml;
}
export function analyzeComposeToneImmediate(text, options = {}) {
    return {
        result: analyzeSentiment(text, options),
        toolsUsed: ['heuristic'],
        abuseScore: null,
        ml: {},
    };
}
export async function analyzeComposeTone(text, options = {}, dependencies = {}) {
    const toolsUsed = ['heuristic'];
    let result = analyzeSentiment(text, options);
    const trimmed = text.trim();
    const skipNuanceModels = result.level === 'alert' || result.hasMentalHealthCrisis;
    if (!skipNuanceModels && trimmed.length >= 6) {
        try {
            const classifyTone = dependencies.classifyTone ?? await getDefaultToneClassifier();
            result = await analyzeSentimentWithModel(text, options, classifyTone);
            toolsUsed.push('zero-shot-tone');
        }
        catch {
            result = analyzeSentiment(text, options);
        }
    }
    let abuseScore = null;
    if (trimmed.length >= 3) {
        try {
            const scoreAbuse = dependencies.scoreAbuse ?? await getDefaultAbuseScorer();
            abuseScore = await scoreAbuse(trimmed);
            result = mergeAbuseScore(result, abuseScore);
            toolsUsed.push('abuse-score');
        }
        catch {
            abuseScore = null;
        }
    }
    let sentiment = null;
    let emotion = null;
    let targetedTone = null;
    let quality = null;
    if (!skipNuanceModels && trimmed.length >= ML_MIN_LENGTH) {
        try {
            const classifySentiment = dependencies.classifySentiment ?? await getDefaultSentimentClassifier();
            sentiment = await classifySentiment(trimmed);
            toolsUsed.push('sentiment-polarity');
        }
        catch {
            sentiment = null;
        }
        try {
            const classifyEmotion = dependencies.classifyEmotion ?? await getDefaultEmotionClassifier();
            emotion = await classifyEmotion(trimmed);
            toolsUsed.push('emotion');
        }
        catch {
            emotion = null;
        }
        if (options.targetText?.trim()) {
            try {
                const classifyTargetedTone = dependencies.classifyTargetedTone ?? await getDefaultTargetedToneClassifier();
                targetedTone = await classifyTargetedTone(trimmed, options.targetText.trim());
                toolsUsed.push('targeted-sentiment');
            }
            catch {
                targetedTone = null;
            }
        }
        try {
            const classifyQuality = dependencies.classifyQuality ?? await getDefaultQualityClassifier();
            quality = await classifyQuality(trimmed);
            toolsUsed.push('quality-score');
        }
        catch {
            quality = null;
        }
    }
    return {
        result,
        toolsUsed,
        abuseScore,
        ml: toComposerMLSignals({
            sentiment,
            emotion,
            targetedTone,
            quality,
        }),
    };
}
//# sourceMappingURL=composeTonePipeline.js.map