import { normalizeLanguageTag } from './normalize.js';
const cjkRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;
const arabicRegex = /[\u0600-\u06ff]/;
const cyrillicRegex = /[\u0400-\u04ff]/;
const latinRegex = /[a-z]/i;
const ptRegex = /[ãõáàâêôç]/i;
const esRegex = /[ñ¡¿]/i;
const frRegex = /[àâæçéèêëîïôœùûüÿ]/i;
const deRegex = /[äöüß]/i;
const latinHints = [
    { language: 'pt', strongRegex: ptRegex, tokens: [' nao ', ' não ', ' que ', ' para ', ' com ', ' uma ', ' os ', ' as ', ' dos ', ' das ', ' isso ', ' voces ', ' vocês ', ' porque ', ' mais '] },
    { language: 'es', strongRegex: esRegex, tokens: [' que ', ' para ', ' una ', ' pero ', ' como ', ' los ', ' las ', ' del ', ' por ', ' gracias ', ' este ', ' esta ', ' estoy ', ' tienes '] },
    { language: 'fr', strongRegex: frRegex, tokens: [' le ', ' la ', ' les ', ' des ', ' une ', ' pour ', ' avec ', ' est ', ' dans ', ' pas ', ' plus ', ' vous ', ' nous ', ' sur '] },
    { language: 'de', strongRegex: deRegex, tokens: [' der ', ' die ', ' das ', ' und ', ' nicht ', ' ist ', ' ich ', ' mit ', ' für ', ' ein ', ' eine ', ' auf ', ' zu '] },
    { language: 'en', tokens: [' the ', ' and ', ' you ', ' are ', ' with ', ' that ', ' this ', ' have ', ' for ', ' not ', ' but ', ' was ', ' your ', ' they '] },
];
function detectLatinLanguage(content) {
    const lower = ` ${content.toLocaleLowerCase()} `;
    let best = null;
    let runnerUp = 0;
    for (const hint of latinHints) {
        let score = 0;
        if (hint.strongRegex?.test(lower))
            score += 3;
        for (const token of hint.tokens) {
            if (lower.includes(token))
                score += 1;
        }
        if (!best || score > best.score) {
            runnerUp = best?.score ?? 0;
            best = { language: hint.language, score };
        }
        else if (score > runnerUp) {
            runnerUp = score;
        }
    }
    if (best && best.score >= 2 && best.score > runnerUp) {
        return { language: best.language, confidence: Math.min(0.92, 0.45 + best.score * 0.08) };
    }
    return { language: 'en', confidence: 0.35 };
}
export function heuristicDetectLanguage(text) {
    const content = text.trim();
    if (!content)
        return { language: 'und', confidence: 0 };
    if (cjkRegex.test(content))
        return { language: 'ja', confidence: 0.65 };
    if (arabicRegex.test(content))
        return { language: 'ar', confidence: 0.8 };
    if (cyrillicRegex.test(content))
        return { language: 'ru', confidence: 0.75 };
    if (latinRegex.test(content))
        return detectLatinLanguage(content);
    return { language: 'und', confidence: 0.1 };
}
export function normalizeDetectionResult(result) {
    return {
        language: normalizeLanguageTag(result.language),
        confidence: Math.max(0, Math.min(1, result.confidence)),
    };
}
//# sourceMappingURL=detect.js.map