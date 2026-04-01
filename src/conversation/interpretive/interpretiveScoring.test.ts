import { describe, expect, it } from 'vitest';
import type {
  ContributionScore,
  ContributionScores,
  ContributorImpact,
  EntityImpact,
  ThreadInterpolatorState,
} from '../../intelligence/interpolatorTypes';
import type { VerificationOutcome } from '../../intelligence/verification/types';
import type {
  ConversationNode,
  ConversationSession,
} from '../sessionTypes';
import {
  annotateConversationQuality,
  deriveThreadStateSignal,
} from '../sessionPolicies';
import { projectComposerContext } from '../projections/composerProjection';
import { projectThreadView } from '../projections/threadProjection';
import { applyInterpretiveConfidence } from './interpretiveScoring';
import { useInterpolatorSettingsStore } from '../../store/interpolatorSettingsStore';

const ROOT_URI = 'at://did:plc:root/app.bsky.feed.post/root';

describe('interpretive scoring', () => {
  it('upgrades coherent evidence-backed threads to normal mode', () => {
    const session = finalizeSession(createFixtureSession({
      replies: [
        {
          uri: 'at://did:plc:one/app.bsky.feed.post/1',
          authorDid: 'did:plc:one',
          authorHandle: 'alex.test',
          text: 'The city budget memo says the transit cut moves to next quarter, and the linked PDF repeats that timeline.',
          score: createScore({
            role: 'source_bringer',
            usefulnessScore: 0.86,
            finalInfluenceScore: 0.9,
            sourceSupport: 0.9,
            factualContributionScore: 0.92,
            factualConfidence: 0.9,
          }),
          verification: createVerification({
            sourcePresence: 0.95,
            sourceQuality: 0.92,
            corroborationLevel: 0.82,
            factualContributionScore: 0.94,
            factualConfidence: 0.9,
            sourceType: 'primary_document',
          }),
        },
        {
          uri: 'at://did:plc:two/app.bsky.feed.post/2',
          authorDid: 'did:plc:two',
          authorHandle: 'jamie.test',
          text: 'That matches the council notes: the city budget memo delays the transit cut to next quarter, not canceling it, which clears up the confusion.',
          score: createScore({
            role: 'clarifying',
            usefulnessScore: 0.8,
            finalInfluenceScore: 0.82,
            clarificationValue: 0.88,
            sourceSupport: 0.72,
            factualContributionScore: 0.82,
            factualConfidence: 0.84,
            userFeedback: 'clarifying',
          }),
          verification: createVerification({
            sourcePresence: 0.8,
            sourceQuality: 0.86,
            corroborationLevel: 0.76,
            factualContributionScore: 0.84,
            factualConfidence: 0.82,
            sourceType: 'official_statement',
          }),
        },
        {
          uri: 'at://did:plc:three/app.bsky.feed.post/3',
          authorDid: 'did:plc:three',
          authorHandle: 'morgan.test',
          text: 'A counterpoint: the city budget memo moves the accounting line to next quarter, but rider impact from the transit cut still lands now because service planning already changed.',
          score: createScore({
            role: 'useful_counterpoint',
            usefulnessScore: 0.74,
            finalInfluenceScore: 0.8,
            sourceSupport: 0.62,
            factualContributionScore: 0.7,
            factualConfidence: 0.74,
            userFeedback: 'aha',
          }),
          verification: createVerification({
            sourcePresence: 0.7,
            sourceQuality: 0.78,
            corroborationLevel: 0.72,
            contradictionLevel: 0.24,
            factualContributionScore: 0.76,
            factualConfidence: 0.72,
            sourceType: 'reputable_reporting',
          }),
        },
        {
          uri: 'at://did:plc:four/app.bsky.feed.post/4',
          authorDid: 'did:plc:four',
          authorHandle: 'riley.test',
          text: 'The replies are converging on the same city budget memo and the same next-quarter timeline update.',
          score: createScore({
            role: 'direct_response',
            usefulnessScore: 0.7,
            finalInfluenceScore: 0.72,
            sourceSupport: 0.5,
            factualContributionScore: 0.55,
            factualConfidence: 0.68,
          }),
          verification: createVerification({
            sourcePresence: 0.58,
            sourceQuality: 0.7,
            corroborationLevel: 0.68,
            factualContributionScore: 0.6,
            factualConfidence: 0.64,
            sourceType: 'secondary_summary',
          }),
        },
        {
          uri: 'at://did:plc:five/app.bsky.feed.post/5',
          authorDid: 'did:plc:five',
          authorHandle: 'casey.test',
          text: 'Another source-backed note: the transit cut memo and the city budget summary both use the same next-quarter language.',
          score: createScore({
            role: 'new_information',
            usefulnessScore: 0.78,
            finalInfluenceScore: 0.8,
            sourceSupport: 0.76,
            factualContributionScore: 0.8,
            factualConfidence: 0.82,
            userFeedback: 'new_to_me',
          }),
          verification: createVerification({
            sourcePresence: 0.82,
            sourceQuality: 0.84,
            corroborationLevel: 0.8,
            factualContributionScore: 0.82,
            factualConfidence: 0.8,
            sourceType: 'official_statement',
          }),
        },
      ],
      interpolator: createInterpolator({
        summaryText: 'The thread centres on the city budget memo, with clarifications and counterpoints anchored in the linked document.',
        clarificationsAdded: ['The memo delays the cut until next quarter.'],
        newAnglesAdded: ['Some riders still feel the planning impact now.'],
        sourceSupportPresent: true,
        factualSignalPresent: true,
        heatLevel: 0.18,
        repetitionLevel: 0.12,
      }),
      entityLandscape: [
        createEntityImpact({ entityText: 'city budget memo', mentionCount: 4, canonicalLabel: 'City budget memo', matchConfidence: 0.9 }),
        createEntityImpact({ entityText: 'transit cut', mentionCount: 3, canonicalLabel: 'Transit cut', matchConfidence: 0.84 }),
      ],
      contributors: [
        createContributorImpact({ did: 'did:plc:one', handle: 'alex.test', avgUsefulnessScore: 0.86, dominantRole: 'source_bringer' }),
        createContributorImpact({ did: 'did:plc:two', handle: 'jamie.test', avgUsefulnessScore: 0.8, dominantRole: 'clarifying' }),
        createContributorImpact({ did: 'did:plc:three', handle: 'morgan.test', avgUsefulnessScore: 0.74, dominantRole: 'useful_counterpoint' }),
      ],
      confidence: {
        surfaceConfidence: 0.84,
        entityConfidence: 0.78,
        interpretiveConfidence: 0.5,
      },
      heatLevel: 0.18,
      repetitionLevel: 0.12,
      rootText: 'The city budget memo says the transit cut moves to next quarter, but people are arguing over whether that means the cut is delayed or effectively canceled.',
      rootVerification: createVerification({
        sourcePresence: 0.9,
        sourceQuality: 0.88,
        corroborationLevel: 0.8,
        factualContributionScore: 0.86,
        factualConfidence: 0.84,
        sourceType: 'primary_document',
      }),
    }));

    expect(session.interpretation.interpretiveExplanation?.mode).toBe('normal');
    expect(session.interpretation.confidence?.interpretiveConfidence ?? 0).toBeGreaterThanOrEqual(0.72);
    expect(session.interpretation.interpretiveExplanation?.boostedBy).toContain('evidence_adequacy');
    expect(session.interpretation.threadState?.interpretiveState?.contextCompleteness).toBe('high');
  });

  it('caps ambiguous, low-evidence threads into minimal fallback', () => {
    const session = finalizeSession(createFixtureSession({
      replies: [
        {
          uri: 'at://did:plc:a/app.bsky.feed.post/a',
          authorDid: 'did:plc:a',
          authorHandle: 'echo.test',
          text: 'This is bad??',
          score: createScore({
            role: 'provocative',
            usefulnessScore: 0.18,
            finalInfluenceScore: 0.22,
          }),
        },
        {
          uri: 'at://did:plc:b/app.bsky.feed.post/b',
          authorDid: 'did:plc:b',
          authorHandle: 'delta.test',
          text: 'Wait what is this even about?',
          score: createScore({
            role: 'unknown',
            usefulnessScore: 0.12,
            finalInfluenceScore: 0.18,
          }),
        },
      ],
      interpolator: createInterpolator({
        summaryText: 'The thread is focused on reactions to the post.',
        clarificationsAdded: [],
        newAnglesAdded: [],
        sourceSupportPresent: false,
        factualSignalPresent: false,
        heatLevel: 0.72,
        repetitionLevel: 0.18,
      }),
      confidence: {
        surfaceConfidence: 0.42,
        entityConfidence: 0.18,
        interpretiveConfidence: 0.24,
      },
      heatLevel: 0.72,
      repetitionLevel: 0.18,
      rootText: 'This screenshot is making people upset.',
    }));

    expect(session.interpretation.interpretiveExplanation?.mode).toBe('minimal_fallback');
    expect(session.interpretation.confidence?.interpretiveConfidence ?? 1).toBeLessThanOrEqual(0.35);
    expect(session.interpretation.interpretiveExplanation?.degradedBy).toContain('high_ambiguity');
    expect(session.interpretation.interpretiveExplanation?.degradedBy).toContain('limited_evidence');
  });
});

