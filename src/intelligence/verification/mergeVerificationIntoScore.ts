import type { ContributionScores, FactualEvidence, VisibleChip, VisibleChipKind, EntityImpact } from '../interpolatorTypes';
import type { VerificationOutcome } from './types';

function normalizeEntityLookupKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

// ─── mapVisibleChips ──────────────────────────────────────────────────────
// Derives UI chips from a VerificationOutcome, merging into any existing chips
// (existing chips take priority; new chips are de-duplicated by kind).

function mapVisibleChips(
  verification: VerificationOutcome,
  existing: VisibleChip[],
): VisibleChip[] {
  const chips = new Map<VisibleChipKind, VisibleChip>(existing.map(c => [c.kind, c]));

  if (verification.factCheck?.matched) {
    chips.set('fact-checked', { kind: 'fact-checked', label: 'Fact-checked', confidence: 1 });
  }

  if (verification.sourcePresence > 0.3 && verification.sourceQuality > 0.4) {
    chips.set('source-backed', {
      kind: 'source-backed',
      label: 'Source-backed',
      confidence: verification.sourceQuality,
    });
  }

  if (verification.quoteFidelity >= 0.65) {
    chips.set('direct-quote', {
      kind: 'direct-quote',
      label: 'Direct quote',
      confidence: verification.quoteFidelity,
    });
  }

  if (verification.mediaContextConfidence > 0.3) {
    chips.set('media-verified', {
      kind: 'media-verified',
      label: 'Media verified',
      confidence: verification.mediaContextConfidence,
    });
  }

  if (verification.contradictionLevel >= 0.45) {
    chips.set('contested', {
      kind: 'contested',
      label: 'Contested',
      confidence: verification.contradictionLevel,
    });
  }

  if (verification.correctionValue >= 0.60) {
    chips.set('clarification', {
      kind: 'clarification',
      label: 'Clarification',
      confidence: verification.correctionValue,
    });
  }

  if (verification.factualState === 'well-supported') {
    chips.set('well-supported', { kind: 'well-supported', label: 'Well-supported' });
  } else if (verification.factualState === 'partially-supported') {
    chips.set('partially-supported', { kind: 'partially-supported', label: 'Partially supported' });
  } else if (verification.factualState === 'source-backed-clarification') {
    chips.set('corrective-context', { kind: 'corrective-context', label: 'Corrective context' });
  }

  return Array.from(chips.values());
}

// ─── mergeVerificationIntoContributionScore ───────────────────────────────
// Enriches a ContributionScores with the full 18-field FactualEvidence from a
// completed VerificationOutcome. finalInfluenceScore is boosted by
// 0.20 × factualContributionScore × factualConfidence (capped at 1).
// visibleChips are recalculated and merged with any previously set chips.

export function mergeVerificationIntoContributionScore(
  score: ContributionScores,
  verification: VerificationOutcome,
): ContributionScores {
  const boost = 0.20 * verification.factualContributionScore * verification.factualConfidence;
  const finalInfluenceScore = Math.max(0, Math.min(1, score.finalInfluenceScore + boost));

  const factual: FactualEvidence = {
    claimPresent: verification.claimType !== 'opinion' && verification.claimType !== 'unclear',
    claimType: verification.claimType,
    knownFactCheckMatch: verification.factCheck?.matched ?? false,
    factCheckMatchConfidence: verification.factCheck?.hits?.[0]?.matchConfidence ?? 0,
    sourcePresence: verification.sourcePresence,
    sourceType: verification.sourceType,
    ...(verification.sourceDomain !== undefined ? { sourceDomain: verification.sourceDomain } : {}),
    sourceQuality: verification.sourceQuality,
    quoteFidelity: verification.quoteFidelity,
    corroborationLevel: verification.corroborationLevel,
    contradictionLevel: verification.contradictionLevel,
    mediaContextConfidence: verification.mediaContextConfidence,
    entityGrounding: verification.entityGrounding,
    contextValue: verification.contextValue,
    correctionValue: verification.correctionValue,
    citedUrls: verification.citedUrls,
    quotedTextSpans: verification.quotedTextSpans,
    factualContributionScore: verification.factualContributionScore,
    factualConfidence: verification.factualConfidence,
    factualState: verification.factualState,
    reasons: verification.reasons,
  };

  // Upgrade entity matchConfidence using canonical IDs from Wikidata/DBpedia.
  // When the verification provider confirms an entity mention (e.g. "AI" → wikidata:Q11660),
  // boost that entity's matchConfidence in the score's entityImpacts. This makes
  // the centrality algorithm weight Wikidata-confirmed entities more reliably.
  let entityImpacts = score.entityImpacts;
  if (verification.canonicalEntities && verification.canonicalEntities.length > 0) {
    const canonicalByMention = new Map<string, NonNullable<VerificationOutcome['canonicalEntities']>[number]>();
    verification.canonicalEntities.forEach((entity) => {
      const mentionKey = normalizeEntityLookupKey(entity.mention);
      if (mentionKey) canonicalByMention.set(mentionKey, entity);

      const labelKey = normalizeEntityLookupKey(entity.canonicalLabel);
      if (labelKey) canonicalByMention.set(labelKey, entity);
    });

    entityImpacts = score.entityImpacts.map((impact: EntityImpact): EntityImpact => {
      const impactKeys = [impact.entityText, impact.canonicalLabel]
        .filter((value): value is string => Boolean(value))
        .map((value) => normalizeEntityLookupKey(value))
        .filter(Boolean);
      const canonical = impactKeys
        .map((key) => canonicalByMention.get(key))
        .find((entity): entity is NonNullable<typeof entity> => Boolean(entity));
      if (!canonical) return impact;
      return {
        ...impact,
        // Upgrade canonical ID to authoritative source (wikidata/dbpedia) if confirmed
        canonicalEntityId: canonical.canonicalId,
        canonicalLabel: canonical.canonicalLabel,
        // Blend existing confidence with canonical provider confidence
        matchConfidence: Math.min(1, ((impact.matchConfidence ?? 0.5) + canonical.confidence) / 2 + 0.05),
      };
    });
  }

  return {
    ...score,
    factual,
    finalInfluenceScore,
    entityImpacts,
    visibleChips: mapVisibleChips(verification, score.visibleChips),
  };
}
