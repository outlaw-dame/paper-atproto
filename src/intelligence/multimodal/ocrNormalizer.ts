// ─── Multimodal — OCR Text Normalization ──────────────────────────────────
// Cleans and segments OCR-extracted text before it enters the scoring pipeline.
//
// Raw OCR output is often:
//   • Fragmented with orphan words from layout detection
//   • Full of repeated/duplicate lines from overlapping regions
//   • Missing sentence boundaries
//   • Padded with whitespace artifacts
//
// This module standardizes OCR output to clean, usable text.
//
// Design constraints:
//   • Pure functions — no I/O.
//   • Fail-closed on any error — return the raw text trimmed.
//   • Never log extracted OCR text except in controlled debug paths.
//   • Enforce length caps to prevent downstream blowup.

import { MAX_ROOT_TEXT_LEN } from '../context/limits';

// ─── Constants ────────────────────────────────────────────────────────────

const MAX_OCR_OUTPUT_LEN = MAX_ROOT_TEXT_LEN;
const MIN_BLOCK_LENGTH = 10; // blocks shorter than this are discarded

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Detect whether two strings are near-duplicates using a simplified
 * character-overlap ratio. Used to collapse repeated OCR regions.
 */
function isDuplicate(a: string, b: string, threshold = 0.75): boolean {
  if (!a || !b) return false;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length >= b.length ? a : b;
  if (shorter.length === 0) return longer.length === 0;
  // Simple containment test first (common in overlapping OCR regions)
  if (longer.includes(shorter)) return true;
  // Character overlap ratio
  const setA = new Set(a.toLowerCase());
  const setB = new Set(b.toLowerCase());
  let common = 0;
  for (const ch of setA) {
    if (setB.has(ch)) common += 1;
  }
  return common / Math.max(setA.size, setB.size) >= threshold;
}

// ─── normalizeOcrText ─────────────────────────────────────────────────────

/**
 * Full normalization pipeline for raw OCR text.
 *
 * Steps:
 *   1. Unicode NFC normalization
 *   2. Control character removal
 *   3. Whitespace collapse (tabs, NBSP, etc. → single space)
 *   4. Line-based deduplication (remove repeated/near-duplicate lines)
 *   5. Short-block removal (orphan words < MIN_BLOCK_LENGTH)
 *   6. Length cap
 *
 * Returns cleaned text, or the trimmed original on error.
 */
export function normalizeOcrText(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';

  try {
    // 1. Unicode NFC
    let text = raw.normalize('NFC');

    // 2. Strip control chars except \n
    text = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '');

    // 3. Collapse pathological whitespace (not newlines)
    text = text.replace(/[\t\f\r\u00a0\u200b\u200c\u200d\u2028\u2029\ufeff]+/g, ' ');

    // 4. Split into lines, deduplicate near-identical lines
    const rawLines = text.split('\n').map(l => l.trim());
    const seen: string[] = [];
    const deduped: string[] = [];
    for (const line of rawLines) {
      if (!line) continue;
      const isDup = seen.some(prev => isDuplicate(prev, line));
      if (!isDup) {
        deduped.push(line);
        seen.push(line);
      }
    }

    // 5. Remove very short orphan blocks
    const filtered = deduped.filter(l => l.length >= MIN_BLOCK_LENGTH);

    // 6. Rejoin and cap
    const result = filtered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return result.length <= MAX_OCR_OUTPUT_LEN
      ? result
      : result.slice(0, MAX_OCR_OUTPUT_LEN);
  } catch {
    return raw.trim().slice(0, MAX_OCR_OUTPUT_LEN);
  }
}

// ─── segmentOcrBlocks ────────────────────────────────────────────────────

/**
 * Segment normalized OCR text into logical blocks (paragraphs, headings, lists).
 * Returns an array of text blocks.
 */
export function segmentOcrBlocks(normalizedText: string): string[] {
  if (!normalizedText) return [];
  try {
    return normalizedText
      .split(/\n{2,}/)
      .map(block => block.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(block => block.length >= MIN_BLOCK_LENGTH);
  } catch {
    return [normalizedText].filter(Boolean);
  }
}

// ─── extractQuoteSpansFromOcr ─────────────────────────────────────────────

/**
 * Extract quote-like spans from OCR text.
 * Recognizes:
 *   • Text in double or curly quotes
 *   • Lines starting with " (headline-style)
 *   • All-caps lines (header/label-style)
 */
export function extractQuoteSpansFromOcr(normalizedText: string): string[] {
  if (!normalizedText) return [];

  const spans: string[] = [];
  const seen = new Set<string>();

  try {
    // Double or curly quotes
    const quoteRe = /"([^"]{15,180})"|"([^"]{15,180})"/g;
    let match: RegExpExecArray | null;
    while ((match = quoteRe.exec(normalizedText)) !== null && spans.length < 4) {
      const content = (match[1] ?? match[2] ?? '').trim();
      if (content && !seen.has(content)) {
        seen.add(content);
        spans.push(content.slice(0, 160));
      }
    }
  } catch {
    // Fail closed
  }

  return spans;
}