describe('interpretive projections', () => {
  it('hides interpolator surfaces when the feature is disabled', () => {
    const settings = useInterpolatorSettingsStore.getState();
    settings.setEnabled(false);

    try {
      const session = finalizeSession(createFixtureSession({
        replies: [],
        rootText: 'A short root post for projection gating.',
        interpolator: createInterpolator({
          summaryText: 'The thread is focused on reactions to the post.',
          heatLevel: 0.2,
          repetitionLevel: 0.1,
        }),
        confidence: {
          surfaceConfidence: 0.6,
          entityConfidence: 0.3,
          interpretiveConfidence: 0.3,
        },
        heatLevel: 0.2,
        repetitionLevel: 0.1,
      }));
      const projection = projectThreadView(session, {
        threadView: 'anchor_linear',
        maxInlineChildrenPerBranch: 3,
        deferLowPriorityBranches: true,
        showModerationWarningsInline: true,
      });

      expect(projection.interpolator.shouldRender).toBe(false);
      expect(projection.interpolator.summaryText).toBe('');
      expect(projection.interpolator.writerSummary).toBeUndefined();
    } finally {
      settings.setEnabled(true);
    }
  });

  it('keeps low-confidence thread summaries descriptive and hides weak interpolator cards', () => {
    const session = finalizeSession(createFixtureSession({
      replies: [
        {
          uri: 'at://did:plc:a/app.bsky.feed.post/a',
          authorDid: 'did:plc:a',
          authorHandle: 'echo.test',
          text: 'This is bad??',
          score: createScore({
            role: 'provocative',
            usefulnessScore: 0.18,
            finalInfluenceScore: 0.22,
          }),
        },
        {
          uri: 'at://did:plc:b/app.bsky.feed.post/b',
          authorDid: 'did:plc:b',
          authorHandle: 'delta.test',
          text: 'Wait what is this even about?',
          score: createScore({
            role: 'unknown',
            usefulnessScore: 0.12,
            finalInfluenceScore: 0.18,
          }),
        },
      ],
      interpolator: createInterpolator({
        summaryText: 'The thread is focused on reactions to the post.',
        heatLevel: 0.72,
        repetitionLevel: 0.18,
      }),
      confidence: {
        surfaceConfidence: 0.34,
        entityConfidence: 0.1,
        interpretiveConfidence: 0.2,
      },
      heatLevel: 0.72,
      repetitionLevel: 0.18,
      rootText: 'This screenshot is making people upset.',
    }));

    const projection = projectThreadView(session, {
      threadView: 'anchor_linear',
      maxInlineChildrenPerBranch: 3,
      deferLowPriorityBranches: true,
      showModerationWarningsInline: true,
    });

    expect(projection.interpolator.shouldRender).toBe(false);
    expect(projection.interpolator.summaryMode).toBe('minimal_fallback');
    expect(projection.interpolator.summaryText).toContain('This screenshot is making people upset.');
    expect(projection.interpolator.summaryText).toContain('press for specifics');
    expect(projection.interpolator.summaryText).not.toMatch(/replies are active|people are reacting/i);
  });

  it('adds epistemic guidance to composer projections', () => {
    const session = finalizeSession(createFixtureSession({
      replies: [
        {
          uri: 'at://did:plc:one/app.bsky.feed.post/1',
          authorDid: 'did:plc:one',
          authorHandle: 'alex.test',
          text: 'The city budget memo says the transit cut moves to next quarter, and the linked PDF repeats that timeline.',
          score: createScore({
            role: 'source_bringer',
            usefulnessScore: 0.86,
            finalInfluenceScore: 0.9,
            sourceSupport: 0.9,
            factualContributionScore: 0.92,
            factualConfidence: 0.9,
          }),
          verification: createVerification({
            sourcePresence: 0.95,
            sourceQuality: 0.92,
            corroborationLevel: 0.82,
            factualContributionScore: 0.94,
            factualConfidence: 0.9,
            sourceType: 'primary_document',
          }),
        },
        {
          uri: 'at://did:plc:two/app.bsky.feed.post/2',
          authorDid: 'did:plc:two',
          authorHandle: 'jamie.test',
          text: 'That matches the council notes: the city budget memo delays the transit cut to next quarter, not canceling it, which clears up the confusion.',
          score: createScore({
            role: 'clarifying',
            usefulnessScore: 0.8,
            finalInfluenceScore: 0.82,
            clarificationValue: 0.88,
            sourceSupport: 0.72,
            factualContributionScore: 0.82,
            factualConfidence: 0.84,
            userFeedback: 'clarifying',
          }),
          verification: createVerification({
            sourcePresence: 0.8,
            sourceQuality: 0.86,
            corroborationLevel: 0.76,
            factualContributionScore: 0.84,
            factualConfidence: 0.82,
            sourceType: 'official_statement',
          }),
        },
        {
          uri: 'at://did:plc:three/app.bsky.feed.post/3',
          authorDid: 'did:plc:three',
          authorHandle: 'morgan.test',
          text: 'A counterpoint: the city budget memo moves the accounting line to next quarter, but rider impact from the transit cut still lands now because service planning already changed.',
          score: createScore({
            role: 'useful_counterpoint',
            usefulnessScore: 0.74,
            finalInfluenceScore: 0.8,
            sourceSupport: 0.62,
            factualContributionScore: 0.7,
            factualConfidence: 0.74,
          }),
          verification: createVerification({
            sourcePresence: 0.7,
            sourceQuality: 0.78,
            corroborationLevel: 0.72,
            contradictionLevel: 0.24,
            factualContributionScore: 0.76,
            factualConfidence: 0.72,
            sourceType: 'reputable_reporting',
          }),
        },
      ],
      interpolator: createInterpolator({
        summaryText: 'The thread centres on the city budget memo, with clarifications and counterpoints anchored in the linked document.',
        clarificationsAdded: ['The memo delays the cut until next quarter.'],
        newAnglesAdded: ['Some riders still feel the planning impact now.'],
        sourceSupportPresent: true,
        factualSignalPresent: true,
        heatLevel: 0.18,
        repetitionLevel: 0.12,
      }),
      entityLandscape: [
        createEntityImpact({ entityText: 'city budget memo', mentionCount: 3, canonicalLabel: 'City budget memo', matchConfidence: 0.9 }),
      ],
      confidence: {
        surfaceConfidence: 0.84,
        entityConfidence: 0.78,
        interpretiveConfidence: 0.5,
      },
      heatLevel: 0.18,
      repetitionLevel: 0.12,
      rootText: 'The city budget memo says the transit cut moves to next quarter, but people are arguing over whether that means the cut is delayed or effectively canceled.',
      rootVerification: createVerification({
        sourcePresence: 0.9,
        sourceQuality: 0.88,
        corroborationLevel: 0.8,
        factualContributionScore: 0.86,
        factualConfidence: 0.84,
        sourceType: 'primary_document',
      }),
    }));

    const context = projectComposerContext({
      session,
      replyToUri: 'at://did:plc:two/app.bsky.feed.post/2',
      draftText: 'I think the document clears it up.',
    });

    expect(context.summaries?.threadSummary).toContain('city budget memo');
    expect(context.summaries?.epistemicSummary?.disagreementType).toBe('interpretive');
    expect((context.summaries?.epistemicSummary?.confidenceWarnings.length ?? 0)).toBeGreaterThan(0);
  });

  it('projects premium deep interpolator context into thread and composer views', () => {
    const baseSession = finalizeSession(createFixtureSession({
      replies: [
        {
          uri: 'at://did:plc:one/app.bsky.feed.post/1',
          authorDid: 'did:plc:one',
          authorHandle: 'alex.test',
          text: 'The city budget memo delays the transit cut to next quarter.',
          score: createScore({
            role: 'source_bringer',
            usefulnessScore: 0.84,
            finalInfluenceScore: 0.88,
            sourceSupport: 0.88,
            factualContributionScore: 0.9,
            factualConfidence: 0.88,
          }),
        },
      ],
      interpolator: createInterpolator({
        summaryText: 'The city budget memo says the transit cut moves to next quarter. Replies add sourcing and timeline clarification.',
        sourceSupportPresent: true,
        factualSignalPresent: true,
        heatLevel: 0.12,
        repetitionLevel: 0.08,
      }),
      confidence: {
        surfaceConfidence: 0.82,
        entityConfidence: 0.72,
        interpretiveConfidence: 0.76,
      },
      heatLevel: 0.12,
      repetitionLevel: 0.08,
      rootText: 'The city budget memo says the transit cut moves to next quarter.',
    }));

    const session: ConversationSession = {
      ...baseSession,
      interpretation: {
        ...baseSession.interpretation,
        premium: {
          status: 'ready',
          entitlements: {
            tier: 'pro',
            capabilities: ['deep_interpolator'],
            providerAvailable: true,
            provider: 'gemini',
          },
          deepInterpolator: {
            summary: 'The deeper dispute is less about the memo text than about whether administrative timing changes rider impact immediately.',
            groundedContext: 'Replies distinguish between the accounting timeline and the service-planning timeline.',
            perspectiveGaps: ['No reply directly addresses how riders experience the change before next quarter.'],
            followUpQuestions: ['What changes take effect for riders before the accounting shift lands?'],
            confidence: 0.74,
            provider: 'gemini',
            updatedAt: '2026-03-30T12:12:00.000Z',
            sourceComputedAt: '2026-03-30T12:10:00.000Z',
          },
        },
      },
    };

    const threadProjection = projectThreadView(session, {
      threadView: 'anchor_linear',
      maxInlineChildrenPerBranch: 3,
      deferLowPriorityBranches: true,
      showModerationWarningsInline: true,
    });
    const composerContext = projectComposerContext({
      session,
      draftText: 'I want to respond with the rider-impact angle.',
    });

    expect(threadProjection.interpolator.premium.status).toBe('ready');
    expect(threadProjection.interpolator.premium.deepInterpolator?.provider).toBe('gemini');
    expect(composerContext.summaries?.premiumContext?.groundedContext).toContain('service-planning timeline');
    expect(composerContext.summaries?.premiumContext?.perspectiveGaps[0]).toContain('riders');
  });
});

