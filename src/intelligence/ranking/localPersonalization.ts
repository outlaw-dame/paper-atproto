import {
  computeEthicalRankingScore,
  type EthicalRankingInput,
  type EthicalRankingResult,
  type RankingInteractionSignal,
} from './ethicalRanking';

export type LocalPersonalizationDimension = 'depth' | 'breadth' | 'recency';

export interface LocalPersonalizationProfile {
  schemaVersion: 1;
  enabled: boolean;
  depth: number;
  breadth: number;
  recency: number;
  sampleCount: number;
  updatedAt: string | null;
}

export interface LocalPersonalizationContentSignals {
  depth: number;
  breadth: number;
  recency: number;
}

export interface LocalPersonalizationAdjustment {
  enabled: boolean;
  score: number;
  adjustment: number;
  maxInfluence: number;
  sampleCount: number;
  dimensions: Record<LocalPersonalizationDimension, 'low' | 'medium' | 'high'>;
}

export interface LocallyPersonalizedRankingInput extends EthicalRankingInput {
  personalization: LocalPersonalizationProfile;
  contentSignals: LocalPersonalizationContentSignals;
}

export interface LocallyPersonalizedRankingResult extends EthicalRankingResult {
  personalization: LocalPersonalizationAdjustment;
}

export interface LocalPersonalizationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const LOCAL_PERSONALIZATION_STORAGE_KEY = 'paper-atproto.localPersonalization.v1';

const LOCAL_PERSONALIZATION_MAX_INFLUENCE_RATE = 0.1;

export function createLocalPersonalizationProfile(
  overrides: Partial<LocalPersonalizationProfile> = {},
): LocalPersonalizationProfile {
  return {
    schemaVersion: 1,
    enabled: overrides.enabled ?? true,
    depth: clamp01(overrides.depth ?? 0.5),
    breadth: clamp01(overrides.breadth ?? 0.5),
    recency: clamp01(overrides.recency ?? 0.5),
    sampleCount: sanitizeCount(overrides.sampleCount ?? 0),
    updatedAt: typeof overrides.updatedAt === 'string' ? overrides.updatedAt : null,
  };
}

export function updateLocalPersonalizationProfile(input: {
  profile: LocalPersonalizationProfile;
  signal: RankingInteractionSignal;
  contentSignals: LocalPersonalizationContentSignals;
  interpretiveConfidence: number;
  dwellSeconds?: number;
  now?: string;
}): LocalPersonalizationProfile {
  const profile = createLocalPersonalizationProfile(input.profile);
  if (!profile.enabled) return profile;

  const baseStep = stepForSignal(input.signal, input.dwellSeconds);
  const confidenceScale = 0.25 + (0.75 * clamp01(input.interpretiveConfidence));
  const step = Math.abs(baseStep) * confidenceScale;
  const direction = Math.sign(baseStep);
  const signals = sanitizeContentSignals(input.contentSignals);

  return {
    ...profile,
    depth: nudgePreference(profile.depth, signals.depth, step, direction),
    breadth: nudgePreference(profile.breadth, signals.breadth, step, direction),
    recency: nudgePreference(profile.recency, signals.recency, step, direction),
    sampleCount: profile.sampleCount + 1,
    updatedAt: input.now ?? new Date().toISOString(),
  };
}

export function computeLocalPersonalizationAdjustment(input: {
  profile: LocalPersonalizationProfile;
  contentSignals: LocalPersonalizationContentSignals;
  interpretiveConfidence: number;
}): LocalPersonalizationAdjustment {
  const profile = createLocalPersonalizationProfile(input.profile);
  const signals = sanitizeContentSignals(input.contentSignals);
  const maxInfluence = LOCAL_PERSONALIZATION_MAX_INFLUENCE_RATE * clamp01(input.interpretiveConfidence);
  const score = profile.enabled
    ? alignmentScore(profile, signals)
    : 0.5;
  const adjustment = profile.enabled
    ? clampSymmetric(score - 0.5, maxInfluence)
    : 0;

  return {
    enabled: profile.enabled,
    score,
    adjustment,
    maxInfluence,
    sampleCount: profile.sampleCount,
    dimensions: {
      depth: bucket(profile.depth),
      breadth: bucket(profile.breadth),
      recency: bucket(profile.recency),
    },
  };
}

