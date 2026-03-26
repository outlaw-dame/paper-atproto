const HASHTAG_REGEX = /#([\p{L}\p{N}_]+)/gu;

type HashtagToken = {
  openMarker: string;
  closeMarker: string;
  originalTag: string;
};

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitHashtagWords(body: string): string {
  return body
    .replace(/_/g, ' ')
    .replace(/([\p{Ll}\d])([\p{Lu}])/gu, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTranslatedTagBody(body: string): string {
  return body
    .trim()
    .replace(/^[^\p{L}\p{N}]+/gu, '')
    .replace(/[^\p{L}\p{N}]+$/gu, '')
    .replace(/\s+/g, '_');
}

export function prepareHashtagsForTranslation(text: string): { text: string; tokens: HashtagToken[] } {
  const tokens: HashtagToken[] = [];
  const prepared = text.replace(HASHTAG_REGEX, (fullTag, body: string) => {
    const expandedBody = splitHashtagWords(body);
    if (!expandedBody) return fullTag;

    const tokenIndex = tokens.length;
    const openMarker = `ZXQHT${tokenIndex}STARTZXQ`;
    const closeMarker = `ZXQHT${tokenIndex}ENDZXQ`;
    tokens.push({
      openMarker,
      closeMarker,
      originalTag: fullTag,
    });

    return `${openMarker} ${expandedBody} ${closeMarker}`;
  });

  return { text: prepared, tokens };
}

export function restoreTranslatedHashtags(text: string, tokens: HashtagToken[]): string {
  let restored = text;

  for (const token of tokens) {
    const wrappedPattern = new RegExp(
      `${escapeRegExp(token.openMarker)}\\s*([\\s\\S]*?)\\s*${escapeRegExp(token.closeMarker)}`,
      'g',
    );

    restored = restored.replace(wrappedPattern, (_, translatedBody: string) => {
      const normalizedBody = normalizeTranslatedTagBody(translatedBody);
      return normalizedBody ? `#${normalizedBody}` : token.originalTag;
    });

    restored = restored
      .replace(new RegExp(escapeRegExp(token.openMarker), 'g'), '')
      .replace(new RegExp(escapeRegExp(token.closeMarker), 'g'), '');
  }

  return restored;
}