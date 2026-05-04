import { runInterpolatorPipeline, nodeToThreadPost } from '../intelligence/atprotoInterpolatorAdapter';
import { runVerifiedThreadPipeline } from '../intelligence/threadPipeline';
import { buildThreadStateForWriter } from '../intelligence/writerInput';
import { createVerificationProviders } from '../intelligence/verification/providerFactory';
import { InMemoryVerificationCache } from '../intelligence/verification/cache';
import {
  CONVERSATION_OS_EVAL_SET_META,
  CONVERSATION_OS_FIXTURES,
  CONVERSATION_OS_SCORECARD,
  type ConversationOsEvalFixture,
} from './conversationOsFixtures';

const DEFAULT_FIXTURE_IDS: string[] = CONVERSATION_OS_FIXTURES.map((fixture) => fixture.id);
const SCORECARD_BY_ID = new Map<string, (typeof CONVERSATION_OS_SCORECARD)[number]>(
  CONVERSATION_OS_SCORECARD.map((item) => [item.id, item]),
);

export const CONVERSATION_OS_EXPECTATIONS = Object.fromEntries(
  CONVERSATION_OS_FIXTURES.map((fixture) => [fixture.id, fixture.expectations]),
);

function sanitizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lowerText(value: unknown): string {
  return sanitizeText(value).toLowerCase();
}

function clampRate(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric < 0) return 0;
  if (numeric > 1) return 1;
  return numeric;
}

function makeDid(handle: string): string {
  return `did:plc:${sanitizeText(handle).toLowerCase().replace(/[^a-z0-9._-]+/g, '-') || 'actor'}`;
}

function makeReplyNode(
  reply: ConversationOsEvalFixture['request']['selectedComments'][number],
  rootUri: string,
  index: number,
) {
  const replyUri = sanitizeText(reply.uri) || `${rootUri}#reply-${index + 1}`;
  return {
    uri: replyUri,
    cid: `${replyUri}-cid`,
    authorDid: makeDid(reply.handle),
    authorHandle: sanitizeText(reply.handle),
    text: sanitizeText(reply.text),
    createdAt: sanitizeText('createdAt' in reply ? reply.createdAt : undefined) || '2026-04-08T16:00:00.000Z',
    likeCount: Math.max(0, Math.round(Number(reply.impactScore ?? 0) * 10)),
    replyCount: 0,
    repostCount: 0,
    facets: [],
    embed: null,
    labels: [],
    depth: 1,
    replies: [],
    parentUri: rootUri,
  };
}

function buildFixtureRuntimeInputs(fixture: ConversationOsEvalFixture) {
  const request = fixture.request;
  const rootUri = sanitizeText(request.rootPost.uri);
  const replies = request.selectedComments.map((reply, index) => makeReplyNode(reply, rootUri, index));
  const rootPost = nodeToThreadPost({
    uri: rootUri,
    cid: `${rootUri}-cid`,
    authorDid: makeDid(request.rootPost.handle),
    authorHandle: sanitizeText(request.rootPost.handle),
    text: sanitizeText(request.rootPost.text),
    createdAt: sanitizeText(request.rootPost.createdAt),
    likeCount: 0,
    replyCount: replies.length,
    repostCount: 0,
    facets: [],
    embed: null,
    labels: [],
    depth: 0,
    replies,
  });

  return {
    rootUri,
    rootText: sanitizeText(request.rootPost.text),
    rootPost,
    replies,
  };
}

function countRequiredHandleMentions(values: string[], handles: readonly string[]): string[] {
  const normalizedValues = values.map((value) => lowerText(value));
  return handles.filter((handle) => normalizedValues.some((value) => value.includes(`@${handle.toLowerCase()}`)));
}

function isConfidenceModeCoherent(summaryMode: string, interpretiveConfidence: number): boolean {
  if (interpretiveConfidence < 0.4) {
    return summaryMode === 'minimal_fallback' || summaryMode === 'descriptive_fallback';
  }
  if (interpretiveConfidence >= 0.65) {
    return summaryMode === 'normal';
  }
  return summaryMode !== 'minimal_fallback';
}

export function normalizeFixtureIds(raw: string): string[] {
  const normalized = String(raw)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => DEFAULT_FIXTURE_IDS.includes(value));

  return normalized.length > 0 ? Array.from(new Set(normalized)) : [...DEFAULT_FIXTURE_IDS];
}

