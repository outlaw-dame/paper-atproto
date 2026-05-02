import { describe, expect, it } from 'vitest';
import type { MediaAnalysisRequest, MediaAnalysisResult } from '../intelligence/llmContracts';
import type { ContributionScores } from '../intelligence/interpolatorTypes';
import type { ThreadNode } from '../lib/resolver/atproto';
import {
  executeConversationCoordinatorMediaStage,
  planConversationCoordinatorMediaStage,
  type ConversationCoordinatorMediaFailureLogEvent,
} from './coordinatorMediaStageExecutor';

const ROOT_URI = 'at://did:plc:test/app.bsky.feed.post/root';
const REPLY_URI = 'at://did:plc:test/app.bsky.feed.post/reply';

function createNode(overrides: Partial<ThreadNode> = {}): ThreadNode {
  return {
    uri: ROOT_URI,
    cid: 'cid-root',
    authorDid: 'did:plc:test',
    authorHandle: 'example.test',
    text: 'Look at this.',
    createdAt: '2026-05-01T20:00:00.000Z',
    likeCount: 0,
    replyCount: 0,
    repostCount: 0,
    facets: [],
    embed: null,
    labels: [],
    depth: 0,
    replies: [],
    ...overrides,
  };
}

function createScore(uri: string, overrides: Partial<ContributionScores> = {}): ContributionScores {
  return {
    uri,
    role: 'unknown',
    finalInfluenceScore: 0.2,
    clarificationValue: 0,
    sourceSupport: 0,
    visibleChips: [],
    factual: null,
    usefulnessScore: 0.2,
    abuseScore: 0,
    evidenceSignals: [],
    entityImpacts: [],
    scoredAt: '2026-05-01T20:00:00.000Z',
    ...overrides,
  };
}

const MEDIA_REQUEST: MediaAnalysisRequest = {
  threadId: ROOT_URI,
  mediaUrl: 'https://example.test/image.jpg',
  mediaAlt: 'screenshot of a chart',
  nearbyText: 'Look at this.',
  candidateEntities: [],
  factualHints: [],
};

function createMediaResult(overrides: Partial<MediaAnalysisResult> = {}): MediaAnalysisResult {
  return {
    mediaCentrality: 0.8,
    mediaType: 'screenshot',
    extractedText: 'Chart text',
    mediaSummary: 'The image shows a chart.',
    candidateEntities: [],
    confidence: 0.8,
    cautionFlags: [],
    analysisStatus: 'complete',
    moderationStatus: 'authoritative',
    ...overrides,
  };
}