function finalizeSession(session: ConversationSession): ConversationSession {
  const qualityAnnotated = annotateConversationQuality(session);
  const interpretive = applyInterpretiveConfidence(qualityAnnotated);

  return {
    ...interpretive,
    interpretation: {
      ...interpretive.interpretation,
      threadState: deriveThreadStateSignal(interpretive),
    },
  };
}

function createFixtureSession(params: {
  replies: Array<{
    uri: string;
    authorDid: string;
    authorHandle: string;
    text: string;
    score: ContributionScores;
    verification?: VerificationOutcome;
  }>;
  interpolator: ThreadInterpolatorState;
  confidence: ConversationSession['interpretation']['confidence'];
  entityLandscape?: EntityImpact[];
  contributors?: ContributorImpact[];
  heatLevel: number;
  repetitionLevel: number;
  rootText: string;
  rootVerification?: VerificationOutcome;
}): ConversationSession {
  const root = createNode({
    uri: ROOT_URI,
    cid: 'root-cid',
    authorDid: 'did:plc:root',
    authorHandle: 'root.test',
    text: params.rootText,
    createdAt: '2026-03-30T12:00:00.000Z',
    branchDepth: 0,
    siblingIndex: 0,
    descendantCount: params.replies.length,
  });

  const replies = params.replies.map((reply, index) => createNode({
    uri: reply.uri,
    cid: `cid-${index}`,
    authorDid: reply.authorDid,
    authorHandle: reply.authorHandle,
    text: reply.text,
    createdAt: `2026-03-30T12:${String(index + 1).padStart(2, '0')}:00.000Z`,
    parentUri: ROOT_URI,
    parentAuthorHandle: root.authorHandle,
    branchDepth: 1,
    siblingIndex: index,
    descendantCount: 0,
  }));

  root.replies = replies;

  const nodesByUri: Record<string, ConversationNode> = {
    [ROOT_URI]: root,
  };
  const childUrisByParent: Record<string, string[]> = {
    [ROOT_URI]: replies.map((reply) => reply.uri),
  };
  const parentUriByChild: Record<string, string | undefined> = {
    [ROOT_URI]: undefined,
  };

  for (const reply of replies) {
    nodesByUri[reply.uri] = reply;
    childUrisByParent[reply.uri] = [];
    parentUriByChild[reply.uri] = ROOT_URI;
  }

  return {
    id: ROOT_URI,
    mode: 'thread',
    graph: {
      rootUri: ROOT_URI,
      nodesByUri,
      childUrisByParent,
      parentUriByChild,
      subtreeEndHints: {},
    },
    structure: {
      focusedAnchorUri: ROOT_URI,
      visibleUris: [],
      deferredUris: [],
      hiddenUris: [],
      revealedWarnUris: [],
      unresolvedChildCountsByUri: {},
    },
    interpretation: {
      interpolator: {
        ...params.interpolator,
        entityLandscape: params.entityLandscape ?? params.interpolator.entityLandscape,
        topContributors: params.contributors ?? params.interpolator.topContributors,
        replyScores: Object.fromEntries(
          params.replies.map((reply) => [reply.uri, toLegacyContributionScore(reply.score)]),
        ),
      },
      scoresByUri: Object.fromEntries(params.replies.map((reply) => [reply.uri, reply.score])),
      writerResult: null,
      confidence: params.confidence,
      summaryMode: null,
      threadState: null,
      interpretiveExplanation: null,
      lastComputedAt: '2026-03-30T12:10:00.000Z',
      premium: {
        status: 'idle',
      },
    },
    evidence: {
      verificationByUri: Object.fromEntries(
        params.replies
          .filter((reply) => reply.verification !== undefined)
          .map((reply) => [reply.uri, reply.verification!]),
      ),
      rootVerification: params.rootVerification ?? null,
    },
    entities: {
      writerEntities: [],
      canonicalEntities: [],
      entityLandscape: params.entityLandscape ?? [],
    },
    contributors: {
      contributors: params.contributors ?? [],
      topContributorDids: (params.contributors ?? []).map((contributor) => contributor.did),
    },
    translations: {
      byUri: {},
    },
    trajectory: {
      direction: 'forming',
      heatLevel: params.heatLevel,
      repetitionLevel: params.repetitionLevel,
      activityVelocity: 0,
      turningPoints: [],
      snapshots: [],
    },
    mutations: {
      revision: 0,
      recent: [],
    },
    meta: {
      status: 'ready',
      error: null,
      lastHydratedAt: '2026-03-30T12:10:00.000Z',
    },
  };
}