export function evaluateConversationOsProjection(
  fixture: Pick<ConversationOsEvalFixture, 'id' | 'request'>,
  projection: {
    pipeline: {
      summaryMode: string;
      deltaDecision: {
        changeReasons: string[];
      };
    };
    writerInput: {
      safeEntities: Array<{ label: string }>;
      topContributors: Array<{ handle: string }>;
      whatChangedSignals: string[];
      perspectiveGaps?: string[] | undefined;
      factualHighlights: string[];
      threadSignalSummary?: {
        sourceBackedCount: number;
        clarificationsCount: number;
      } | undefined;
    };
  },
) {
  const expectations = CONVERSATION_OS_EXPECTATIONS[fixture.id];
  if (!expectations) {
    throw new Error(`Missing Conversation OS expectations for ${fixture.id}`);
  }

  const safeEntityLabels = (projection.writerInput.safeEntities ?? []).map((entity) => entity.label);
  const contributorHandles = (projection.writerInput.topContributors ?? []).map((contributor) => contributor.handle);
  const whatChanged = projection.writerInput.whatChangedSignals ?? [];
  const perspectiveGaps = projection.writerInput.perspectiveGaps ?? [];
  const requiredContributorMentions = countRequiredHandleMentions(
    [...safeEntityLabels, ...contributorHandles],
    expectations.requiredContributorHandles,
  );
  const rootAuthorMentioned = safeEntityLabels.some(
    (label) => lowerText(label) === `@${fixture.request.rootPost.handle.toLowerCase()}`,
  );
  const whatChangedPrefixes = whatChanged
    .map((value) => sanitizeText(value).split(':')[0]?.toLowerCase() ?? '')
    .filter(Boolean);
  const expectedPrefixes = expectations.requiredSignalPrefixes.map((value) => value.toLowerCase());
  const matchedPrefixes = expectedPrefixes.filter((prefix) => whatChangedPrefixes.includes(prefix));
  const perspectiveGapText = perspectiveGaps.map((value) => lowerText(value)).join(' ');
  const matchedGapTerms = expectations.perspectiveGapTerms.filter((term) => perspectiveGapText.includes(term.toLowerCase()));
  const contributorRoles = (projection.writerInput.topContributors ?? [])
    .map((contributor) => lowerText((contributor as { role?: string }).role ?? ''))
    .filter(Boolean);
  const uniqueContributorRoles = new Set(contributorRoles);
  const interpretiveConfidence = clampRate(fixture.request.confidence.interpretiveConfidence);
  const factualHighlights = projection.writerInput.factualHighlights ?? [];
  const hasSpecificWhatChanged = whatChanged.some((value) => lowerText(value).includes(':'));
  const evidenceSignalCount = projection.writerInput.threadSignalSummary?.sourceBackedCount ?? 0;
  const clarificationSignalCount = projection.writerInput.threadSignalSummary?.clarificationsCount ?? 0;

  const checks = [
    {
      id: 'summary_mode_match',
      pass: projection.pipeline.summaryMode === expectations.summaryMode,
      detail: `${projection.pipeline.summaryMode} vs ${expectations.summaryMode}`,
    },
    {
      id: 'delta_change_detected',
      pass: projection.pipeline.deltaDecision.changeReasons.length > 0,
      detail: projection.pipeline.deltaDecision.changeReasons.join(', ') || 'no change reasons',
    },
    {
      id: 'root_author_entity_anchor',
      pass: rootAuthorMentioned,
      detail: safeEntityLabels.join(' • '),
    },
    {
      id: 'high_impact_contributors_projected',
      pass: requiredContributorMentions.length === expectations.requiredContributorHandles.length,
      detail: `${requiredContributorMentions.length}/${expectations.requiredContributorHandles.length} contributor handles surfaced`,
    },
    {
      id: 'what_changed_coverage',
      pass: matchedPrefixes.length === expectedPrefixes.length,
      detail: whatChanged.join(' • ') || 'no what-changed signals',
    },
    {
      id: 'thread_signal_summary_alignment',
      pass:
        (projection.writerInput.threadSignalSummary?.sourceBackedCount ?? 0) >= expectations.minSourceBackedCount
        && (projection.writerInput.threadSignalSummary?.clarificationsCount ?? 0) >= expectations.minClarificationsCount,
      detail: `source_backed=${projection.writerInput.threadSignalSummary?.sourceBackedCount ?? 0} clarifications=${projection.writerInput.threadSignalSummary?.clarificationsCount ?? 0}`,
    },
    {
      id: 'factual_highlights_present',
      pass: (projection.writerInput.factualHighlights ?? []).length > 0,
      detail: `${projection.writerInput.factualHighlights.length} factual highlights`,
    },
    {
      id: 'context_to_watch',
      pass:
        perspectiveGaps.length >= expectations.minPerspectiveGaps
        && (
          expectations.perspectiveGapTerms.length === 0
          || matchedGapTerms.length > 0
        ),
      detail: perspectiveGaps.join(' • ') || 'no context-to-watch gaps',
    },
    {
      id: 'confidence_mode_coherence',
      pass: isConfidenceModeCoherent(projection.pipeline.summaryMode, interpretiveConfidence),
      detail: `summary_mode=${projection.pipeline.summaryMode} interpretive_confidence=${interpretiveConfidence.toFixed(2)}`,
    },
    {
      id: 'contributor_signal_diversity',
      pass:
        expectations.requiredContributorHandles.length <= 1
        ? requiredContributorMentions.length === expectations.requiredContributorHandles.length
        : (requiredContributorMentions.length === expectations.requiredContributorHandles.length
          && uniqueContributorRoles.size >= Math.min(2, projection.writerInput.topContributors.length)),
      detail: `required=${requiredContributorMentions.length}/${expectations.requiredContributorHandles.length} role_diversity=${uniqueContributorRoles.size}`,
    },
    {
      id: 'evidence_to_signal_alignment',
      pass:
        evidenceSignalCount >= expectations.minSourceBackedCount
        && clarificationSignalCount >= expectations.minClarificationsCount
        && factualHighlights.length > 0
        && hasSpecificWhatChanged,
      detail: `evidence=${evidenceSignalCount} clarifications=${clarificationSignalCount} highlights=${factualHighlights.length} specific_signals=${hasSpecificWhatChanged ? 'yes' : 'no'}`,
    },
  ];

  let weightedPassed = 0;
  let weightedTotal = 0;
  for (const check of checks) {
    const weight = SCORECARD_BY_ID.get(check.id)?.weight ?? 1;
    weightedTotal += weight;
    if (check.pass) weightedPassed += weight;
  }

  return {
    passed: checks.filter((check) => check.pass).length,
    total: checks.length,
    weightedPassed,
    weightedTotal,
    checks,
  };
}

