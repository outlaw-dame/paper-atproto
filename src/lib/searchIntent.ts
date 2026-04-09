const VISUAL_INTENT_KEYWORDS = [
  'meme',
  'screenshot',
  'video',
  'image',
  'photo',
  'picture',
  'illustration',
  'chart',
  'graph',
  'diagram',
  'visual',
  'design',
  'art',
  'artwork',
  'drawing',
  'sketch',
  'screengrab',
  'thumbnail',
];

export function detectVisualIntent(rawQuery: string): boolean {
  const normalizedQuery = rawQuery.toLowerCase();
  return VISUAL_INTENT_KEYWORDS.some((keyword) => normalizedQuery.includes(keyword));
}
