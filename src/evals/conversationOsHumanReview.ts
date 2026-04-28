import {
  CONVERSATION_OS_EVAL_SET_META,
  CONVERSATION_OS_FIXTURES,
  CONVERSATION_OS_SCORECARD,
} from './conversationOsFixtures';
import type { ConversationOsReport } from './conversationOsEval';

const FIXTURE_BY_ID = new Map<string, (typeof CONVERSATION_OS_FIXTURES)[number]>(
  CONVERSATION_OS_FIXTURES.map((fixture) => [fixture.id, fixture]),
);
const SCORECARD_BY_ID = new Map<string, (typeof CONVERSATION_OS_SCORECARD)[number]>(
  CONVERSATION_OS_SCORECARD.map((item) => [item.id, item]),
);
const STORAGE_KEY = 'glympse:conversation-os-human-review:v1';

export const HUMAN_REVIEW_RATINGS = ['pass', 'partial', 'fail'] as const;
export type HumanReviewRating = (typeof HUMAN_REVIEW_RATINGS)[number];

export interface HumanReviewVerdict {
  id: string;
  weight: number;
  description: string;
  rating: HumanReviewRating | null;
  note: string;
}

export interface ConversationOsHumanReviewPack {
  meta: {
    workflowVersion: 'conversation-os-human-review-v1';
    generatedAt: string;
    evalSet: typeof CONVERSATION_OS_EVAL_SET_META;
    reviewerId: string | null;
    note: string;
    sourcePath?: string | null;
  };
  scorecard: Array<{
    id: string;
    weight: number;
    description: string;
  }>;
  reviews: Array<{
    fixtureId: string;
    description: string;
    sourceThread: {
      rootPost: {
        uri: string;
        handle: string;
        text: string;
        createdAt: string;
      };
      selectedComments: Array<{
        uri: string;
        handle: string;
        text: string;
        impactScore: number;
        role: string | null;
      }>;
    };
    systemProjection: {
      summaryMode: string;
      changeReasons: string[];
      surfacedContributors: Array<{
        handle: string;
        role: string;
        impactScore: number;
      }>;
      whatChanged: string[];
      contextToWatch: string[];
      factualHighlights: string[];
    };
    automatedEvaluation: {
      raw: {
        passed: number;
        total: number;
      };
      weighted: {
        passed: number;
        total: number;
      };
      checks: Array<{
        id: string;
        pass: boolean;
        detail: string;
      }>;
    };
    humanReview: {
      reviewerId: string | null;
      reviewedAt: string | null;
      notes: string;
      verdicts: HumanReviewVerdict[];
    };
  }>;
}

export interface ConversationOsHumanReviewScore {
  meta: {
    workflowVersion: 'conversation-os-human-review-v1';
    scoredAt: string;
    sourcePath: string | null;
  };
  overall: {
    raw: {
      score: number;
      total: number;
    };
    weighted: {
      score: number;
      total: number;
    };
    completedVerdicts: number;
    totalVerdicts: number;
    completionRate: number;
  };
  reviews: Array<{
    fixtureId: string;
    description: string;
    reviewerId: string | null;
    reviewedAt: string | null;
    notes: string;
    raw: {
      score: number;
      total: number;
    };
    weighted: {
      score: number;
      total: number;
    };
    completedVerdicts: number;
    completionRate: number;
    verdicts: Array<{
      id: string;
      rating: HumanReviewRating | null;
      score: number | null;
      weight: number;
      description: string;
      note: string;
    }>;
  }>;
}

function getStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeOptionalText(value: unknown, maxLength = 400): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function ratingToScore(rating: HumanReviewRating | null): number | null {
  switch (rating) {
    case 'pass':
      return 1;
    case 'partial':
      return 0.5;
    case 'fail':
      return 0;
    default:
      return null;
  }
}

function buildEmptyVerdicts(): HumanReviewVerdict[] {
  return CONVERSATION_OS_SCORECARD.map((item) => ({
    id: item.id,
    weight: item.weight,
    description: item.description,
    rating: null,
    note: '',
  }));
}