function createNode(overrides: Partial<ConversationNode> & Pick<ConversationNode, 'uri' | 'cid' | 'authorDid' | 'authorHandle' | 'text' | 'createdAt' | 'branchDepth' | 'siblingIndex' | 'descendantCount'>): ConversationNode {
  return {
    uri: overrides.uri,
    cid: overrides.cid,
    authorDid: overrides.authorDid,
    authorHandle: overrides.authorHandle,
    text: overrides.text,
    createdAt: overrides.createdAt,
    likeCount: overrides.likeCount ?? 0,
    replyCount: overrides.replyCount ?? 0,
    repostCount: overrides.repostCount ?? 0,
    facets: overrides.facets ?? [],
    embed: overrides.embed ?? null,
    labels: overrides.labels ?? [],
    depth: overrides.depth ?? overrides.branchDepth,
    replies: overrides.replies ?? [],
    branchDepth: overrides.branchDepth,
    siblingIndex: overrides.siblingIndex,
    descendantCount: overrides.descendantCount,
    ...(overrides.parentUri ? { parentUri: overrides.parentUri } : {}),
    ...(overrides.parentAuthorHandle ? { parentAuthorHandle: overrides.parentAuthorHandle } : {}),
  };
}

function createScore(
  overrides: Partial<ContributionScores> & Pick<ContributionScores, 'role' | 'usefulnessScore' | 'finalInfluenceScore'> & {
    factualContributionScore?: number;
    factualConfidence?: number;
  },
): ContributionScores {
  const factual = overrides.factual
    ?? (
      overrides.factualContributionScore !== undefined || overrides.factualConfidence !== undefined
        ? {
            claimPresent: true,
            claimType: 'factual_assertion',
            knownFactCheckMatch: false,
            factCheckMatchConfidence: 0,
            sourcePresence: overrides.sourceSupport ?? 0,
            sourceType: 'reputable_reporting',
            sourceQuality: overrides.sourceSupport ?? 0,
            quoteFidelity: 0,
            corroborationLevel: overrides.sourceSupport ?? 0,
            contradictionLevel: 0,
            mediaContextConfidence: 0,
            entityGrounding: 0,
            contextValue: 0,
            correctionValue: 0,
            citedUrls: [],
            quotedTextSpans: [],
            factualContributionScore: overrides.factualContributionScore ?? 0,
            factualConfidence: overrides.factualConfidence ?? 0,
            factualState: 'well-supported',
            reasons: [],
          }
        : null
    );

  return {
    uri: overrides.uri ?? 'at://did:plc:test/app.bsky.feed.post/test',
    role: overrides.role,
    finalInfluenceScore: overrides.finalInfluenceScore,
    clarificationValue: overrides.clarificationValue ?? 0,
    sourceSupport: overrides.sourceSupport ?? 0,
    visibleChips: overrides.visibleChips ?? [],
    factual,
    usefulnessScore: overrides.usefulnessScore,
    abuseScore: overrides.abuseScore ?? 0,
    evidenceSignals: overrides.evidenceSignals ?? [],
    entityImpacts: overrides.entityImpacts ?? [],
    scoredAt: overrides.scoredAt ?? '2026-03-30T12:00:00.000Z',
    ...(overrides.userFeedback ? { userFeedback: overrides.userFeedback } : {}),
  };
}

