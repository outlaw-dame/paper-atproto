// ─── Media Input Builder — Narwhal v3 ─────────────────────────────────────
// Selects media items from a thread and builds MediaAnalysisRequests.
// Also merges returned MediaAnalysisResult back into WriterMediaFindings.

import type { MediaAnalysisRequest, WriterMediaFinding, MediaAnalysisResult } from './llmContracts';
import type { ThreadNode } from '../lib/resolver/atproto';
import type { ContributionScores } from './interpolatorTypes';
import { computeMultimodalScore, type MultimodalSignals } from './routing';

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
): MediaAnalysisRequest[] {
  const requests: MediaAnalysisRequest[] = [];

  const candidateEntities = root.text
    .match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g)
    ?.slice(0, 8) ?? [];

  // Root media
  const rootImg = root.embed?.images?.[0];
  if (rootImg?.url) {
    const req: MediaAnalysisRequest = {
      threadId,
      mediaUrl: rootImg.url,
      nearbyText: root.text.slice(0, 300),
      candidateEntities,
      factualHints: [],
    };
    if (rootImg.alt) req.mediaAlt = rootImg.alt;
    requests.push(req);
  }

  // Highest-impact reply with media (if different from root)
  if (requests.length < 2) {
    const replyWithMedia = [...replies]
      .filter(r => r.embed?.images?.[0]?.url)
      .sort((a, b) => (scores[b.uri]?.finalInfluenceScore ?? 0) - (scores[a.uri]?.finalInfluenceScore ?? 0))[0];
    if (replyWithMedia) {
      const img = replyWithMedia.embed!.images![0];
      if (!img?.url) return requests;
      const req: MediaAnalysisRequest = {
        threadId,
        mediaUrl: img.url,
        nearbyText: replyWithMedia.text.slice(0, 300),
        candidateEntities,
        factualHints: [],
      };
      if (img.alt) req.mediaAlt = img.alt;
      requests.push(req);
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
      return finding;
    });
}

// ─── Re-export shouldRunMultimodal for convenience ────────────────────────
export { computeMultimodalScore, shouldRunMultimodal } from './routing';
