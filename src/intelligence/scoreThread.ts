// ─── Score Thread ─────────────────────────────────────────────────────────
// Entity-aware, contributor-aware, evidence-aware scorer.
// Replaces the legacy heuristicScoreReply in threadStore.
//
// Scoring pipeline for each reply:
//   1. Extract evidence signals (citations, data points, firsthand, etc.)
//      — uses both text patterns AND resolved facets/embeds from Pipeline A
//   2. Extract entity impacts (persons, orgs, concepts, claims)
//   3. Compute factualContribution as a POSITIVE evidence-derived signal
//   4. Assign ContributionRole via a richer decision tree
//   5. Derive knownFactCheckMatch from local thread evidence only (Phase 1)
//
// abuseScore is kept at 0 — it is a Phase 2 concern (Detoxify / moderation
// service) and must remain separate from usefulness ranking.

import type {
  ContributionScore,
  ContributionRole,
  EvidenceSignal,
  EntityImpact,
  EntityKind,
  ContributorImpact,
} from './interpolatorTypes.js';
import type { ThreadNode, ResolvedFacet, ResolvedEmbed } from '../lib/resolver/atproto.js';

// ─── Evidence extraction ──────────────────────────────────────────────────

const DATA_POINT_RE = /\b\d[\d,.]*\s*(%|percent|million|billion|thousand|\bk\b|\bx\b)/i;
const FIRSTHAND_RE = /\b(i (saw|witnessed|experienced|tested|tried|built|worked|spoke|talked|met)|my (experience|testing|research|observation))\b/i;
const COUNTEREXAMPLE_RE = /\b(for example|for instance|case in point|specifically|e\.g\.|namely|consider)\b/i;
const SPECULATION_RE = /\b(i think|i believe|i feel|maybe|perhaps|possibly|might be|could be|seems like|appears to)\b/i;
const CLAIM_CITE_RE = /\b(according to|per |cited in|study shows?|research (finds?|shows?|suggests?)|data (shows?|suggests?))\b/i;

function extractEvidenceSignals(
  text: string,
  facets: ResolvedFacet[],
  embed: ResolvedEmbed | null,
): EvidenceSignal[] {
  const signals: EvidenceSignal[] = [];
  const lower = text.toLowerCase();

  // ── Facet links (richtext citations — highest confidence) ─────────────
  for (const f of facets) {
    if (f.kind === 'link' && f.uri) {
      signals.push({
        kind: 'citation',
        confidence: 0.82,
        sourceUrl: f.uri,
        extractedText: f.domain ?? f.uri.slice(0, 60),
      });
    }
  }

  // ── External embed (quoted source — high confidence) ──────────────────
  if (embed?.kind === 'external' && embed.external?.uri) {
    signals.push({
      kind: 'citation',
      confidence: 0.85,
      sourceUrl: embed.external.uri,
      extractedText: embed.external.domain ?? embed.external.uri.slice(0, 60),
    });
  }

  // ── Attributed claim in prose ("according to", "study shows", etc.) ───
  if (CLAIM_CITE_RE.test(lower)) {
    signals.push({ kind: 'citation', confidence: 0.72, extractedText: 'attributed claim' });
  }

  // ── Numeric data point ────────────────────────────────────────────────
  const dataMatch = text.match(DATA_POINT_RE);
  if (dataMatch) {
    signals.push({ kind: 'data_point', confidence: 0.65, extractedText: dataMatch[0] });
  }

  // ── Firsthand account ────────────────────────────────────────────────
  if (FIRSTHAND_RE.test(lower)) {
    signals.push({ kind: 'firsthand', confidence: 0.70, extractedText: 'firsthand account' });
  }

  // ── Counterexample ───────────────────────────────────────────────────
  if (COUNTEREXAMPLE_RE.test(lower)) {
    signals.push({ kind: 'counterexample', confidence: 0.60, extractedText: 'counterexample' });
  }

  // ── Speculation (only if nothing stronger is present) ─────────────────
  if (SPECULATION_RE.test(lower) && signals.length === 0) {
    signals.push({ kind: 'speculation', confidence: 0.55 });
  }

  return signals;
}

