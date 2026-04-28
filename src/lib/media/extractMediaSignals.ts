/**
 * Media Signal Extraction
 * 
 * Extracts media metadata from ATProto embeds for indexing and ranking.
 * Used by both sync (indexing) and search (ranking boost) pipelines.
 */

export interface MediaSignals {
  hasImages: boolean;
  hasVideo: boolean;
  hasLink: boolean;
  imageAltText: string; // Concatenated ALT texts
  imageCount: number;
}

export interface AtprotoEmbed {
  $type?: string;
  images?: Array<{ image?: { mimeType?: string }; alt?: string }>;
  video?: { video?: { mimeType?: string } };
  external?: { uri?: string; title?: string; description?: string };
  quote?: Record<string, any>;
  record?: Record<string, any>;
  media?: AtprotoEmbed | null;
}

function emptyMediaSignals(): MediaSignals {
  return {
    hasImages: false,
    hasVideo: false,
    hasLink: false,
    imageAltText: '',
    imageCount: 0,
  };
}

function collectImageEntries(embed: AtprotoEmbed): Array<{ alt?: string }> {
  const topLevel = Array.isArray(embed.images) ? embed.images : [];
  const nestedMedia = embed.media && typeof embed.media === 'object' ? embed.media : null;
  const nested = nestedMedia && Array.isArray(nestedMedia.images) ? nestedMedia.images : [];
  return [...topLevel, ...nested];
}

function readRecordUri(record: unknown): string {
  if (!record || typeof record !== 'object') return '';
  const uri = (record as { uri?: unknown }).uri;
  return typeof uri === 'string' ? uri.trim() : '';
}

function readExternalUri(external: unknown): string {
  if (!external || typeof external !== 'object') return '';
  const uri = (external as { uri?: unknown }).uri;
  return typeof uri === 'string' ? uri.trim() : '';
}

function hasVideoPayload(embed: AtprotoEmbed | null | undefined): boolean {
  if (!embed || typeof embed !== 'object') return false;
  if (embed.video && typeof embed.video === 'object') return true;
  if (typeof embed.$type === 'string' && embed.$type.includes('.video')) return true;
  return hasVideoPayload(embed.media ?? null);
}

/**
 * Extract media signals from an ATProto embed object.
 * Safe to call with null/undefined embed.
 */
export function extractMediaSignals(embed: AtprotoEmbed | null | undefined): MediaSignals {
  if (!embed) {
    return emptyMediaSignals();
  }

  const imageEntries = collectImageEntries(embed);
  const hasImages = imageEntries.length > 0;
  const imageCount = imageEntries.length;

  // Concatenate all ALT texts
  const imageAltText = imageEntries
    ?.map((img) => img.alt?.trim() || '')
    .filter((alt) => alt.length > 0)
    .join(' | ')
    .slice(0, 2000) || ''; // Cap at 2000 chars to avoid bloating index

  const hasVideo = hasVideoPayload(embed);

  const media = embed.media && typeof embed.media === 'object' ? embed.media : null;
  const topLevelExternalUri = readExternalUri(embed.external);
  const nestedExternalUri = readExternalUri(media?.external);
  const recordUri = readRecordUri(embed.record) || readRecordUri(media?.record);

  // Link detection: external card, quote-post, or record-with-media quote target.
  const hasLink =
    topLevelExternalUri.length > 0 ||
    nestedExternalUri.length > 0 ||
    recordUri.length > 0 ||
    !!(embed.quote && embed.record);

  return {
    hasImages,
    hasVideo,
    hasLink,
    imageAltText,
    imageCount,
  };
}

/**
 * Extract media signals from post embed JSON string.
 * Safely parses embed if it's a string, returns defaults on error.
 */
export function extractMediaSignalsFromJson(
  embedJson: string | null | undefined,
): MediaSignals {
  if (!embedJson) {
    return emptyMediaSignals();
  }

  try {
    const embed = JSON.parse(embedJson) as AtprotoEmbed;
    return extractMediaSignals(embed);
  } catch (err) {
    console.warn('[extractMediaSignalsFromJson] Failed to parse embed:', err);
    return emptyMediaSignals();
  }
}

/**
 * Compute a media boost factor for RRF fusion.
 * Applied when search query indicates visual/media intent.
 * 
 * Example usage in search():
 *   const mediaBoost = hasImages && queryIsVisual ? 1.15 : 1.0;
 *   finalScore = baseRrfScore * mediaBoost;
 */
export function getMediaBoostFactor(
  mediaSignals: MediaSignals,
  queryHasVisualIntent: boolean,
): number {
  if (!queryHasVisualIntent) return 1.0; // No boost for text-only queries

  let boost = 1;
  if (mediaSignals.hasImages) {
    boost += 0.12 + Math.min(mediaSignals.imageCount, 4) * 0.015;
  }
  if (mediaSignals.hasVideo) {
    boost += 0.16;
  }
  if (mediaSignals.hasLink) {
    boost += 0.04;
  }
  if (mediaSignals.imageAltText.trim().length > 0) {
    boost += 0.02;
  }
  return Math.min(1.28, Math.round(boost * 1000) / 1000);
}