function summarizeSystemProjection(result: ConversationOsReport['fixtures'][number]) {
  return {
    summaryMode: result.summaryMode,
    changeReasons: [...(result.changeReasons ?? [])],
    surfacedContributors: (result.writerInput?.topContributors ?? []).map((entry) => ({
      handle: entry.handle,
      role: entry.role,
      impactScore: entry.impactScore,
    })),
    whatChanged: [...(result.writerInput?.whatChangedSignals ?? [])],
    contextToWatch: [...(result.writerInput?.perspectiveGaps ?? [])],
    factualHighlights: [...(result.writerInput?.factualHighlights ?? [])],
  };
}

export function createHumanReviewPack(
  report: ConversationOsReport,
  options?: { reviewerId?: string },
): ConversationOsHumanReviewPack {
  const reviewerId = normalizeOptionalText(options?.reviewerId, 120) || null;

  return {
    meta: {
      workflowVersion: 'conversation-os-human-review-v1',
      generatedAt: new Date().toISOString(),
      evalSet: CONVERSATION_OS_EVAL_SET_META,
      reviewerId,
      note: 'Fill the humanReview.verdicts ratings with pass, partial, or fail. Ratings are blank by default.',
    },
    scorecard: CONVERSATION_OS_SCORECARD.map((item) => ({ ...item })),
    reviews: (report.fixtures ?? []).map((result) => {
      const fixture = FIXTURE_BY_ID.get(result.id);
      if (!fixture) {
        throw new Error(`Missing fixture metadata for ${result.id}`);
      }

      return {
        fixtureId: result.id,
        description: fixture.description,
        sourceThread: {
          rootPost: { ...fixture.request.rootPost },
          selectedComments: fixture.request.selectedComments.map((comment) => ({
            uri: comment.uri,
            handle: comment.handle,
            text: comment.text,
            impactScore: comment.impactScore,
            role: comment.role ?? null,
          })),
        },
        systemProjection: summarizeSystemProjection(result),
        automatedEvaluation: {
          raw: {
            passed: result.evaluation?.passed ?? 0,
            total: result.evaluation?.total ?? 0,
          },
          weighted: {
            passed: result.evaluation?.weightedPassed ?? 0,
            total: result.evaluation?.weightedTotal ?? 0,
          },
          checks: (result.evaluation?.checks ?? []).map((check) => ({
            id: check.id,
            pass: Boolean(check.pass),
            detail: normalizeOptionalText(check.detail, 240),
          })),
        },
        humanReview: {
          reviewerId,
          reviewedAt: null,
          notes: '',
          verdicts: buildEmptyVerdicts(),
        },
      };
    }),
  };
}

