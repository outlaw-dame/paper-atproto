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
  images?: Array<{ image?: { mimeType?: string }; alt?: string }>;
  video?: { video?: { mimeType?: string } };
  external?: { uri?: string; title?: string; description?: string };
  quote?: Record<string, any>;
  record?: Record<string, any>;
}

/**
 * Extract media signals from an ATProto embed object.
 * Safe to call with null/undefined embed.
 */
export function extractMediaSignals(embed: AtprotoEmbed | null | undefined): MediaSignals {
  if (!embed) {
    return {
      hasImages: false,
      hasVideo: false,
      hasLink: false,
      imageAltText: '',
      imageCount: 0,
    };
  }

  const hasImages = !!(embed.images && embed.images.length > 0);
  const imageCount = embed.images?.length ?? 0;
  
  // Concatenate all ALT texts
  const imageAltText = embed.images
    ?.map((img) => img.alt?.trim() || '')
    .filter((alt) => alt.length > 0)
    .join(' | ')
    .slice(0, 2000) || ''; // Cap at 2000 chars to avoid bloating index

  const hasVideo = !!(embed.video);
  
  // Link detection: external card or quote-post
  const hasLink =
    !!(embed.external && embed.external.uri) ||
    !!(embed.quote && embed.record); // Quote posts contain linked record

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
    return {
      hasImages: false,
      hasVideo: false,
      hasLink: false,
      imageAltText: '',
      imageCount: 0,
    };
  }

  try {
    const embed = JSON.parse(embedJson) as AtprotoEmbed;
    return extractMediaSignals(embed);
  } catch (err) {
    console.warn('[extractMediaSignalsFromJson] Failed to parse embed:', err);
    return {
      hasImages: false,
      hasVideo: false,
      hasLink: false,
      imageAltText: '',
      imageCount: 0,
    };
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

  // Boost posts with images if query suggests visual content
  if (mediaSignals.hasImages) {
    return 1.15; // 15% boost for posts with media
  }

  return 1.0;
}