function createVerification(overrides: Partial<VerificationOutcome>): VerificationOutcome {
  return {
    request: {
      postUri: overrides.request?.postUri ?? 'at://did:plc:test/app.bsky.feed.post/test',
      text: overrides.request?.text ?? '',
    },
    extractedClaims: {
      claims: [],
    },
    factCheck: null,
    grounding: null,
    media: null,
    claimType: overrides.claimType ?? 'factual_assertion',
    sourceType: overrides.sourceType ?? 'reputable_reporting',
    ...(overrides.sourceDomain ? { sourceDomain: overrides.sourceDomain } : {}),
    citedUrls: overrides.citedUrls ?? [],
    quotedTextSpans: overrides.quotedTextSpans ?? [],
    checkability: overrides.checkability ?? 0.7,
    sourcePresence: overrides.sourcePresence ?? 0.7,
    sourceQuality: overrides.sourceQuality ?? 0.7,
    quoteFidelity: overrides.quoteFidelity ?? 0.7,
    specificity: overrides.specificity ?? 0.65,
    contextValue: overrides.contextValue ?? 0.6,
    entityGrounding: overrides.entityGrounding ?? 0.6,
    correctionValue: overrides.correctionValue ?? 0.2,
    corroborationLevel: overrides.corroborationLevel ?? 0.65,
    contradictionLevel: overrides.contradictionLevel ?? 0.1,
    mediaContextConfidence: overrides.mediaContextConfidence ?? 0,
    factualContributionScore: overrides.factualContributionScore ?? 0.7,
    factualConfidence: overrides.factualConfidence ?? 0.7,
    factualState: overrides.factualState ?? 'well-supported',
    reasons: overrides.reasons ?? ['primary-source-cited'],
    diagnostics: {
      providerFailures: [],
      latencyMs: 10,
    },
  };
}