export function normalizeHumanReviewPack(input: unknown): ConversationOsHumanReviewPack | null {
  if (typeof input !== 'object' || input === null) return null;
  const candidate = input as Partial<ConversationOsHumanReviewPack>;
  const reviews = Array.isArray(candidate.reviews) ? candidate.reviews : [];
  const scorecard = Array.isArray(candidate.scorecard) ? candidate.scorecard : CONVERSATION_OS_SCORECARD;
  const reviewerId = normalizeOptionalText(candidate.meta?.reviewerId, 120) || null;
  const generatedAt = normalizeIsoTimestamp(candidate.meta?.generatedAt) ?? new Date().toISOString();

  return {
    meta: {
      workflowVersion: 'conversation-os-human-review-v1',
      generatedAt,
      evalSet: CONVERSATION_OS_EVAL_SET_META,
      reviewerId,
      note: normalizeOptionalText(candidate.meta?.note, 240)
        || 'Fill the humanReview.verdicts ratings with pass, partial, or fail. Ratings are blank by default.',
      ...(normalizeOptionalText(candidate.meta?.sourcePath, 400)
        ? { sourcePath: normalizeOptionalText(candidate.meta?.sourcePath, 400) }
        : {}),
    },
    scorecard: scorecard.map((item) => {
      const scorecardItem = SCORECARD_BY_ID.get(String(item.id));
      return {
        id: String(item.id ?? scorecardItem?.id ?? ''),
        weight: Number.isFinite(Number(item.weight)) ? Number(item.weight) : scorecardItem?.weight ?? 1,
        description: normalizeOptionalText(item.description, 180) || scorecardItem?.description || '',
      };
    }).filter((item) => item.id),
    reviews: reviews.map((review) => {
      const fixture = FIXTURE_BY_ID.get(String(review.fixtureId));
      const sourceComments = Array.isArray(review.sourceThread?.selectedComments)
        ? review.sourceThread.selectedComments
        : [];
      const verdicts = Array.isArray(review.humanReview?.verdicts)
        ? review.humanReview.verdicts
        : buildEmptyVerdicts();

      return {
        fixtureId: String(review.fixtureId ?? fixture?.id ?? ''),
        description: normalizeOptionalText(review.description, 240) || fixture?.description || '',
        sourceThread: {
          rootPost: {
            uri: normalizeOptionalText(review.sourceThread?.rootPost?.uri, 240) || fixture?.request.rootPost.uri || '',
            handle: normalizeOptionalText(review.sourceThread?.rootPost?.handle, 120) || fixture?.request.rootPost.handle || '',
            text: normalizeOptionalText(review.sourceThread?.rootPost?.text, 800) || fixture?.request.rootPost.text || '',
            createdAt: normalizeIsoTimestamp(review.sourceThread?.rootPost?.createdAt) || fixture?.request.rootPost.createdAt || '',
          },
          selectedComments: sourceComments.map((comment) => ({
            uri: normalizeOptionalText(comment.uri, 240),
            handle: normalizeOptionalText(comment.handle, 120),
            text: normalizeOptionalText(comment.text, 600),
            impactScore: Number.isFinite(Number(comment.impactScore)) ? Number(comment.impactScore) : 0,
            role: normalizeOptionalText(comment.role, 80) || null,
          })),
        },
        systemProjection: {
          summaryMode: normalizeOptionalText(review.systemProjection?.summaryMode, 80),
          changeReasons: Array.isArray(review.systemProjection?.changeReasons)
            ? review.systemProjection.changeReasons.map((value) => normalizeOptionalText(value, 200)).filter(Boolean)
            : [],
          surfacedContributors: Array.isArray(review.systemProjection?.surfacedContributors)
            ? review.systemProjection.surfacedContributors.map((entry) => ({
              handle: normalizeOptionalText(entry.handle, 120),
              role: normalizeOptionalText(entry.role, 80),
              impactScore: Number.isFinite(Number(entry.impactScore)) ? Number(entry.impactScore) : 0,
            }))
            : [],
          whatChanged: Array.isArray(review.systemProjection?.whatChanged)
            ? review.systemProjection.whatChanged.map((value) => normalizeOptionalText(value, 200)).filter(Boolean)
            : [],
          contextToWatch: Array.isArray(review.systemProjection?.contextToWatch)
            ? review.systemProjection.contextToWatch.map((value) => normalizeOptionalText(value, 200)).filter(Boolean)
            : [],
          factualHighlights: Array.isArray(review.systemProjection?.factualHighlights)
            ? review.systemProjection.factualHighlights.map((value) => normalizeOptionalText(value, 240)).filter(Boolean)
            : [],
        },
        automatedEvaluation: {
          raw: {
            passed: Number.isFinite(Number(review.automatedEvaluation?.raw?.passed)) ? Number(review.automatedEvaluation?.raw?.passed) : 0,
            total: Number.isFinite(Number(review.automatedEvaluation?.raw?.total)) ? Number(review.automatedEvaluation?.raw?.total) : 0,
          },
          weighted: {
            passed: Number.isFinite(Number(review.automatedEvaluation?.weighted?.passed)) ? Number(review.automatedEvaluation?.weighted?.passed) : 0,
            total: Number.isFinite(Number(review.automatedEvaluation?.weighted?.total)) ? Number(review.automatedEvaluation?.weighted?.total) : 0,
          },
          checks: Array.isArray(review.automatedEvaluation?.checks)
            ? review.automatedEvaluation.checks.map((check) => ({
              id: normalizeOptionalText(check.id, 120),
              pass: Boolean(check.pass),
              detail: normalizeOptionalText(check.detail, 240),
            }))
            : [],
        },
        humanReview: {
          reviewerId: normalizeOptionalText(review.humanReview?.reviewerId, 120) || reviewerId,
          reviewedAt: normalizeIsoTimestamp(review.humanReview?.reviewedAt),
          notes: normalizeOptionalText(review.humanReview?.notes, 1000),
          verdicts: verdicts.map((verdict) => {
            const scorecardItem = SCORECARD_BY_ID.get(String(verdict.id));
            const rating = HUMAN_REVIEW_RATINGS.includes(verdict.rating as HumanReviewRating)
              ? verdict.rating as HumanReviewRating
              : null;
            return {
              id: String(verdict.id ?? scorecardItem?.id ?? ''),
              weight: Number.isFinite(Number(verdict.weight)) ? Number(verdict.weight) : scorecardItem?.weight ?? 1,
              description: normalizeOptionalText(verdict.description, 180) || scorecardItem?.description || '',
              rating,
              note: normalizeOptionalText(verdict.note, 400),
            };
          }).filter((verdict) => verdict.id),
        },
      };
    }).filter((review) => review.fixtureId),
  };
}

