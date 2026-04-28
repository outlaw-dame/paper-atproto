// ─── Media Input Builder — Narwhal v3 ─────────────────────────────────────
// Selects media items from a thread and builds MediaAnalysisRequests.
// Also merges returned MediaAnalysisResult back into WriterMediaFindings.

import type { MediaAnalysisRequest, WriterMediaFinding, MediaAnalysisResult } from './llmContracts';
import type { ThreadNode } from '../lib/resolver/atproto';
import type { ContributionScores } from './interpolatorTypes';
import { sanitizeUrlForProcessing } from '../lib/safety/externalUrl';
import { computeMultimodalScore, type MultimodalSignals } from './routing';

interface MediaSelectionOptions {
  nearbyTextByUri?: Record<string, string | undefined>;
  candidateEntities?: string[];
  factualHints?: string[];
}

function sanitizeContextText(value: string | undefined, maxLen: number): string {
  return (value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function pushUniqueCaseInsensitive(target: string[], value: string, maxItems: number): void {
  const normalized = sanitizeContextText(value, 120);
  if (!normalized) return;
  if (target.some((entry) => entry.toLowerCase() === normalized.toLowerCase())) return;
  if (target.length >= maxItems) return;
  target.push(normalized);
}

function extractPrimaryMedia(node: ThreadNode): { url: string; alt?: string } | null {
  if (node.embed?.kind === 'images') {
    const image = node.embed.images?.[0];
    if (image?.url) {
      return {
        url: image.url,
        ...(image.alt ? { alt: image.alt } : {}),
      };
    }
  }

  if (node.embed?.kind === 'recordWithMedia') {
    const image = node.embed.mediaImages?.[0];
    if (image?.url) {
      return {
        url: image.url,
        ...(image.alt ? { alt: image.alt } : {}),
      };
    }
  }

  return null;
}

function translatedNearbyText(
  node: ThreadNode,
  nearbyTextByUri: Record<string, string | undefined> | undefined,
): string {
  const translated = nearbyTextByUri?.[node.uri];
  return sanitizeContextText(translated ?? node.text, 300);
}

export function deriveMediaCandidateEntities(
  root: ThreadNode,
  replies: ThreadNode[],
  scores: Record<string, ContributionScores>,
): string[] {
  const entities: string[] = [];
  const seededReplies = [...replies]
    .sort((left, right) => (
      (scores[right.uri]?.finalInfluenceScore ?? scores[right.uri]?.usefulnessScore ?? 0)
      - (scores[left.uri]?.finalInfluenceScore ?? scores[left.uri]?.usefulnessScore ?? 0)
    ))
    .slice(0, 3);

  for (const text of [root.text, ...seededReplies.map((reply) => reply.text)]) {
    const matches = text.match(/[A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+){0,3}/g) ?? [];
    for (const match of matches) {
      pushUniqueCaseInsensitive(entities, match, 8);
      if (entities.length >= 8) return entities;
    }
  }

  return entities;
}

export function deriveMediaFactualHints(
  replies: ThreadNode[],
  scores: Record<string, ContributionScores>,
): string[] {
  const hints: string[] = [];

  const sourcedReplies = [...replies]
    .filter((reply) => {
      const score = scores[reply.uri];
      if (!score) return false;
      return (
        score.role === 'source_bringer'
        || score.role === 'rule_source'
        || score.sourceSupport >= 0.55
        || score.evidenceSignals.some((signal) => signal.kind === 'citation')
        || ['well-supported', 'source-backed-clarification', 'partially-supported'].includes(
          score.factual?.factualState ?? '',
        )
      );
    })
    .sort((left, right) => (
      (scores[right.uri]?.finalInfluenceScore ?? scores[right.uri]?.usefulnessScore ?? 0)
      - (scores[left.uri]?.finalInfluenceScore ?? scores[left.uri]?.usefulnessScore ?? 0)
    ))
    .slice(0, 4);

  for (const reply of sourcedReplies) {
    pushUniqueCaseInsensitive(hints, reply.text, 5);
    if (hints.length >= 5) break;
  }

  return hints;
}

// ─── detectMediaSignals ───────────────────────────────────────────────────
// Compute multimodal routing signals from the resolved thread.

export function detectMediaSignals(
  root: ThreadNode,
  replies: ThreadNode[],
  scores: Record<string, ContributionScores>,
): MultimodalSignals {
  const rootHasMedia = (root.embed?.kind === 'images' || root.embed?.kind === 'recordWithMedia') ? 1 : 0;
  const replyMediaCount = replies.filter(r =>
    r.embed?.kind === 'images' || r.embed?.kind === 'recordWithMedia'
  ).length;
  const hasMedia = rootHasMedia || (replyMediaCount > 0 ? Math.min(1, replyMediaCount / 3) : 0);

  // Media text density: images with alt text that looks like screenshots
  const screenshotKeywords = /screenshot|screen shot|screencap|document|chart|graph|table|rule|policy|article/i;
  const textDensityCount = [root, ...replies].filter(n => {
    const alt = n.embed?.images?.[0]?.alt ?? '';
    return screenshotKeywords.test(alt) || screenshotKeywords.test(n.text);
  }).length;
  const mediaTextDensity = Math.min(1, textDensityCount / 5);

  // Media reference density: replies that say "this image", "the screenshot", etc.
  const mediaRefKeywords = /this (image|screenshot|photo|chart|graph|document|picture|clip)/i;
  const mediaRefCount = replies.filter(r => mediaRefKeywords.test(r.text)).length;
  const mediaReferenceDensity = Math.min(1, mediaRefCount / (replies.length + 1));

  // Media claim dependency: root text is short + has media (claim lives in the image)
  const rootTextShort = root.text.trim().length < 80;
  const mediaClaimDependency = rootHasMedia && rootTextShort ? 0.8 : 0;

  // Verification flag: any score has mediaContextConfidence > 0.3 from phase 3
  const hasMediaFlag = Object.values(scores).some(s => (s.factual?.mediaContextConfidence ?? 0) > 0.3) ? 1 : 0;

  // Non-text signal gap: low surface confidence + has media
  const avgScore = Object.values(scores).reduce((sum, s) => sum + s.finalInfluenceScore, 0) / (Object.values(scores).length + 1);
  const nonTextSignalGap = hasMedia > 0 && avgScore < 0.4 ? 0.6 : 0;

  return {
    hasMedia,
    mediaTextDensity,
    mediaReferenceDensity,
    mediaClaimDependency,
    mediaVerificationFlag: hasMediaFlag,
    nonTextSignalGap,
  };
}

// ─── selectMediaForAnalysis ───────────────────────────────────────────────
// Returns up to 2 media items worth analyzing (root first, then high-impact reply).

export function selectMediaForAnalysis(
  threadId: string,
  root: ThreadNode,
  replies: ThreadNode[],
  scores: Record<string, ContributionScores>,
  options: MediaSelectionOptions = {},
): MediaAnalysisRequest[] {
  const requests: MediaAnalysisRequest[] = [];
  const seenUrls = new Set<string>();
  const candidateEntities = (options.candidateEntities?.length ? options.candidateEntities : deriveMediaCandidateEntities(root, replies, scores))
    .map((value) => sanitizeContextText(value, 80))
    .filter(Boolean)
    .slice(0, 8);
  const factualHints = (options.factualHints?.length ? options.factualHints : deriveMediaFactualHints(replies, scores))
    .map((value) => sanitizeContextText(value, 120))
    .filter(Boolean)
    .slice(0, 5);

  // Root media
  const rootMedia = extractPrimaryMedia(root);
  const rootMediaUrl = rootMedia?.url ? sanitizeUrlForProcessing(rootMedia.url) : null;
  if (rootMediaUrl) {
    const req: MediaAnalysisRequest = {
      threadId: sanitizeContextText(threadId, 300),
      mediaUrl: rootMediaUrl,
      nearbyText: translatedNearbyText(root, options.nearbyTextByUri),
      candidateEntities,
      factualHints,
    };
    if (rootMedia?.alt) req.mediaAlt = sanitizeContextText(rootMedia.alt, 300);
    requests.push(req);
    seenUrls.add(rootMediaUrl);
  }

  // Highest-impact reply with media (if different from root)
  if (requests.length < 2) {
    const replyWithMedia = [...replies]
      .filter((reply) => extractPrimaryMedia(reply)?.url)
      .sort((a, b) => (
        (scores[b.uri]?.finalInfluenceScore ?? scores[b.uri]?.usefulnessScore ?? 0)
        - (scores[a.uri]?.finalInfluenceScore ?? scores[a.uri]?.usefulnessScore ?? 0)
      ));

    for (const reply of replyWithMedia) {
      const media = extractPrimaryMedia(reply);
      const mediaUrl = media?.url ? sanitizeUrlForProcessing(media.url) : null;
      if (!mediaUrl || seenUrls.has(mediaUrl)) continue;

      const req: MediaAnalysisRequest = {
        threadId: sanitizeContextText(threadId, 300),
        mediaUrl,
        nearbyText: translatedNearbyText(reply, options.nearbyTextByUri),
        candidateEntities,
        factualHints,
      };
      if (media?.alt) req.mediaAlt = sanitizeContextText(media.alt, 300);
      requests.push(req);
      break;
    }
  }

  return requests;
}

// ─── mergeMediaResults ────────────────────────────────────────────────────
// Converts MediaAnalysisResult array into WriterMediaFindings for thread state.

export function mergeMediaResults(results: MediaAnalysisResult[]): WriterMediaFinding[] {
  return results
    .filter(r => r.confidence >= 0.35)
    .map(r => {
      const finding: WriterMediaFinding = {
        mediaType: r.mediaType,
        summary: r.mediaSummary,
        confidence: r.confidence,
      };
      if (r.extractedText) finding.extractedText = r.extractedText;
      if (r.cautionFlags.length > 0) finding.cautionFlags = r.cautionFlags;
      if (r.analysisStatus) finding.analysisStatus = r.analysisStatus;
      if (r.moderationStatus) finding.moderationStatus = r.moderationStatus;
      return finding;
    });
}

// ─── Re-export shouldRunMultimodal for convenience ────────────────────────
export { computeMultimodalScore, shouldRunMultimodal } from './routing';
