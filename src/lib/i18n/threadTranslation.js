import { translationClient } from './client.js';
import { heuristicDetectLanguage } from './detect.js';
import { isLikelySameLanguage, normalizeTranslatableText } from './normalize.js';
function byId(results) {
    const out = {};
    for (const result of results)
        out[result.id] = result;
    return out;
}
export async function translateWriterInput(input) {
    const rootSourceLang = input.rootPost.sourceLang ?? heuristicDetectLanguage(input.rootPost.text).language;
    const selected = input.selectedComments.map(comment => ({
        ...comment,
        sourceLang: comment.sourceLang ?? heuristicDetectLanguage(comment.text).language,
    }));
    const itemsToTranslate = [
        { id: input.rootPost.id, sourceText: normalizeTranslatableText(input.rootPost.text), sourceLang: rootSourceLang },
        ...selected.map(comment => ({ id: comment.id, sourceText: normalizeTranslatableText(comment.text), sourceLang: comment.sourceLang })),
    ].filter(item => item.sourceText.length > 0)
        .filter(item => !isLikelySameLanguage(item.sourceLang ?? 'und', input.targetLang));
    let translatedById = {};
    if (itemsToTranslate.length > 0) {
        try {
            const batchRequest = {
                items: itemsToTranslate,
                targetLang: input.targetLang,
                mode: input.mode,
                visibility: 'writer_input',
            };
            const translated = await translationClient.translateBatch(batchRequest);
            translatedById = byId(translated);
        }
        catch {
            // Translation failures should never block writer flow.
        }
    }
    return {
        rootPost: {
            id: input.rootPost.id,
            text: input.rootPost.text,
            sourceLang: rootSourceLang,
            ...(typeof translatedById[input.rootPost.id]?.translatedText === 'string'
                ? { translatedText: translatedById[input.rootPost.id].translatedText }
                : {}),
        },
        selectedComments: selected.map(comment => ({
            id: comment.id,
            text: comment.text,
            sourceLang: comment.sourceLang ?? 'und',
            ...(typeof translatedById[comment.id]?.translatedText === 'string'
                ? { translatedText: translatedById[comment.id].translatedText }
                : {}),
        })),
    };
}
//# sourceMappingURL=threadTranslation.js.map