function createInterpolator(overrides: Partial<ThreadInterpolatorState>): ThreadInterpolatorState {
  return {
    rootUri: ROOT_URI,
    summaryText: overrides.summaryText ?? '',
    salientClaims: overrides.salientClaims ?? [],
    salientContributors: overrides.salientContributors ?? [],
    clarificationsAdded: overrides.clarificationsAdded ?? [],
    newAnglesAdded: overrides.newAnglesAdded ?? [],
    repetitionLevel: overrides.repetitionLevel ?? 0,
    heatLevel: overrides.heatLevel ?? 0,
    sourceSupportPresent: overrides.sourceSupportPresent ?? false,
    updatedAt: overrides.updatedAt ?? '2026-03-30T12:10:00.000Z',
    version: overrides.version ?? 1,
    replyScores: overrides.replyScores ?? {},
    entityLandscape: overrides.entityLandscape ?? [],
    topContributors: overrides.topContributors ?? [],
    evidencePresent: overrides.evidencePresent ?? false,
    factualSignalPresent: overrides.factualSignalPresent ?? false,
    lastTrigger: overrides.lastTrigger ?? null,
    triggerHistory: overrides.triggerHistory ?? [],
  };
}

function createEntityImpact(overrides: Partial<EntityImpact> & Pick<EntityImpact, 'entityText' | 'mentionCount'>): EntityImpact {
  return {
    entityText: overrides.entityText,
    entityKind: overrides.entityKind ?? 'concept',
    sentimentShift: overrides.sentimentShift ?? 0,
    isNewEntity: overrides.isNewEntity ?? true,
    mentionCount: overrides.mentionCount,
    ...(overrides.canonicalEntityId ? { canonicalEntityId: overrides.canonicalEntityId } : {}),
    ...(overrides.canonicalLabel ? { canonicalLabel: overrides.canonicalLabel } : {}),
    ...(overrides.matchConfidence !== undefined ? { matchConfidence: overrides.matchConfidence } : {}),
  };
}

