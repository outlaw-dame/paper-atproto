export interface CoverageGapSignal {
  magnitude: number;
  kind:
    | 'none'
    | 'divergent_quotes'
    | 'divergent_sources'
    | 'isolated_entity'
    | 'narrow_participant_set';
  comparisonCount: number;
  schemaVersion: 1;
}

export interface CoverageGapInput {
  rootUri: string;
  quotedUris: string[];
  externalDomains: string[];
  externalUrls: string[];
  mentionedDids: string[];
  canonicalEntityIds: string[];
}

export interface CoverageGapComparison {
  quotedUris?: string[];
  domains?: string[];
  externalUrls?: string[];
  mentionedDids?: string[];
  canonicalEntityIds?: string[];
}

export interface CoverageGapContext {
  fetchComparisons(input: CoverageGapInput): Promise<CoverageGapComparison[]>;
}

const EMPTY_SIGNAL: CoverageGapSignal = {
  magnitude: 0,
  kind: 'none',
  comparisonCount: 0,
  schemaVersion: 1,
};

export async function detectCoverageGapForCluster(
  input: CoverageGapInput,
  ctx: CoverageGapContext,
): Promise<CoverageGapSignal> {
  try {
    const comparisons = await ctx.fetchComparisons(sanitizeCoverageGapInput(input));
    if (!comparisons.length) return EMPTY_SIGNAL;

    const anchorDomains = normalizedDomainSet(input.externalDomains, input.externalUrls);
    const domainDivergence = divergenceForSets([
      anchorDomains,
      ...comparisons.map((comparison) =>
        normalizedDomainSet(comparison.domains ?? [], comparison.externalUrls ?? [])),
    ]);
    const quoteDivergence = divergenceForSets([
      normalizedSet(input.quotedUris),
      ...comparisons.map((comparison) => normalizedSet(comparison.quotedUris ?? [])),
    ]);
    const entityIsolation = isolationForSet(
      normalizedSet(input.canonicalEntityIds),
      comparisons.map((comparison) => normalizedSet(comparison.canonicalEntityIds ?? [])),
    );
    const participantSets = comparisons.map((comparison) => normalizedSet(comparison.mentionedDids ?? []));
    const participantNarrowness = Math.max(
      participantNarrownessForSets([
        normalizedSet(input.mentionedDids),
        ...participantSets,
      ]),
      participantIsolationForSet(normalizedSet(input.mentionedDids), participantSets),
    );

    const candidates: Array<{ kind: CoverageGapSignal['kind']; magnitude: number }> = [
      { kind: 'divergent_sources', magnitude: domainDivergence },
      { kind: 'divergent_quotes', magnitude: quoteDivergence },
      { kind: 'isolated_entity', magnitude: entityIsolation },
      { kind: 'narrow_participant_set', magnitude: participantNarrowness },
    ];
    const strongest = candidates.sort((left, right) => right.magnitude - left.magnitude)[0];
    const magnitude = clamp01(strongest?.magnitude ?? 0);

    return {
      magnitude,
      kind: magnitude >= 0.4 ? strongest?.kind ?? 'none' : 'none',
      comparisonCount: comparisons.length,
      schemaVersion: 1,
    };
  } catch {
    return EMPTY_SIGNAL;
  }
}

function sanitizeCoverageGapInput(input: CoverageGapInput): CoverageGapInput {
  return {
    rootUri: input.rootUri,
    quotedUris: input.quotedUris.slice(0, 12),
    externalDomains: input.externalDomains.slice(0, 12),
    externalUrls: input.externalUrls.slice(0, 12),
    mentionedDids: input.mentionedDids.slice(0, 16),
    canonicalEntityIds: input.canonicalEntityIds.slice(0, 16),
  };
}

function normalizedSet(values: string[]): Set<string> {
  return new Set(
    values
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function normalizedDomainSet(domains: string[], urls: string[]): Set<string> {
  return new Set([
    ...domains.map(normalizeDomain),
    ...urls.map(domainFromUrl),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0));
}

function normalizeDomain(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return value
      .trim()
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      ?.replace(/^www\./, '')
      .toLowerCase() ?? '';
  }
}

function domainFromUrl(value: string): string | null {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function divergenceForSets(sets: Set<string>[]): number {
  const nonEmpty = sets.filter((set) => set.size > 0);
  if (nonEmpty.length <= 1) return 0;

  const union = new Set(nonEmpty.flatMap((set) => [...set]));
  const intersection = nonEmpty.reduce(
    (acc, set) => new Set([...acc].filter((value) => set.has(value))),
    new Set(union),
  );

  return union.size === 0 ? 0 : clamp01(1 - (intersection.size / union.size));
}

function isolationForSet(anchor: Set<string>, comparisons: Set<string>[]): number {
  if (anchor.size === 0 || comparisons.length === 0) return 0;
  const comparisonUnion = new Set(comparisons.flatMap((set) => [...set]));
  if (comparisonUnion.size === 0) return 0;
  const overlap = [...anchor].filter((value) => comparisonUnion.has(value)).length;
  return clamp01(1 - (overlap / anchor.size));
}

function participantNarrownessForSets(sets: Set<string>[]): number {
  const union = new Set(sets.flatMap((set) => [...set]));
  if (union.size === 0) return 0;
  return clamp01(1 - Math.min(1, union.size / 4));
}

function participantIsolationForSet(anchor: Set<string>, comparisons: Set<string>[]): number {
  if (anchor.size === 0) return 0;
  const nonEmptyComparisons = comparisons.filter((set) => set.size > 0);
  if (nonEmptyComparisons.length === 0) return 0;
  const averageOverlap = nonEmptyComparisons
    .map((comparison) => overlapRatio(anchor, comparison))
    .reduce((sum, value) => sum + value, 0) / nonEmptyComparisons.length;
  return clamp01(1 - averageOverlap);
}

function overlapRatio(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  const intersection = [...left].filter((value) => right.has(value)).length;
  return clamp01(intersection / Math.max(left.size, right.size));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