// ─── Entity extraction ────────────────────────────────────────────────────
// Sources: @mentions in facets, a fixed concept vocabulary, and proper-noun
// sequences (Title Case). All lightweight — no NLP model required.

const CONCEPT_VOCAB: Record<string, EntityKind> = {
  'climate': 'concept', 'democracy': 'concept', 'ai': 'concept',
  'blockchain': 'concept', 'privacy': 'concept', 'censorship': 'concept',
  'election': 'concept', 'vaccine': 'concept', 'inflation': 'concept',
  'regulation': 'concept', 'algorithm': 'concept', 'moderation': 'concept',
  'misinformation': 'concept', 'disinformation': 'concept', 'fediverse': 'concept',
  'decentralisation': 'concept', 'decentralization': 'concept',
};

const PROPER_NOUN_RE = /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*)\b/g;

function extractEntityImpacts(
  text: string,
  facets: ResolvedFacet[],
  knownEntities: Set<string>,
): EntityImpact[] {
  const impacts: EntityImpact[] = [];
  const lower = text.toLowerCase();
  const seen = new Set<string>();

  // ── Mention facets → person ───────────────────────────────────────────
  for (const f of facets) {
    if (f.kind === 'mention' && f.did) {
      const key = f.did.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      // Extract display text from the facet byte range via the text string
      impacts.push({
        entityText: `@${key.split(':').pop() ?? key}`,
        entityKind: 'person',
        sentimentShift: 0,
        isNewEntity: !knownEntities.has(key),
        mentionCount: 1,
      });
    }
  }

  // ── Concept vocabulary ────────────────────────────────────────────────
  for (const [kw, kind] of Object.entries(CONCEPT_VOCAB)) {
    if (!lower.includes(kw) || seen.has(kw)) continue;
    seen.add(kw);
    impacts.push({
      entityText: kw,
      entityKind: kind,
      sentimentShift: 0,
      isNewEntity: !knownEntities.has(kw),
      mentionCount: (lower.match(new RegExp(`\\b${kw}\\b`, 'g')) ?? []).length,
    });
  }

  // ── Proper nouns (Title Case runs) ────────────────────────────────────
  for (const m of text.matchAll(PROPER_NOUN_RE)) {
    const name = m[1];
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    // Skip very short matches and very common stop words
    if (name.length < 4) continue;
    seen.add(key);
    // Multi-word → org; single-word → person heuristic
    const kind: EntityKind = name.includes(' ') ? 'org' : 'person';
    impacts.push({
      entityText: name,
      entityKind: kind,
      sentimentShift: 0,
      isNewEntity: !knownEntities.has(key),
      mentionCount: 1,
    });
  }

  return impacts.slice(0, 8);  // cap per reply
}

// ─── Factual contribution ─────────────────────────────────────────────────
// Evidence-derived POSITIVE signal. Speculation reduces it slightly.

function computeFactualContribution(signals: EvidenceSignal[]): number {
  if (signals.length === 0) return 0;
  let score = 0;
  for (const s of signals) {
    switch (s.kind) {
      case 'citation':       score += 0.30 * s.confidence; break;
      case 'data_point':     score += 0.25 * s.confidence; break;
      case 'firsthand':      score += 0.20 * s.confidence; break;
      case 'counterexample': score += 0.15 * s.confidence; break;
      case 'speculation':    score -= 0.08; break;
    }
  }
  return Math.max(0, Math.min(1, score));
}

// ─── Conservative local fact-check match (Phase 1) ───────────────────────
// Derived from convergent sourcing (same URL cited by ≥2 replies) and
// high root-text claim overlap with citation present.
// Phase 2: replace with live external fact-check lookup.

