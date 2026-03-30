function describeMatchKinds(matchKinds) {
    const hasKeyword = matchKinds.has('keyword');
    const hasSemantic = matchKinds.has('semantic');
    if (hasKeyword && hasSemantic)
        return 'exact + semantic';
    if (hasSemantic)
        return 'semantic';
    return 'exact';
}
export function warnMatchLabels(matches) {
    return warnMatchReasons(matches).map((entry) => `${entry.phrase} (${entry.reason.replace('+', ' + ')})`);
}
export function warnMatchReasons(matches) {
    const phraseKinds = new Map();
    for (const match of matches) {
        if (match.action !== 'warn')
            continue;
        const phrase = match.phrase.trim();
        if (!phrase)
            continue;
        const existing = phraseKinds.get(phrase) ?? new Set();
        existing.add(match.matchType);
        phraseKinds.set(phrase, existing);
    }
    return [...phraseKinds.entries()].map(([phrase, kinds]) => {
        const kind = describeMatchKinds(kinds);
        if (kind === 'semantic') {
            return { phrase, reason: 'semantic' };
        }
        if (kind === 'exact + semantic') {
            return { phrase, reason: 'exact+semantic' };
        }
        return { phrase, reason: 'exact' };
    });
}
//# sourceMappingURL=presentation.js.map