async function evaluateFixture(fixture: ConversationOsEvalFixture) {
  const runtime = buildFixtureRuntimeInputs(fixture);
  const previous = runInterpolatorPipeline({
    rootUri: runtime.rootUri,
    rootText: runtime.rootText,
    replies: [],
    existingState: null,
  });
  const providers = createVerificationProviders();
  const cache = new InMemoryVerificationCache();
  const pipeline = await runVerifiedThreadPipeline({
    input: runtime,
    previous,
    providers,
    cache,
  });

  const writerInput = buildThreadStateForWriter(
    fixture.request.threadId,
    runtime.rootText,
    pipeline.interpolator,
    pipeline.scores,
    runtime.replies,
    pipeline.confidence,
    undefined,
    fixture.request.rootPost.handle,
    {
      summaryMode: pipeline.summaryMode,
      deltaDecision: pipeline.deltaDecision,
      ...('mediaFindings' in fixture.request ? { mediaFindings: [...fixture.request.mediaFindings] } : {}),
    },
  );

  const evaluation = evaluateConversationOsProjection(fixture, {
    pipeline,
    writerInput,
  });

  return {
    id: fixture.id,
    description: fixture.description,
    summaryMode: pipeline.summaryMode,
    changeReasons: pipeline.deltaDecision.changeReasons,
    writerInput,
    evaluation,
  };
}

export async function buildConversationOsReport(fixtureIds: string[] = DEFAULT_FIXTURE_IDS) {
  const selectedFixtureIds = Array.isArray(fixtureIds) && fixtureIds.length > 0
    ? fixtureIds
    : DEFAULT_FIXTURE_IDS;
  const selectedFixtures = CONVERSATION_OS_FIXTURES.filter((fixture) => selectedFixtureIds.includes(fixture.id));
  const report = {
    meta: CONVERSATION_OS_EVAL_SET_META,
    fixtures: [] as Awaited<ReturnType<typeof evaluateFixture>>[],
    overall: {
      passed: 0,
      total: 0,
      weightedPassed: 0,
      weightedTotal: 0,
    },
  };

  for (const fixture of selectedFixtures) {
    const result = await evaluateFixture(fixture);
    report.fixtures.push(result);
    report.overall.passed += result.evaluation.passed;
    report.overall.total += result.evaluation.total;
    report.overall.weightedPassed += result.evaluation.weightedPassed;
    report.overall.weightedTotal += result.evaluation.weightedTotal;
  }

  return report;
}

export type ConversationOsReport = Awaited<ReturnType<typeof buildConversationOsReport>>;