function deriveLocalFactCheckMatch(
  text: string,
  rootText: string,
  allCitedUrls: Set<string>,
  signals: EvidenceSignal[],
): { match: boolean; confidence: number } {
  const citations = signals.filter(s => s.kind === 'citation' && s.sourceUrl);
  const converging = citations.some(s => allCitedUrls.has(s.sourceUrl!));

  const rootWords = new Set(
    rootText.toLowerCase().split(/\s+/).filter(w => w.length > 5)
  );
  const replyWords = text.toLowerCase().split(/\s+/).filter(w => w.length > 5);
  const overlapRatio = rootWords.size > 0
    ? replyWords.filter(w => rootWords.has(w)).length / rootWords.size
    : 0;

  if (converging) return { match: true, confidence: 0.55 };
  if (overlapRatio > 0.35 && citations.length > 0) return { match: true, confidence: 0.40 };
  return { match: false, confidence: 0 };
}

// ─── ContributionRole decision tree ──────────────────────────────────────

function assignRole(
  text: string,
  threadTexts: string[],
  signals: EvidenceSignal[],
  likeCount: number,
  factualContribution: number,
): ContributionRole {
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).length;

  const hasCitation = signals.some(s => s.kind === 'citation');
  const hasData = signals.some(s => s.kind === 'data_point');
  const hasFirsthand = signals.some(s => s.kind === 'firsthand');
  const speculative = signals.length > 0 && signals.every(s => s.kind === 'speculation');

  const hasQuestion = text.includes('?');
  const hasClarification = /\b(clarif|could you|what do you mean|do you mean|explain)\b/.test(lower);
  const hasDisagreement = /\b(disagree|wrong|actually|but wait|however|not true|incorrect|no,)\b/.test(lower);
  const hasAgreement = /\b(agree|exactly|yes|correct|right|absolutely|totally)\b/.test(lower);

  // Repetition: high word overlap with prior replies (excluding stopwords)
  const isRepetitive = !hasCitation && !hasData && threadTexts.some(t => {
    const tWords = t.toLowerCase().split(/\s+/);
    const overlap = lower.split(/\s+/).filter(w => w.length > 4 && tWords.includes(w)).length;
    return overlap / Math.max(words, 1) > 0.55;
  });

  if (words < 4 && !hasCitation) return 'repetitive';
  if (isRepetitive) return 'repetitive';

  if (factualContribution > 0.5 && (hasCitation || hasData)) {
    return hasDisagreement ? 'useful_counterpoint' : 'new_information';
  }
  if (hasDisagreement && hasCitation) return 'useful_counterpoint';
  if (hasClarification || (hasQuestion && !hasDisagreement)) return 'clarifying';
  if (hasDisagreement && (hasData || hasFirsthand)) return 'useful_counterpoint';
  if (hasDisagreement) return 'provocative';
  if (hasCitation || hasData || hasFirsthand) return 'new_information';
  if (hasAgreement && words < 8) return 'repetitive';
  if (likeCount > 20 && factualContribution > 0.25) return 'story_worthy';
  if (words > 25) return 'direct_response';
  if (speculative) return 'direct_response';

  return 'unknown';
}

// ─── Usefulness score ─────────────────────────────────────────────────────

function computeUsefulnessScore(
  role: ContributionRole,
  factualContribution: number,
  likeCount: number,
  words: number,
): number {
  const base: Record<ContributionRole, number> = {
    useful_counterpoint: 0.85,
    story_worthy:        0.80,
    new_information:     0.78,
    clarifying:          0.70,
    direct_response:     0.62,
    unknown:             0.45,
    provocative:         0.35,
    repetitive:          0.10,
  };

  let score = base[role];
  score += factualContribution * 0.15;

  if (likeCount > 5)   score = Math.min(1, score + 0.05);
  if (likeCount > 20)  score = Math.min(1, score + 0.08);
  if (likeCount > 100) score = Math.min(1, score + 0.07);

  if (words < 4) score = Math.min(score, 0.20);
  else if (words < 8) score = Math.min(score, 0.35);

  return Math.max(0, Math.min(1, score));
}

// ─── scoreReply ───────────────────────────────────────────────────────────