export function computeLocallyPersonalizedRankingScore(
  input: LocallyPersonalizedRankingInput,
): LocallyPersonalizedRankingResult {
  const base = computeEthicalRankingScore(input);
  const personalization = computeLocalPersonalizationAdjustment({
    profile: input.personalization,
    contentSignals: input.contentSignals,
    interpretiveConfidence: input.interpretiveConfidence,
  });

  return {
    ...base,
    score: clamp01(base.score + personalization.adjustment),
    personalization,
  };
}

export function loadLocalPersonalizationProfile(
  storage: LocalPersonalizationStorage | null = defaultLocalStorage(),
): LocalPersonalizationProfile {
  if (!storage) return createLocalPersonalizationProfile();

  try {
    const raw = storage.getItem(LOCAL_PERSONALIZATION_STORAGE_KEY);
    if (!raw) return createLocalPersonalizationProfile();
    const parsed = JSON.parse(raw) as Partial<LocalPersonalizationProfile>;
    return createLocalPersonalizationProfile(parsed);
  } catch {
    return createLocalPersonalizationProfile();
  }
}

export function saveLocalPersonalizationProfile(
  profile: LocalPersonalizationProfile,
  storage: LocalPersonalizationStorage | null = defaultLocalStorage(),
): boolean {
  if (!storage) return false;

  try {
    storage.setItem(
      LOCAL_PERSONALIZATION_STORAGE_KEY,
      JSON.stringify(createLocalPersonalizationProfile(profile)),
    );
    return true;
  } catch {
    return false;
  }
}

export function resetLocalPersonalizationProfile(
  storage: LocalPersonalizationStorage | null = defaultLocalStorage(),
): LocalPersonalizationProfile {
  if (storage) {
    try {
      storage.removeItem(LOCAL_PERSONALIZATION_STORAGE_KEY);
    } catch {
      // Local personalization is optional; reset should fail soft.
    }
  }
  return createLocalPersonalizationProfile();
}

function stepForSignal(signal: RankingInteractionSignal, dwellSeconds = 0): number {
  switch (signal) {
    case 'expand':
      return 0.04;
    case 'dwell':
      return dwellSeconds >= 8 ? 0.04 : 0.02;
    case 'skip':
      return -0.03;
  }
}

function nudgePreference(
  current: number,
  target: number,
  step: number,
  direction: number,
): number {
  const towardTarget = current + ((target - current) * step);
  if (direction >= 0) return clamp01(towardTarget);
  return clamp01(current - ((target - current) * step));
}

function alignmentScore(
  profile: LocalPersonalizationProfile,
  signals: LocalPersonalizationContentSignals,
): number {
  const distance = (
    Math.abs(profile.depth - signals.depth)
    + Math.abs(profile.breadth - signals.breadth)
    + Math.abs(profile.recency - signals.recency)
  ) / 3;
  return clamp01(1 - distance);
}

function sanitizeContentSignals(
  signals: LocalPersonalizationContentSignals,
): LocalPersonalizationContentSignals {
  return {
    depth: clamp01(signals.depth),
    breadth: clamp01(signals.breadth),
    recency: clamp01(signals.recency),
  };
}

function bucket(value: number): 'low' | 'medium' | 'high' {
  const clamped = clamp01(value);
  if (clamped >= 0.67) return 'high';
  if (clamped <= 0.33) return 'low';
  return 'medium';
}

function defaultLocalStorage(): LocalPersonalizationStorage | null {
  if (typeof globalThis === 'undefined') return null;
  const candidate = (globalThis as { localStorage?: LocalPersonalizationStorage }).localStorage;
  return candidate ?? null;
}

function sanitizeCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function clampSymmetric(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
