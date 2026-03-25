// ─── Qwen3-VL Multimodal Service — Narwhal v3 ─────────────────────────────
// Phase B stub. Called only when multimodal_score >= 0.55.
// Model: qwen3-vl:4b-instruct-q4_K_M
//
// In Phase A, this returns a graceful "media present, not yet analyzed" result.
// Phase B: implement real Ollama vision call with base64 image encoding.

import { env } from '../config/env.js';

export interface MediaRequest {
  threadId: string;
  mediaUrl: string;
  mediaAlt?: string;
  nearbyText: string;
  candidateEntities: string[];
  factualHints: string[];
}

export interface MediaResponse {
  mediaCentrality: number;
  mediaType: 'screenshot' | 'chart' | 'document' | 'photo' | 'meme' | 'unknown';
  extractedText?: string;
  mediaSummary: string;
  candidateEntities: string[];
  confidence: number;
  cautionFlags: string[];
}

// ─── Phase A stub ──────────────────────────────────────────────────────────
// Returns a conservative placeholder. StoryMode continues to function while
// Phase B multimodal analysis is pending.

export async function runMediaAnalyzer(request: MediaRequest): Promise<MediaResponse> {
  // Phase B: fetch the image, encode to base64, call Ollama vision endpoint.
  // For now, return a low-confidence placeholder that signals media is present
  // without making interpretive claims about it.
  const _model = env.QWEN_MULTIMODAL_MODEL; // will be used in Phase B

  return {
    mediaCentrality: 0.3,
    mediaType: guessMediaType(request.mediaAlt ?? request.nearbyText),
    mediaSummary: 'Media is present in this thread. Full analysis coming in Phase B.',
    candidateEntities: request.candidateEntities.slice(0, 3),
    confidence: 0.2,
    cautionFlags: [],
  };
}

function guessMediaType(hint: string): MediaResponse['mediaType'] {
  const h = hint.toLowerCase();
  if (/screenshot|screen shot|screencap/.test(h)) return 'screenshot';
  if (/chart|graph|data/.test(h)) return 'chart';
  if (/document|article|policy|rule/.test(h)) return 'document';
  return 'photo';
}
