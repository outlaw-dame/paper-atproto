// ─── Deterministic Context — Evidence Extraction ──────────────────────────
// Extracts structured evidence signals from post text without any model calls.
//
// Evidence kinds:
//   url          — explicit HTTP/HTTPS URL
//   quoted_span  — text span delimited by quotes or blockquote markers
//   data_point   — numeric claim with surrounding context
//   policy_ref   — explicit reference to a rule, policy, law, or regulation
//   contrastive  — "actually / according to / the rule is" correction cues
//
// Design constraints:
//   • Pure functions — no I/O, no side effects.
//   • Fail-closed: on any error, return empty array, never throw.
//   • Cap extraction counts to prevent pathological input blowup.
//   • Never log extracted text — only counts.

import {
  MAX_EVIDENCE_PER_POST,
  MAX_URLS_PER_TEXT,
  MAX_QUOTED_SPANS,
  MAX_DATA_POINTS,
  MAX_EVIDENCE_EXCERPT_LEN,
} from './limits';
import { buildCanonicalSource, type CanonicalSource } from './canonicalizeSources';

// ─── Types ────────────────────────────────────────────────────────────────

export type DeterministicEvidenceKind =
  | 'url'
  | 'quoted_span'
  | 'data_point'
  | 'policy_ref'
  | 'contrastive';

export interface DeterministicEvidence {
  kind: DeterministicEvidenceKind;
  /** Short excerpt (≤ MAX_EVIDENCE_EXCERPT_LEN chars) that triggered detection. */
  excerpt: string;
  /** Confidence 0–1 based on pattern specificity. */
  confidence: number;
  /** Populated for 'url' kind — the canonical source metadata. */
  source?: CanonicalSource;
}

// ─── Patterns ─────────────────────────────────────────────────────────────

// Matches HTTP/HTTPS URLs. Conservative — avoids capturing trailing punctuation.
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

// Double-quoted spans: "text" or "text" (curly quotes)
const DOUBLE_QUOTE_RE = /"([^"]{10,200})"|"([^"]{10,200})"/g;

// Single-quoted spans starting with explicit attribution: according to 'x', per 'x'
const ATTRIBUTION_QUOTE_RE = /(?:according to|per|as stated by|citing)\s+'([^']{5,150})'/gi;

// Blockquote-style: line starting with >
const BLOCKQUOTE_RE = /^>\s*(.{10,180})/gm;

// Numbers followed by percentage or unit — "53%", "12 million", "$4.2 billion"
const DATA_POINT_RE = /\b(\d[\d,]*(?:\.\d+)?(?:\s*(?:%|percent|billion|million|thousand|k|m|b)\b)?)\b/gi;
// Surrounding context window (capture N chars before the number)
const DATA_CONTEXT_RE = /(?:[\w\s,;()]{0,50})\b(\d[\d,]*(?:\.\d+)?(?:\s*(?:%|percent|billion|million|thousand|k|m|b)\b)?)\b(?:[\w\s,;()]{0,50})/gi;

// Policy / rule references
const POLICY_PATTERNS = [
  /\b(?:section|§)\s*\d[\d.a-z]*/gi,
  /\b(?:article|rule|regulation|statute|law|act|code|subsection)\s+\d[\d.a-z]*/gi,
  /\b(?:title\s+(?:IX|X{0,3}(?:IX|IV|V?I{0,3})|[1-9]\d*))/gi,
  /\b(?:executive order|eo)\s+\d+/gi,
  /\b(?:pub\.?\s*l\.?\s*no\.?\s*\d+|\d+\s+U\.S\.C\.?\s*§?\s*\d+)/gi,
];

