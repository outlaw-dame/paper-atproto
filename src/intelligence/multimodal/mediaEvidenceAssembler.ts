// ─── Multimodal — Media Evidence Assembler ────────────────────────────────
// Assembles structured, machine-usable media evidence from:
//   • pre-classification result (mediaClassifier)
//   • centrality classification (mediaCentrality)
//   • OCR normalized text (ocrNormalizer)
//   • media-text disagreement signals (mediaDisagreement)
//   • model analysis result (MediaAnalysisResult from llmContracts)
//
// The output is a StructuredMediaEvidence object that downstream phases
// (stance, contributor, entity, writer) can consume without re-parsing
// the raw model output.
//
// Design constraints:
//   • Pure functions — no I/O, no model calls.
//   • Fail-closed on any error — return a safe empty evidence object.
//   • Validate and sanitize all model-produced strings before storing.
//   • Enforce size limits on all text fields.

import type { MediaAnalysisResult } from '../llmContracts';
import type { MediaClassificationResult } from './mediaClassifier';
import type { MediaCentralityResult } from './mediaCentrality';
import type { MediaDisagreementResult } from './mediaDisagreement';
import { normalizeOcrText, extractQuoteSpansFromOcr } from './ocrNormalizer';
import { clamp01 } from '../context/limits';

// ─── Types ────────────────────────────────────────────────────────────────

export interface StructuredMediaEvidence {
  /** Pre-classified media type (screenshot, chart, etc.). */
  mediaKind: MediaAnalysisResult['mediaType'];
  /** How central this media is to the thread claim. */
  centralityLevel: MediaCentralityResult['level'];
  /** Numeric centrality score [0, 1]. */
  centralityScore: number;
  /** Whether this media carries the primary claim. */
  isClaimCarrier: boolean;
  /** Cleaned OCR text (empty if not text-heavy or OCR unavailable). */
  normalizedOcr: string;
  /** Quotes extracted from OCR text. */
  extractedQuotes: string[];
  /** Brief prose summary from the vision model. */
  mediaSummary: string;
  /** Overall confidence in the evidence [0, 1]. */
  confidence: number;
  /** Caution flags — always check before making confident claims. */
  cautionFlags: string[];
  /** True if confident claims about this media should be suppressed. */
  suppressConfidentClaims: boolean;
  /** Entities extracted from OCR / model analysis. */
  candidateEntities: string[];
}

// ─── sanitizers ───────────────────────────────────────────────────────────

function sanitizeString(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, maxLen);
}

function sanitizeStringArray(raw: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is string => typeof v === 'string')
    .map(v => sanitizeString(v, maxLen))
    .filter(v => v.length > 0)
    .slice(0, maxItems);
}

// ─── assembleMediaEvidence ────────────────────────────────────────────────

/**
 * Assemble structured media evidence from all available signals.
 *
 * @param classification — from mediaClassifier.classifyMedia()
 * @param centrality     — from mediaCentrality.classifyMediaCentrality()
 * @param disagreement   — from mediaDisagreement.detectMediaTextDisagreement()
 * @param modelResult    — from modelClient.callMediaAnalyzer() (may be null)
 *
 * Never throws — returns an empty/safe evidence object on error.
 */
export function assembleMediaEvidence(
  classification: MediaClassificationResult,
  centrality: MediaCentralityResult,
  disagreement: MediaDisagreementResult,
  modelResult: MediaAnalysisResult | null,
): StructuredMediaEvidence {
  const empty: StructuredMediaEvidence = {
    mediaKind: 'unknown',
    centralityLevel: 'unknown',
    centralityScore: 0,
    isClaimCarrier: false,
    normalizedOcr: '',
    extractedQuotes: [],
    mediaSummary: '',
    confidence: 0,
    cautionFlags: [],
    suppressConfidentClaims: false,
    candidateEntities: [],
  };

  try {
    // Determine final media kind: model result takes precedence over pre-classification
    const mediaKind = modelResult?.mediaType ?? classification.kind;

    // OCR normalization
    const rawOcr = modelResult?.extractedText ?? '';
    const normalizedOcr = rawOcr ? normalizeOcrText(rawOcr) : '';
    const extractedQuotes = normalizedOcr ? extractQuoteSpansFromOcr(normalizedOcr) : [];

    // Summary: sanitize model-produced prose
    const mediaSummary = modelResult
      ? sanitizeString(modelResult.mediaSummary, 280)
      : '';

    // Confidence: blend model confidence with classification confidence,
    // penalized by disagreement level.
    const baseConfidence = clamp01(
      (modelResult?.confidence ?? 0) * 0.60 +
      classification.confidence * 0.40,
    );
    const confidence = clamp01(
      baseConfidence * (1 - disagreement.disagreementLevel * 0.40),
    );

    // Centrality: model centrality takes precedence
    const centralityScore = clamp01(
      modelResult?.mediaCentrality !== undefined
        ? modelResult.mediaCentrality
        : centrality.score,
    );
    const centralityLevel = centrality.level;
    const isClaimCarrier = classification.isClaimCarrier || centralityScore >= 0.55;

    // Merge caution flags: disagreement flags + model-returned flags
    const allFlags = [
      ...disagreement.cautionFlags,
      ...sanitizeStringArray(modelResult?.cautionFlags, 4, 80),
    ];
    const cautionFlags = [...new Set(allFlags)].slice(0, 6);

    const suppressConfidentClaims =
      disagreement.suppressConfidentClaims ||
      confidence < 0.30;

    // Candidate entities: sanitize model-returned entity strings
    const candidateEntities = sanitizeStringArray(
      modelResult?.candidateEntities,
      8,
      60,
    );

    return {
      mediaKind,
      centralityLevel,
      centralityScore,
      isClaimCarrier,
      normalizedOcr: normalizedOcr.slice(0, 800),
      extractedQuotes,
      mediaSummary,
      confidence,
      cautionFlags,
      suppressConfidentClaims,
      candidateEntities,
    };
  } catch {
    return empty;
  }
}

/**
 * Convert a StructuredMediaEvidence to the WriterMediaFinding shape used
 * by the existing llmContracts / writer input.
 *
 * Returns null if the evidence is too weak to include.
 */
export function toWriterMediaFinding(
  evidence: StructuredMediaEvidence,
): import('../llmContracts').WriterMediaFinding | null {
  if (evidence.confidence < 0.25 || !evidence.mediaSummary) return null;

  const finding: import('../llmContracts').WriterMediaFinding = {
    mediaType: evidence.mediaKind,
    summary: evidence.mediaSummary,
    confidence: evidence.confidence,
  };

  if (evidence.normalizedOcr.length >= 20) {
    finding.extractedText = evidence.normalizedOcr.slice(0, 280);
  }
  if (evidence.cautionFlags.length > 0) {
    finding.cautionFlags = evidence.cautionFlags;
  }

  return finding;
}