describe('coordinator media stage executor', () => {
  it('skips planning when multimodal signals are below threshold', () => {
    const plan = planConversationCoordinatorMediaStage({
      threadId: ROOT_URI,
      root: createNode({ text: 'Plain text thread.' }),
      replies: [],
      scores: {},
      nearbyTextByUri: {},
    });

    expect(plan).toEqual({
      schemaVersion: 1,
      shouldRun: false,
      reason: 'multimodal_not_needed',
      requests: [],
      requestCount: 0,
    });
  });

  it('plans media analysis requests using the existing media selector', () => {
    const root = createNode({
      embed: {
        kind: 'images',
        images: [
          {
            url: 'https://example.test/image.jpg',
            alt: 'screenshot of a chart',
          },
        ],
      },
    });
    const reply = createNode({
      uri: REPLY_URI,
      cid: 'cid-reply',
      depth: 1,
      text: 'This screenshot seems important.',
    });

    const plan = planConversationCoordinatorMediaStage({
      threadId: ROOT_URI,
      root,
      replies: [reply],
      scores: {
        [REPLY_URI]: createScore(REPLY_URI),
      },
      nearbyTextByUri: {
        [ROOT_URI]: 'Translated nearby text.',
      },
    });

    expect(plan.shouldRun).toBe(true);
    if (!plan.shouldRun) throw new Error('Expected media plan to run.');
    expect(plan.requestCount).toBe(1);
    expect(plan.requests[0]).toMatchObject({
      threadId: ROOT_URI,
      mediaUrl: 'https://example.test/image.jpg',
      mediaAlt: 'screenshot of a chart',
      nearbyText: 'Translated nearby text.',
    });
  });

  it('skips planning when signals are high but no media candidates can be selected', () => {
    const root = createNode({
      embed: {
        kind: 'recordWithMedia',
        quotedUri: 'at://did:plc:test/app.bsky.feed.post/quoted',
      },
    });
    const reply = createNode({
      uri: REPLY_URI,
      cid: 'cid-reply',
      depth: 1,
      text: 'This screenshot is missing from the context.',
    });

    const plan = planConversationCoordinatorMediaStage({
      threadId: ROOT_URI,
      root,
      replies: [reply],
      scores: {
        [REPLY_URI]: createScore(REPLY_URI),
      },
      nearbyTextByUri: {},
    });

    expect(plan).toEqual({
      schemaVersion: 1,
      shouldRun: false,
      reason: 'no_media_candidates',
      requests: [],
      requestCount: 0,
    });
  });

  it('executes selected media requests and merges successful findings', async () => {
    const outcome = await executeConversationCoordinatorMediaStage({
      threadId: ROOT_URI,
      requests: [MEDIA_REQUEST],
      analyzeMedia: async () => createMediaResult(),
    });

    expect(outcome).toEqual({
      schemaVersion: 1,
      status: 'ready',
      findings: [
        {
          mediaType: 'screenshot',
          summary: 'The image shows a chart.',
          confidence: 0.8,
          extractedText: 'Chart text',
          analysisStatus: 'complete',
          moderationStatus: 'authoritative',
        },
      ],
      attempted: 1,
      failures: 0,
      reasonCodes: ['media_analysis_ready'],
    });
  });

  it('degrades softly on partial media failures', async () => {
    const events: ConversationCoordinatorMediaFailureLogEvent[] = [];
    const outcome = await executeConversationCoordinatorMediaStage({
      threadId: ROOT_URI,
      requests: [
        MEDIA_REQUEST,
        { ...MEDIA_REQUEST, mediaUrl: 'https://example.test/second.jpg' },
      ],
      analyzeMedia: async (request) => {
        if (request.mediaUrl.includes('second')) throw new Error('temporary provider failure');
        return createMediaResult();
      },
      logFailure: (event) => events.push(event),
    });

    expect(outcome).toMatchObject({
      schemaVersion: 1,
      status: 'ready',
      attempted: 2,
      failures: 1,
      reasonCodes: ['media_analysis_ready', 'partial_media_failures'],
    });
    expect(events).toEqual([
      {
        event: 'conversation.multimodal.degraded',
        threadId: ROOT_URI,
        attempted: 2,
        failures: 1,
      },
    ]);
  });

  it('returns an error outcome when all selected media fail', async () => {
    const outcome = await executeConversationCoordinatorMediaStage({
      threadId: ROOT_URI,
      requests: [MEDIA_REQUEST],
      analyzeMedia: async () => {
        throw new Error('provider unavailable');
      },
    });

    expect(outcome).toEqual({
      schemaVersion: 1,
      status: 'error',
      error: 'Multimodal analysis failed for all selected media.',
      attempted: 1,
      failures: 1,
      reasonCodes: ['all_selected_media_failed'],
    });
  });

  it('propagates aborts instead of converting them to soft failures', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';

    await expect(executeConversationCoordinatorMediaStage({
      threadId: ROOT_URI,
      requests: [MEDIA_REQUEST],
      analyzeMedia: async () => {
        throw abortError;
      },
    })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(executeConversationCoordinatorMediaStage({
      threadId: ROOT_URI,
      requests: [MEDIA_REQUEST],
      signal: controller.signal,
      analyzeMedia: async () => createMediaResult(),
    })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
