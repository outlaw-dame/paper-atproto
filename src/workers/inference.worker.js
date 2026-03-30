// ─── Inference Worker ─────────────────────────────────────────────────────
// All Transformers.js model calls run here, completely off the main UI thread.
// Composer guidance models are kept local-first and lazy-loaded on demand.
import { pipeline, env } from '@xenova/transformers';
// Clamp to single-threaded WASM. Multi-threaded ONNX requires SharedArrayBuffer
// which needs COOP+COEP headers — unavailable on GitHub Pages and iOS Safari
// without explicit server config. crossOriginIsolated is false in those envs,
// so we must not set numThreads > 1 or the ONNX backend will try to allocate
// a SAB and throw a DataCloneError when posting it back to the main thread.
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
env.localModelPath = '/models/';
// Detect mobile/low-memory environments. Workers have access to navigator.
// iOS Safari and Android Chrome both report touch UA strings.
const IS_MOBILE = /iphone|ipad|ipod|android/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');
// On mobile, serialize model loads so at most one large ONNX model is
// initializing at a time. Without this, triggering composer guidance can
// start 6+ model downloads/parses simultaneously, easily exceeding the
// iOS Safari per-tab WASM heap budget (~300-500 MB).
let modelLoadQueue = Promise.resolve();
function enqueueModelLoad(load) {
    if (!IS_MOBILE)
        return load();
    const next = modelLoadQueue.then(load);
    // Keep the chain alive even if one load fails, so subsequent loads still run.
    modelLoadQueue = next.catch(() => { });
    return next;
}
let extractor = null;
let captioner = null;
let toneClassifier = null;
let abuseClassifier = null;
let sentimentClassifier = null;
let emotionClassifier = null;
let targetedToneClassifier = null;
let qualityHead = null;
let modelStatus = 'idle';
let modelError = null;
let captionStatus = 'idle';
let captionError = null;
let toneStatus = 'idle';
let toneError = null;
let abuseStatus = 'idle';
let abuseError = null;
let sentimentStatus = 'idle';
let sentimentError = null;
let emotionStatus = 'idle';
let emotionError = null;
let targetedToneStatus = 'idle';
let targetedToneError = null;
let qualityStatus = 'idle';
let qualityError = null;
const TONE_MODEL_NAME = 'Xenova/nli-deberta-v3-xsmall';
const ABUSE_MODEL_NAME = 'Xenova/toxic-bert';
const ABUSE_MODEL_PROVIDER = 'xenova-toxic-bert';
const SENTIMENT_MODEL_NAME = 'Xenova/twitter-roberta-base-sentiment-latest';
const EMOTION_MODEL_NAME = 'cardiffnlp/twitter-roberta-base-emotion-latest-onnx';
const TARGETED_TONE_MODEL_NAME = 'cardiffnlp/twitter-roberta-base-topic-sentiment-latest-onnx';
const QUALITY_MODEL_NAME = 'local/composer-quality-setfit-head';
const QUALITY_MODEL_PROVIDER = 'setfit-linear-head';
const LOCAL_MODEL_ROOT = (env.localModelPath ?? '/models/').replace(/\/+$/, '/');
const TONE_LABELS = {
    hostile: 'hostile or insulting personal attack',
    supportive: 'supportive or empathetic response',
    constructive: 'constructive or solution-oriented feedback',
    positive: 'positive appreciation or encouragement',
    neutral: 'neutral or informational statement',
};
const TONE_LABEL_BY_TEXT = Object.fromEntries(Object.entries(TONE_LABELS).map(([key, label]) => [label, key]));
const ABUSE_LABELS = [
    'toxic',
    'insult',
    'obscene',
    'identity_hate',
    'threat',
    'severe_toxic',
];
const SENTIMENT_LABEL_ALIASES = {
    negative: 'negative',
    neutral: 'neutral',
    positive: 'positive',
    LABEL_0: 'negative',
    LABEL_1: 'neutral',
    LABEL_2: 'positive',
};
const EMOTION_LABELS = [
    'anger',
    'anticipation',
    'disgust',
    'fear',
    'joy',
    'love',
    'optimism',
    'pessimism',
    'sadness',
    'surprise',
    'trust',
];
const TARGETED_TONE_LABEL_ALIASES = {
    'strongly negative': 'strongly_negative',
    negative: 'negative',
    'negative or neutral': 'negative_or_neutral',
    positive: 'positive',
    'strongly positive': 'strongly_positive',
    LABEL_0: 'strongly_negative',
    LABEL_1: 'negative',
    LABEL_2: 'negative_or_neutral',
    LABEL_3: 'positive',
    LABEL_4: 'strongly_positive',
};
const QUALITY_LABELS = [
    'constructive',
    'supportive',
    'clarifying',
    'dismissive',
    'hostile',
    'escalating',
];
function localModelUrl(relativePath) {
    return `${LOCAL_MODEL_ROOT}${relativePath.replace(/^\/+/, '')}`;
}
async function waitForReady(getStatus, getError, message) {
    if (getStatus() !== 'loading')
        return;
    await new Promise((resolve, reject) => {
        const check = setInterval(() => {
            if (getStatus() === 'ready') {
                clearInterval(check);
                resolve();
            }
            if (getStatus() === 'error') {
                clearInterval(check);
                reject(new Error(getError() ?? message));
            }
        }, 100);
    });
}
async function ensureModel() {
    if (extractor)
        return;
    if (modelStatus === 'loading') {
        await waitForReady(() => modelStatus, () => modelError, 'Embedding model load failed');
        return;
    }
    modelStatus = 'loading';
    await enqueueModelLoad(async () => {
        try {
            extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
                quantized: true,
            });
            modelStatus = 'ready';
            self.postMessage({ id: '__system__', type: 'ready', result: { model: 'all-MiniLM-L6-v2' } });
        }
        catch (err) {
            modelStatus = 'error';
            modelError = err?.message ?? 'Unknown error';
            self.postMessage({ id: '__system__', type: 'error', error: modelError });
            throw err;
        }
    });
}
async function ensureCaptionModel() {
    if (captioner)
        return;
    if (captionStatus === 'loading') {
        await waitForReady(() => captionStatus, () => captionError, 'Caption model load failed');
        return;
    }
    captionStatus = 'loading';
    await enqueueModelLoad(async () => {
        try {
            captioner = await pipeline('image-to-text', 'Xenova/vit-gpt2-image-captioning', {
                quantized: true,
            });
            captionStatus = 'ready';
        }
        catch (err) {
            captionStatus = 'error';
            captionError = err?.message ?? 'Unknown caption model error';
            throw err;
        }
    });
}
async function ensureToneModel() {
    if (toneClassifier)
        return;
    if (toneStatus === 'loading') {
        await waitForReady(() => toneStatus, () => toneError, 'Tone model load failed');
        return;
    }
    toneStatus = 'loading';
    await enqueueModelLoad(async () => {
        try {
            toneClassifier = await pipeline('zero-shot-classification', TONE_MODEL_NAME, {
                quantized: true,
            });
            toneStatus = 'ready';
        }
        catch (err) {
            toneStatus = 'error';
            toneError = err?.message ?? 'Unknown tone model error';
            throw err;
        }
    });
}
async function ensureAbuseModel() {
    if (abuseClassifier)
        return;
    if (abuseStatus === 'loading') {
        await waitForReady(() => abuseStatus, () => abuseError, 'Abuse model load failed');
        return;
    }
    abuseStatus = 'loading';
    await enqueueModelLoad(async () => {
        try {
            abuseClassifier = await pipeline('text-classification', ABUSE_MODEL_NAME, {
                quantized: true,
            });
            abuseStatus = 'ready';
        }
        catch (err) {
            abuseStatus = 'error';
            abuseError = err?.message ?? 'Unknown abuse model error';
            throw err;
        }
    });
}
async function ensureSentimentModel() {
    if (sentimentClassifier)
        return;
    if (sentimentStatus === 'loading') {
        await waitForReady(() => sentimentStatus, () => sentimentError, 'Sentiment model load failed');
        return;
    }
    sentimentStatus = 'loading';
    await enqueueModelLoad(async () => {
        try {
            sentimentClassifier = await pipeline('text-classification', SENTIMENT_MODEL_NAME, {
                quantized: true,
            });
            sentimentStatus = 'ready';
        }
        catch (err) {
            sentimentStatus = 'error';
            sentimentError = err?.message ?? 'Unknown sentiment model error';
            throw err;
        }
    });
}
async function ensureEmotionModel() {
    if (emotionClassifier)
        return;
    if (emotionStatus === 'loading') {
        await waitForReady(() => emotionStatus, () => emotionError, 'Emotion model load failed');
        return;
    }
    emotionStatus = 'loading';
    await enqueueModelLoad(async () => {
        try {
            emotionClassifier = await pipeline('text-classification', EMOTION_MODEL_NAME, {
                quantized: true,
            });
            emotionStatus = 'ready';
        }
        catch (err) {
            emotionStatus = 'error';
            emotionError = err?.message ?? 'Unknown emotion model error';
            throw err;
        }
    });
}
async function ensureTargetedToneModel() {
    if (targetedToneClassifier)
        return;
    if (targetedToneStatus === 'loading') {
        await waitForReady(() => targetedToneStatus, () => targetedToneError, 'Targeted sentiment model load failed');
        return;
    }
    targetedToneStatus = 'loading';
    await enqueueModelLoad(async () => {
        try {
            targetedToneClassifier = await pipeline('text-classification', TARGETED_TONE_MODEL_NAME, {
                quantized: true,
            });
            targetedToneStatus = 'ready';
        }
        catch (err) {
            targetedToneStatus = 'error';
            targetedToneError = err?.message ?? 'Unknown targeted sentiment model error';
            throw err;
        }
    });
}
async function ensureQualityHead() {
    if (qualityHead)
        return;
    if (qualityStatus === 'loading') {
        await waitForReady(() => qualityStatus, () => qualityError, 'Quality classifier head load failed');
        return;
    }
    qualityStatus = 'loading';
    await enqueueModelLoad(async () => {
        try {
            const response = await fetch(localModelUrl(`${QUALITY_MODEL_NAME}/model.json`));
            if (!response.ok) {
                throw new Error(`Failed to fetch quality classifier head: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            if (!Array.isArray(data.labels)
                || !Array.isArray(data.coefficients)
                || !Array.isArray(data.intercepts)
                || typeof data.base_model !== 'string') {
                throw new Error('Quality classifier head is missing required fields');
            }
            qualityHead = {
                model: data.model ?? QUALITY_MODEL_NAME,
                provider: data.provider ?? QUALITY_MODEL_PROVIDER,
                base_model: data.base_model,
                normalize_embeddings: Boolean(data.normalize_embeddings),
                labels: data.labels,
                coefficients: data.coefficients,
                intercepts: data.intercepts,
            };
            qualityStatus = 'ready';
        }
        catch (err) {
            qualityStatus = 'error';
            qualityError = err?.message ?? 'Unknown quality model error';
            throw err;
        }
    });
}
function normalizeCaptionText(text) {
    const trimmed = text.trim();
    if (!trimmed)
        return '';
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
async function generateCaption(imageUrl) {
    await ensureCaptionModel();
    const output = await captioner(imageUrl, {
        max_new_tokens: 48,
    });
    const raw = Array.isArray(output)
        ? String(output[0]?.generated_text ?? '')
        : String(output?.generated_text ?? '');
    return normalizeCaptionText(raw);
}
async function generateEmbedding(text) {
    await ensureModel();
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
}
function createEmptyToneScores() {
    return {
        hostile: 0,
        supportive: 0,
        constructive: 0,
        positive: 0,
        neutral: 0,
    };
}
function createEmptyAbuseScores() {
    return {
        toxic: 0,
        insult: 0,
        obscene: 0,
        identity_hate: 0,
        threat: 0,
        severe_toxic: 0,
    };
}
function createEmptySentimentScores() {
    return {
        negative: 0,
        neutral: 0,
        positive: 0,
    };
}
function createEmptyEmotionScores() {
    return {
        anger: 0,
        anticipation: 0,
        disgust: 0,
        fear: 0,
        joy: 0,
        love: 0,
        optimism: 0,
        pessimism: 0,
        sadness: 0,
        surprise: 0,
        trust: 0,
    };
}
function createEmptyTargetedToneScores() {
    return {
        strongly_negative: 0,
        negative: 0,
        negative_or_neutral: 0,
        positive: 0,
        strongly_positive: 0,
    };
}
function createEmptyQualityScores() {
    return {
        constructive: 0,
        supportive: 0,
        clarifying: 0,
        dismissive: 0,
        hostile: 0,
        escalating: 0,
    };
}
function getStrongestToneLabel(scores) {
    let bestLabel = 'neutral';
    let bestScore = scores.neutral;
    Object.keys(scores).forEach((label) => {
        const score = scores[label];
        if (score > bestScore) {
            bestLabel = label;
            bestScore = score;
        }
    });
    return bestLabel;
}
function getStrongestAbuseLabel(scores) {
    let bestLabel = 'toxic';
    let bestScore = scores.toxic;
    ABUSE_LABELS.forEach((label) => {
        const score = scores[label];
        if (score > bestScore) {
            bestLabel = label;
            bestScore = score;
        }
    });
    return bestLabel;
}
function getStrongestSentimentLabel(scores) {
    let bestLabel = 'neutral';
    let bestScore = scores.neutral;
    Object.keys(scores).forEach((label) => {
        const score = scores[label];
        if (score > bestScore) {
            bestLabel = label;
            bestScore = score;
        }
    });
    return bestLabel;
}
function getStrongestTargetedToneLabel(scores) {
    let bestLabel = 'negative_or_neutral';
    let bestScore = scores.negative_or_neutral;
    Object.keys(scores).forEach((label) => {
        const score = scores[label];
        if (score > bestScore) {
            bestLabel = label;
            bestScore = score;
        }
    });
    return bestLabel;
}
function getStrongestQualityLabel(scores) {
    let bestLabel = 'clarifying';
    let bestScore = scores.clarifying;
    QUALITY_LABELS.forEach((label) => {
        const score = scores[label];
        if (score > bestScore) {
            bestLabel = label;
            bestScore = score;
        }
    });
    return bestLabel;
}
function computeAbuseScore(scores) {
    const weightedMax = Math.max(scores.toxic, scores.insult * 0.98, scores.obscene * 0.88, scores.identity_hate * 1.12, scores.threat * 1.2, scores.severe_toxic * 1.25);
    return Math.max(0, Math.min(1, weightedMax));
}
function softmax(logits) {
    const maxLogit = Math.max(...logits);
    const exps = logits.map((value) => Math.exp(value - maxLogit));
    const sum = exps.reduce((total, value) => total + value, 0) || 1;
    return exps.map((value) => value / sum);
}
function dotProduct(left, right) {
    const length = Math.min(left.length, right.length);
    let total = 0;
    for (let index = 0; index < length; index += 1) {
        total += left[index] * right[index];
    }
    return total;
}
function normalizeOutputRows(output) {
    if (Array.isArray(output)) {
        if (Array.isArray(output[0])) {
            return output[0];
        }
        return output;
    }
    return [output];
}
async function classifyTone(text) {
    await ensureToneModel();
    const output = await toneClassifier(text, Object.values(TONE_LABELS), {
        multi_label: true,
        hypothesis_template: 'This reply is {}.',
    });
    const scores = createEmptyToneScores();
    const labels = Array.isArray(output?.labels) ? output.labels : [];
    const values = Array.isArray(output?.scores) ? output.scores : [];
    labels.forEach((label, index) => {
        const key = TONE_LABEL_BY_TEXT[label];
        if (!key)
            return;
        scores[key] = Number(values[index] ?? 0);
    });
    return {
        model: TONE_MODEL_NAME,
        label: getStrongestToneLabel(scores),
        scores,
    };
}
async function scoreAbuse(text) {
    await ensureAbuseModel();
    const output = await abuseClassifier(text, {
        topk: null,
    });
    const scores = createEmptyAbuseScores();
    const rows = normalizeOutputRows(output);
    rows.forEach((row) => {
        const label = row?.label;
        if (!label || !ABUSE_LABELS.includes(label))
            return;
        scores[label] = Number(row.score ?? 0);
    });
    return {
        model: ABUSE_MODEL_NAME,
        provider: ABUSE_MODEL_PROVIDER,
        label: getStrongestAbuseLabel(scores),
        score: computeAbuseScore(scores),
        scores,
    };
}
async function classifySentiment(text) {
    await ensureSentimentModel();
    const output = await sentimentClassifier(text, {
        topk: null,
    });
    const rows = normalizeOutputRows(output);
    const scores = createEmptySentimentScores();
    rows.forEach((row) => {
        const label = typeof row?.label === 'string' ? SENTIMENT_LABEL_ALIASES[row.label] : undefined;
        if (!label)
            return;
        scores[label] = Number(row.score ?? 0);
    });
    const label = getStrongestSentimentLabel(scores);
    return {
        model: SENTIMENT_MODEL_NAME,
        label,
        confidence: scores[label],
        scores,
    };
}
async function classifyEmotion(text) {
    await ensureEmotionModel();
    const output = await emotionClassifier(text, {
        topk: null,
    });
    const rows = normalizeOutputRows(output);
    const scores = createEmptyEmotionScores();
    rows.forEach((row) => {
        const label = typeof row?.label === 'string' ? row.label.toLowerCase() : '';
        if (!EMOTION_LABELS.includes(label))
            return;
        scores[label] = Number(row.score ?? 0);
    });
    const emotions = EMOTION_LABELS
        .map((label) => ({ label, score: scores[label] }))
        .sort((left, right) => right.score - left.score);
    return {
        model: EMOTION_MODEL_NAME,
        emotions,
        scores,
    };
}
async function classifyTargetedTone(text, target) {
    await ensureTargetedToneModel();
    const textInput = `${text.trim()} </s> ${target.trim()}`;
    const output = await targetedToneClassifier(textInput, {
        topk: null,
    });
    const rows = normalizeOutputRows(output);
    const scores = createEmptyTargetedToneScores();
    rows.forEach((row) => {
        const label = typeof row?.label === 'string'
            ? TARGETED_TONE_LABEL_ALIASES[row.label]
            : undefined;
        if (!label)
            return;
        scores[label] = Number(row.score ?? 0);
    });
    const label = getStrongestTargetedToneLabel(scores);
    return {
        model: TARGETED_TONE_MODEL_NAME,
        target,
        label,
        confidence: scores[label],
        scores,
    };
}
async function classifyQuality(text) {
    await ensureQualityHead();
    if (!qualityHead) {
        throw new Error('Quality classifier head is unavailable');
    }
    const embedding = await generateEmbedding(text);
    const logits = qualityHead.coefficients.map((coefficients, index) => (dotProduct(coefficients, embedding) + Number(qualityHead?.intercepts[index] ?? 0)));
    const probabilities = softmax(logits);
    const scores = createEmptyQualityScores();
    qualityHead.labels.forEach((label, index) => {
        if (!QUALITY_LABELS.includes(label))
            return;
        scores[label] = Number(probabilities[index] ?? 0);
    });
    const label = getStrongestQualityLabel(scores);
    return {
        model: qualityHead.model,
        provider: qualityHead.provider,
        label,
        confidence: scores[label],
        scores,
    };
}
self.addEventListener('message', async (event) => {
    const { id, type, payload } = event.data;
    const reply = { id, type };
    try {
        if (type === 'status') {
            reply.result = {
                status: modelStatus,
                error: modelError,
                captionStatus,
                captionError,
                toneStatus,
                toneError,
                abuseStatus,
                abuseError,
                sentimentStatus,
                sentimentError,
                emotionStatus,
                emotionError,
                targetedToneStatus,
                targetedToneError,
                qualityStatus,
                qualityError,
            };
            self.postMessage(reply);
            return;
        }
        if (type === 'embed') {
            const text = payload?.text ?? '';
            if (!text.trim()) {
                reply.result = { embedding: [] };
            }
            else {
                const embedding = await generateEmbedding(text);
                reply.result = { embedding };
            }
            self.postMessage(reply);
            return;
        }
        if (type === 'embed_batch') {
            const texts = payload?.texts ?? [];
            const embeddings = await Promise.all(texts.map((text) => (text.trim() ? generateEmbedding(text) : Promise.resolve([]))));
            reply.result = { embeddings };
            self.postMessage(reply);
            return;
        }
        if (type === 'caption_image') {
            const imageUrl = payload?.imageUrl ?? '';
            if (!imageUrl.trim()) {
                reply.error = 'Missing imageUrl payload';
            }
            else {
                const caption = await generateCaption(imageUrl);
                reply.result = { caption };
            }
            self.postMessage(reply);
            return;
        }
        if (type === 'classify_tone') {
            const text = payload?.text ?? '';
            if (!text.trim()) {
                reply.result = {
                    tone: {
                        model: TONE_MODEL_NAME,
                        label: 'neutral',
                        scores: createEmptyToneScores(),
                    },
                };
            }
            else {
                reply.result = { tone: await classifyTone(text) };
            }
            self.postMessage(reply);
            return;
        }
        if (type === 'score_abuse') {
            const text = payload?.text ?? '';
            if (!text.trim()) {
                reply.result = {
                    abuse: {
                        model: ABUSE_MODEL_NAME,
                        provider: ABUSE_MODEL_PROVIDER,
                        label: 'toxic',
                        score: 0,
                        scores: createEmptyAbuseScores(),
                    },
                };
            }
            else {
                reply.result = { abuse: await scoreAbuse(text) };
            }
            self.postMessage(reply);
            return;
        }
        if (type === 'classify_sentiment') {
            const text = payload?.text ?? '';
            if (!text.trim()) {
                reply.result = {
                    sentiment: {
                        model: SENTIMENT_MODEL_NAME,
                        label: 'neutral',
                        confidence: 0,
                        scores: createEmptySentimentScores(),
                    },
                };
            }
            else {
                reply.result = { sentiment: await classifySentiment(text) };
            }
            self.postMessage(reply);
            return;
        }
        if (type === 'classify_emotion') {
            const text = payload?.text ?? '';
            if (!text.trim()) {
                reply.result = {
                    emotion: {
                        model: EMOTION_MODEL_NAME,
                        emotions: [],
                        scores: createEmptyEmotionScores(),
                    },
                };
            }
            else {
                reply.result = { emotion: await classifyEmotion(text) };
            }
            self.postMessage(reply);
            return;
        }
        if (type === 'classify_targeted_tone') {
            const text = payload?.text ?? '';
            const target = payload?.target ?? '';
            if (!text.trim() || !target.trim()) {
                reply.result = {
                    targetedTone: {
                        model: TARGETED_TONE_MODEL_NAME,
                        target,
                        label: 'negative_or_neutral',
                        confidence: 0,
                        scores: createEmptyTargetedToneScores(),
                    },
                };
            }
            else {
                reply.result = { targetedTone: await classifyTargetedTone(text, target) };
            }
            self.postMessage(reply);
            return;
        }
        if (type === 'classify_quality') {
            const text = payload?.text ?? '';
            if (!text.trim()) {
                reply.result = {
                    quality: {
                        model: QUALITY_MODEL_NAME,
                        provider: QUALITY_MODEL_PROVIDER,
                        label: 'clarifying',
                        confidence: 0,
                        scores: createEmptyQualityScores(),
                    },
                };
            }
            else {
                reply.result = { quality: await classifyQuality(text) };
            }
            self.postMessage(reply);
            return;
        }
        reply.error = `Unknown message type: ${type}`;
        self.postMessage(reply);
    }
    catch (err) {
        reply.error = err?.message ?? 'Worker error';
        self.postMessage(reply);
    }
});
//# sourceMappingURL=inference.worker.js.map