// Contrastive correction cues
const CONTRASTIVE_PATTERNS = [
  /\bactually[,\s]/i,
  /\baccording to\b/i,
  /\bthe (?:actual|real|correct|true) (?:rule|fact|answer|data|number|figure)\b/i,
  /\bthat'?s (?:wrong|not right|incorrect|false|misleading)\b/i,
  /\bthis is (?:wrong|not right|incorrect|false|misleading)\b/i,
  /\bcorrection:/i,
  /\b(?:fact check|factcheck):/i,
  /\bin fact[,\s]/i,
  /\bto be clear[,\s]/i,
  /\bfor the record[,\s]/i,
  /\bthe (?:data|evidence|research|study|studies) (?:show|shows|suggest|suggests)\b/i,
];

// ─── Helpers ───────────────────────────────────────────────────────────────

function excerpt(text: string, maxLen = MAX_EVIDENCE_EXCERPT_LEN): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.length <= maxLen ? trimmed : `${trimmed.slice(0, maxLen - 1)}…`;
}

function safeMatchAll(text: string, re: RegExp): RegExpExecArray[] {
  const results: RegExpExecArray[] = [];
  try {
    // Reset lastIndex for global regexes.
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null && results.length < 20) {
      results.push(match);
    }
  } catch {
    // Silently discard — pathological input should not crash.
  }
  return results;
}

// ─── extractUrls ─────────────────────────────────────────────────────────

/**
 * Extract up to MAX_URLS_PER_TEXT valid https/http URLs from text.
 * Returns CanonicalSource objects (null entries filtered out).
 */
export function extractUrls(text: string): CanonicalSource[] {
  const matches = safeMatchAll(text, URL_RE);
  const seen = new Set<string>();
  const sources: CanonicalSource[] = [];

  for (const match of matches) {
    if (sources.length >= MAX_URLS_PER_TEXT) break;
    const raw = match[0]!.replace(/[.,;:!?)\]]+$/, ''); // strip trailing punctuation
    if (seen.has(raw)) continue;
    seen.add(raw);
    const src = buildCanonicalSource(raw);
    if (src) sources.push(src);
  }

  return sources;
}

// ─── extractQuotedSpans ───────────────────────────────────────────────────

/**
 * Extract quoted text spans from post text.
 * Returns up to MAX_QUOTED_SPANS excerpts.
 */
export function extractQuotedSpans(text: string): string[] {
  const spans: string[] = [];

  for (const re of [DOUBLE_QUOTE_RE, ATTRIBUTION_QUOTE_RE, BLOCKQUOTE_RE]) {
    for (const match of safeMatchAll(text, re)) {
      if (spans.length >= MAX_QUOTED_SPANS) break;
      const content = match[1] ?? match[2] ?? '';
      const trimmed = content.trim();
      if (trimmed.length >= 10) {
        spans.push(excerpt(trimmed));
      }
    }
    if (spans.length >= MAX_QUOTED_SPANS) break;
  }

  return spans;
}

// ─── extractDataPoints ────────────────────────────────────────────────────

/**
 * Extract numeric data-point excerpts from text.
 * Returns up to MAX_DATA_POINTS excerpts with surrounding context.
 */
export function extractDataPoints(text: string): string[] {
  const points: string[] = [];
  const seen = new Set<string>();
  DATA_CONTEXT_RE.lastIndex = 0;

  try {
    let match: RegExpExecArray | null;
    while ((match = DATA_CONTEXT_RE.exec(text)) !== null && points.length < MAX_DATA_POINTS) {
      const raw = match[0]!.trim();
      if (raw.length < 5 || seen.has(raw)) continue;
      // Skip pure years or version numbers (single 4-digit number, e.g. "2024")
      if (/^\d{4}$/.test(raw)) continue;
      seen.add(raw);
      points.push(excerpt(raw));
    }
  } catch {
    // Fail closed
  }

  return points;
}

// ─── extractPolicyRefs ────────────────────────────────────────────────────

/**
 * Extract explicit policy/law/rule references from text.
 * Returns up to MAX_DATA_POINTS excerpts.
 */
