export function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function contentUnionToText(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (!entry || typeof entry !== 'object') return '';
        const obj = entry as Record<string, unknown>;
        return asTrimmedString(obj.text) || asTrimmedString(obj.body) || asTrimmedString(obj.markdown);
      })
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }
  if (typeof content === 'object') {
    const obj = content as Record<string, unknown>;
    return (asTrimmedString(obj.text) || asTrimmedString(obj.body) || asTrimmedString(obj.markdown)).trim();
  }
  return '';
}

export function extractRecordBody(record: unknown): string {
  if (!record || typeof record !== 'object') return '';
  const obj = record as Record<string, unknown>;
  return (
    asTrimmedString(obj.text) ||
    asTrimmedString(obj.body) ||
    asTrimmedString(obj.textContent) ||
    contentUnionToText(obj.content)
  ).trim();
}

export function extractRecordDisplayText(record: unknown): string {
  if (!record || typeof record !== 'object') return '';
  const obj = record as Record<string, unknown>;
  const title = asTrimmedString(obj.title);
  const subtitle = asTrimmedString(obj.subtitle) || asTrimmedString(obj.description);
  const body = extractRecordBody(obj);
  return [title, subtitle, body].filter(Boolean).join('\n\n').trim();
}

// Returns whether a raw ATProto record has user-visible text we can render.
export function hasDisplayableRecordContent(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false;
  const obj = record as Record<string, unknown>;
  if (asTrimmedString(obj.text).length > 0) return true;
  if (asTrimmedString(obj.body).length > 0) return true;
  if (asTrimmedString(obj.textContent).length > 0) return true;
  if (asTrimmedString(obj.content).length > 0) return true;
  if (contentUnionToText(obj.content).length > 0) return true;
  if (asTrimmedString(obj.subtitle).length > 0) return true;
  if (asTrimmedString(obj.description).length > 0) return true;
  if (asTrimmedString(obj.title).length > 0) return true;
  return false;
}