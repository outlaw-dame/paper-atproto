export function asTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
export function contentUnionToText(content) {
    if (!content)
        return '';
    if (typeof content === 'string')
        return content.trim();
    if (Array.isArray(content)) {
        return content
            .map((entry) => {
            if (typeof entry === 'string')
                return entry;
            if (!entry || typeof entry !== 'object')
                return '';
            const obj = entry;
            return asTrimmedString(obj.text) || asTrimmedString(obj.body) || asTrimmedString(obj.markdown);
        })
            .filter(Boolean)
            .join('\n\n')
            .trim();
    }
    if (typeof content === 'object') {
        const obj = content;
        return (asTrimmedString(obj.text) || asTrimmedString(obj.body) || asTrimmedString(obj.markdown)).trim();
    }
    return '';
}
export function extractRecordBody(record) {
    if (!record || typeof record !== 'object')
        return '';
    const obj = record;
    return (asTrimmedString(obj.text) ||
        asTrimmedString(obj.body) ||
        asTrimmedString(obj.textContent) ||
        contentUnionToText(obj.content)).trim();
}
export function extractRecordDisplayText(record) {
    if (!record || typeof record !== 'object')
        return '';
    const obj = record;
    const title = asTrimmedString(obj.title);
    const subtitle = asTrimmedString(obj.subtitle) || asTrimmedString(obj.description);
    const body = extractRecordBody(obj);
    return [title, subtitle, body].filter(Boolean).join('\n\n').trim();
}
// Returns whether a raw ATProto record has user-visible text we can render.
export function hasDisplayableRecordContent(record) {
    if (!record || typeof record !== 'object')
        return false;
    const obj = record;
    if (asTrimmedString(obj.text).length > 0)
        return true;
    if (asTrimmedString(obj.body).length > 0)
        return true;
    if (asTrimmedString(obj.textContent).length > 0)
        return true;
    if (asTrimmedString(obj.content).length > 0)
        return true;
    if (contentUnionToText(obj.content).length > 0)
        return true;
    if (asTrimmedString(obj.subtitle).length > 0)
        return true;
    if (asTrimmedString(obj.description).length > 0)
        return true;
    if (asTrimmedString(obj.title).length > 0)
        return true;
    return false;
}
//# sourceMappingURL=recordContent.js.map