export function scoreReply(
  reply: ThreadNode,
  rootText: string,
  allReplies: ThreadNode[],
  knownEntities: Set<string>,
  allCitedUrls: Set<string>,
): ContributionScore {
  const text = reply.text ?? '';
  const words = text.toLowerCase().split(/\s+/).length;
  const threadTexts = allReplies
    .filter(r => r.uri !== reply.uri)
    .map(r => r.text ?? '');

  const evidenceSignals = extractEvidenceSignals(text, reply.facets, reply.embed);
  const entityImpacts = extractEntityImpacts(text, reply.facets, knownEntities);
  const factualContribution = computeFactualContribution(evidenceSignals);
  const role = assignRole(text, threadTexts, evidenceSignals, reply.likeCount, factualContribution);
  const usefulnessScore = computeUsefulnessScore(role, factualContribution, reply.likeCount, words);
  const { match: knownFactCheckMatch, confidence: factCheckMatchConfidence } =
    deriveLocalFactCheckMatch(text, rootText, allCitedUrls, evidenceSignals);

  return {
    uri: reply.uri,
    role,
    usefulnessScore,
    abuseScore: 0,  // Phase 2: Detoxify — kept separate from ranking
    scoredAt: new Date().toISOString(),
    evidenceSignals,
    entityImpacts,
    factualContribution,
    knownFactCheckMatch,
    factCheckMatchConfidence,
    mediaContextConfidence: 0,  // Phase 2: media provenance service
  };
}

// ─── scoreAllReplies ──────────────────────────────────────────────────────
// Two-pass: first build the shared URL set; then score with accumulating
// entity context so later replies benefit from earlier entity discoveries.

export function scoreAllReplies(
  rootText: string,
  replies: ThreadNode[],
): Record<string, ContributionScore> {
  // Pass 1 — collect all cited URLs across the thread for convergence check
  const allCitedUrls = new Set<string>();
  for (const r of replies) {
    for (const f of r.facets) {
      if (f.kind === 'link' && f.uri) allCitedUrls.add(f.uri);
    }
    if (r.embed?.kind === 'external' && r.embed.external?.uri) {
      allCitedUrls.add(r.embed.external.uri);
    }
  }

  // Pass 2 — score, accumulating entity knowledge as we go
  const knownEntities = new Set<string>();
  const scores: Record<string, ContributionScore> = {};

  for (const reply of replies) {
    const score = scoreReply(reply, rootText, replies, knownEntities, allCitedUrls);
    scores[reply.uri] = score;
    for (const e of score.entityImpacts) {
      knownEntities.add(e.entityText.toLowerCase().replace(/^@/, ''));
    }
  }

  return scores;
}

// ─── computeContributorImpacts ────────────────────────────────────────────

export function computeContributorImpacts(
  replies: ThreadNode[],
  scores: Record<string, ContributionScore>,
): ContributorImpact[] {
  const byDid = new Map<string, { ss: ContributionScore[]; handle?: string }>();

  for (const r of replies) {
    if (!r.authorDid) continue;
    const s = scores[r.uri];
    if (!s) continue;
    if (!byDid.has(r.authorDid)) {
      byDid.set(r.authorDid, { ss: [], handle: r.authorHandle });
    }
    byDid.get(r.authorDid)!.ss.push(s);
  }

  const impacts: ContributorImpact[] = [];
  for (const [did, { ss, handle }] of byDid) {
    const avg = ss.reduce((a, s) => a + s.usefulnessScore, 0) / ss.length;
    const counts: Partial<Record<ContributionRole, number>> = {};
    for (const s of ss) counts[s.role] = (counts[s.role] ?? 0) + 1;
    const dominantRole = (
      Object.entries(counts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'unknown'
    ) as ContributionRole;

    impacts.push({
      did,
      ...(handle !== undefined ? { handle } : {}),
      totalReplies: ss.length,
      avgUsefulnessScore: avg,
      dominantRole,
      factualContributions: ss.filter(s => s.factualContribution > 0.3).length,
    });
  }

  return impacts
    .sort((a, b) => b.avgUsefulnessScore - a.avgUsefulnessScore)
    .slice(0, 10);
}