export function extractPolicyRefs(text: string): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();

  for (const pattern of POLICY_PATTERNS) {
    for (const match of safeMatchAll(text, pattern)) {
      if (refs.length >= MAX_DATA_POINTS) break;
      const raw = match[0]!.trim();
      if (raw.length < 3 || seen.has(raw.toLowerCase())) continue;
      seen.add(raw.toLowerCase());
      refs.push(excerpt(raw));
    }
    if (refs.length >= MAX_DATA_POINTS) break;
  }

  return refs;
}

// ─── detectContrastiveCues ────────────────────────────────────────────────

/**
 * Returns true if the text contains a strong contrastive/correction cue.
 * Confidence score based on number of matching patterns.
 */
export function detectContrastiveCues(text: string): { detected: boolean; confidence: number } {
  let matchCount = 0;
  for (const pattern of CONTRASTIVE_PATTERNS) {
    if (pattern.test(text)) matchCount += 1;
  }
  return {
    detected: matchCount > 0,
    confidence: Math.min(1, matchCount * 0.25),
  };
}

// ─── extractDeterministicEvidence ────────────────────────────────────────

/**
 * Main entry point — extract all evidence signals from a post text.
 * Returns up to MAX_EVIDENCE_PER_POST signals in priority order:
 *   url > quoted_span > policy_ref > contrastive > data_point
 *
 * Never throws.
 */
export function extractDeterministicEvidence(text: string): DeterministicEvidence[] {
  if (!text || typeof text !== 'string') return [];

  try {
    const evidence: DeterministicEvidence[] = [];

    // 1. URLs — highest priority
    for (const source of extractUrls(text)) {
      if (evidence.length >= MAX_EVIDENCE_PER_POST) break;
      evidence.push({
        kind: 'url',
        excerpt: source.canonicalUrl.slice(0, MAX_EVIDENCE_EXCERPT_LEN),
        confidence: source.quality,
        source,
      });
    }

    // 2. Quoted spans
    for (const span of extractQuotedSpans(text)) {
      if (evidence.length >= MAX_EVIDENCE_PER_POST) break;
      evidence.push({ kind: 'quoted_span', excerpt: span, confidence: 0.60 });
    }

    // 3. Policy refs
    for (const ref of extractPolicyRefs(text)) {
      if (evidence.length >= MAX_EVIDENCE_PER_POST) break;
      evidence.push({ kind: 'policy_ref', excerpt: ref, confidence: 0.75 });
    }

    // 4. Contrastive cues
    if (evidence.length < MAX_EVIDENCE_PER_POST) {
      const { detected, confidence } = detectContrastiveCues(text);
      if (detected) {
        // Capture a short excerpt around the first contrastive cue.
        const matchAt = CONTRASTIVE_PATTERNS.findIndex(p => p.test(text));
        const firstMatch = matchAt >= 0 ? CONTRASTIVE_PATTERNS[matchAt]!.exec(text) : null;
        const start = firstMatch?.index ?? 0;
        const contextExcerpt = excerpt(text.slice(Math.max(0, start - 10), start + 80));
        evidence.push({ kind: 'contrastive', excerpt: contextExcerpt, confidence });
      }
    }

    // 5. Data points
    for (const point of extractDataPoints(text)) {
      if (evidence.length >= MAX_EVIDENCE_PER_POST) break;
      evidence.push({ kind: 'data_point', excerpt: point, confidence: 0.50 });
    }

    return evidence;
  } catch {
    return [];
  }
}

// ─── Aggregate helpers ────────────────────────────────────────────────────

/**
 * True if any evidence signal is stronger than a threshold.
 * Useful as a quick gate before heavier scoring.
 */
export function hasStrongEvidence(evidence: DeterministicEvidence[], threshold = 0.60): boolean {
  return evidence.some(e => e.confidence >= threshold);
}

/**
 * Extract all canonical sources from a set of evidence signals.
 */
export function evidenceSources(evidence: DeterministicEvidence[]): CanonicalSource[] {
  return evidence
    .filter((e): e is DeterministicEvidence & { source: CanonicalSource } => e.source !== undefined)
    .map(e => e.source);
}