function createContributorImpact(overrides: Partial<ContributorImpact> & Pick<ContributorImpact, 'did' | 'avgUsefulnessScore' | 'dominantRole'>): ContributorImpact {
  return {
    did: overrides.did,
    ...(overrides.handle ? { handle: overrides.handle } : {}),
    totalReplies: overrides.totalReplies ?? 1,
    avgUsefulnessScore: overrides.avgUsefulnessScore,
    dominantRole: overrides.dominantRole,
    factualContributions: overrides.factualContributions ?? 1,
  };
}

function toLegacyContributionScore(score: ContributionScores): ContributionScore {
  return {
    uri: score.uri,
    role: score.role,
    usefulnessScore: score.usefulnessScore,
    abuseScore: score.abuseScore,
    ...(score.userFeedback ? { userFeedback: score.userFeedback } : {}),
    scoredAt: score.scoredAt,
    evidenceSignals: score.evidenceSignals,
    entityImpacts: score.entityImpacts,
    factualContribution: score.factual?.factualContributionScore ?? 0,
    knownFactCheckMatch: score.factual?.knownFactCheckMatch ?? false,
    factCheckMatchConfidence: score.factual?.factCheckMatchConfidence ?? 0,
    mediaContextConfidence: score.factual?.mediaContextConfidence ?? 0,
  };
}