export function scoreHumanReviewPack(pack: ConversationOsHumanReviewPack): ConversationOsHumanReviewScore {
  const reviews = Array.isArray(pack?.reviews) ? pack.reviews : [];
  const scoredReviews = reviews.map((review) => {
    const verdicts = Array.isArray(review?.humanReview?.verdicts)
      ? review.humanReview.verdicts
      : [];

    let rawScore = 0;
    let rawTotal = 0;
    let weightedScore = 0;
    let weightedTotal = 0;
    let completedVerdicts = 0;

    const normalizedVerdicts = verdicts.map((verdict) => {
      const scorecardItem = SCORECARD_BY_ID.get(verdict.id);
      const fallbackWeight = Number(verdict.weight ?? 1);
      const weight = scorecardItem?.weight ?? (Number.isFinite(fallbackWeight) ? fallbackWeight : 1);
      const rating = HUMAN_REVIEW_RATINGS.includes(verdict.rating as HumanReviewRating)
        ? verdict.rating as HumanReviewRating
        : null;
      const score = ratingToScore(rating);

      rawTotal += 1;
      weightedTotal += weight;
      if (score !== null) {
        rawScore += score;
        weightedScore += score * weight;
        completedVerdicts += 1;
      }

      return {
        id: verdict.id,
        rating,
        score,
        weight,
        description: scorecardItem?.description ?? normalizeOptionalText(verdict.description, 180),
        note: normalizeOptionalText(verdict.note, 400),
      };
    });

    return {
      fixtureId: review.fixtureId,
      description: review.description,
      reviewerId: normalizeOptionalText(review.humanReview?.reviewerId, 120) || null,
      reviewedAt: normalizeIsoTimestamp(review.humanReview?.reviewedAt),
      notes: normalizeOptionalText(review.humanReview?.notes, 1000),
      raw: {
        score: rawScore,
        total: rawTotal,
      },
      weighted: {
        score: weightedScore,
        total: weightedTotal,
      },
      completedVerdicts,
      completionRate: rawTotal > 0 ? completedVerdicts / rawTotal : 0,
      verdicts: normalizedVerdicts,
    };
  });

  const overall = scoredReviews.reduce((acc, review) => {
    acc.raw.score += review.raw.score;
    acc.raw.total += review.raw.total;
    acc.weighted.score += review.weighted.score;
    acc.weighted.total += review.weighted.total;
    acc.completedVerdicts += review.completedVerdicts;
    return acc;
  }, {
    raw: { score: 0, total: 0 },
    weighted: { score: 0, total: 0 },
    completedVerdicts: 0,
  });

  return {
    meta: {
      workflowVersion: 'conversation-os-human-review-v1',
      scoredAt: new Date().toISOString(),
      sourcePath: normalizeOptionalText(pack?.meta?.sourcePath, 400) || null,
    },
    overall: {
      raw: overall.raw,
      weighted: overall.weighted,
      completedVerdicts: overall.completedVerdicts,
      totalVerdicts: overall.raw.total,
      completionRate: overall.raw.total > 0 ? overall.completedVerdicts / overall.raw.total : 0,
    },
    reviews: scoredReviews,
  };
}

export function readStoredHumanReviewPack(storage?: Storage | null): ConversationOsHumanReviewPack | null {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return null;
  try {
    const raw = resolvedStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeHumanReviewPack(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeStoredHumanReviewPack(
  pack: ConversationOsHumanReviewPack,
  storage?: Storage | null,
): void {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return;
  try {
    resolvedStorage.setItem(STORAGE_KEY, JSON.stringify(pack));
  } catch {
    // best-effort persistence only
  }
}

export function clearStoredHumanReviewPack(storage?: Storage | null): void {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return;
  try {
    resolvedStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort persistence only
  }
}
