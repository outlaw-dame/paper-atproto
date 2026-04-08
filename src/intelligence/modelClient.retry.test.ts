import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sleepWithAbortMock } = vi.hoisted(() => ({
  sleepWithAbortMock: vi.fn(() => Promise.resolve()),
}));

vi.mock('../lib/abortSignals', async () => {
  const actual = await vi.importActual('../lib/abortSignals');
  return {
    ...actual,
    sleepWithAbort: sleepWithAbortMock,
  };
});

import {
  callInterpolatorWriter,
  callComposerGuidanceWriter,
  callMediaAnalyzer,
  callPremiumDeepInterpolator,
} from './modelClient';
import type { ThreadStateForWriter } from './llmContracts';
import { useInterpolatorSettingsStore } from '../store/interpolatorSettingsStore';

describe('modelClient retry policy', () => {
  beforeEach(() => {
    sleepWithAbortMock.mockClear();
    vi.restoreAllMocks();
    useInterpolatorSettingsStore.setState({
      enabled: true,
      premiumProviderPreference: 'auto',
    });
  });

  it('does not retry non-retryable 400 responses', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('bad request', { status: 400 }));

    await expect(callComposerGuidanceWriter({
      mode: 'reply',
      draftText: 'Draft text',
      uiState: 'caution',
      scores: {
        positiveSignal: 0.1,
        negativeSignal: 0.5,
        supportiveness: 0.2,
        constructiveness: 0.5,
        clarifying: 0.2,
        hostility: 0.1,
        dismissiveness: 0.1,
        escalation: 0.1,
        sentimentPositive: 0.1,
        sentimentNegative: 0.2,
        anger: 0.1,
        trust: 0.4,
        optimism: 0.2,
        targetedNegativity: 0.1,
        toxicity: 0.1,
      },
      constructiveSignals: ['Add context'],
      supportiveSignals: [],
      parentSignals: [],
    })).rejects.toThrow(/responded 400/i);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleepWithAbortMock).not.toHaveBeenCalled();
  });

  it('retries transient 503 responses with backoff', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('temporary outage', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        mediaCentrality: 0.7,
        mediaType: 'document',
        mediaSummary: 'A memo screenshot.',
        candidateEntities: ['Agency'],
        confidence: 0.8,
        cautionFlags: [],
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }));

    const result = await callMediaAnalyzer({
      threadId: 'thread-1',
      mediaUrl: 'https://safe.example/image.png',
      nearbyText: 'caption text',
      candidateEntities: ['Agency'],
      factualHints: [],
    });

    expect(result.mediaType).toBe('document');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepWithAbortMock).toHaveBeenCalledTimes(1);
  });

  it('falls back when model output echoes a long root-post phrase', async () => {
    const writerInput: ThreadStateForWriter = {
      threadId: 'thread-echo',
      summaryMode: 'descriptive_fallback',
      confidence: {
        surfaceConfidence: 0.68,
        entityConfidence: 0.63,
        interpretiveConfidence: 0.55,
      },
      visibleReplyCount: 5,
      rootPost: {
        uri: 'at://did:plc:author/app.bsky.feed.post/root',
        handle: 'author.test',
        text: 'City officials quietly rewrote the emergency housing policy overnight without public notice and residents are asking for source documents.',
        createdAt: '2026-04-07T00:00:00.000Z',
      },
      selectedComments: [
        {
          uri: 'at://did:plc:r1/app.bsky.feed.post/1',
          handle: 'reply.one',
          text: 'One reply cites the archived policy PDF and points to deleted language.',
          impactScore: 0.78,
          role: 'source_bringer',
        },
        {
          uri: 'at://did:plc:r2/app.bsky.feed.post/2',
          handle: 'reply.two',
          text: 'Another asks why no public hearing happened before the change.',
          impactScore: 0.66,
          role: 'clarifying',
        },
        {
          uri: 'at://did:plc:r3/app.bsky.feed.post/3',
          handle: 'reply.three',
          text: 'A third commenter disputes whether the revision happened overnight.',
          impactScore: 0.61,
          role: 'useful_counterpoint',
        },
      ],
      topContributors: [],
      safeEntities: [{ id: 'housing-policy', label: 'Emergency housing policy', type: 'topic', confidence: 0.91, impact: 0.82 }],
      factualHighlights: ['Replies reference archived policy language and meeting records.'],
      whatChangedSignals: ['source cited: archived policy text', 'clarification: timeline challenged'],
    };

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        collapsedSummary: 'City officials quietly rewrote the emergency housing policy overnight without public notice and residents are asking for source documents.',
        whatChanged: ['source cited: archived policy text'],
        contributorBlurbs: [{ handle: 'reply.one', blurb: 'Cites archived language.' }],
        abstained: false,
        mode: 'descriptive_fallback',
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }));

    const result = await callInterpolatorWriter(writerInput);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.abstained).toBe(false);
    expect(result.collapsedSummary.toLowerCase()).toContain('@author.test');
    expect(result.collapsedSummary.toLowerCase()).not.toContain('quietly rewrote the emergency housing policy overnight without public notice');
  });

  it('falls back when descriptive summaries drop the author and strong contributors', async () => {
    const writerInput: ThreadStateForWriter = {
      threadId: 'thread-missing-participants',
      summaryMode: 'descriptive_fallback',
      confidence: {
        surfaceConfidence: 0.57,
        entityConfidence: 0.49,
        interpretiveConfidence: 0.34,
      },
      visibleReplyCount: 5,
      rootPost: {
        uri: 'at://did:plc:author/app.bsky.feed.post/root',
        handle: 'author.test',
        text: 'A leaked memo says the city is closing three neighborhood clinics next month.',
        createdAt: '2026-04-07T00:00:00.000Z',
      },
      selectedComments: [
        {
          uri: 'at://did:plc:r1/app.bsky.feed.post/1',
          handle: 'records.helper',
          text: 'I found the budget appendix and it lists the three clinics by name.',
          impactScore: 0.81,
          role: 'source_bringer',
        },
        {
          uri: 'at://did:plc:r2/app.bsky.feed.post/2',
          handle: 'local.nurse',
          text: 'Were staff told before patients started hearing about this in public?',
          impactScore: 0.73,
          role: 'clarifying',
        },
      ],
      topContributors: [
        {
          handle: 'records.helper',
          role: 'source-bringer',
          impactScore: 0.81,
          stanceSummary: 'main point: found the budget appendix naming the clinics',
          stanceExcerpt: 'found the budget appendix naming the clinics',
        },
        {
          handle: 'local.nurse',
          role: 'clarifier',
          impactScore: 0.73,
          stanceSummary: 'main point: asks whether staff were warned first',
          stanceExcerpt: 'asks whether staff were warned first',
        },
      ],
      safeEntities: [{ id: 'city-clinics', label: 'city clinics', type: 'topic', confidence: 0.86, impact: 0.75 }],
      factualHighlights: ['A budget appendix lists three clinics for closure.'],
      whatChangedSignals: ['source cited: budget appendix', 'clarification: whether staff were warned first'],
    };

    vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        collapsedSummary: 'The memo says clinics may close, and replies focus on documentation and whether staff got warned.',
        whatChanged: ['source cited: budget appendix', 'clarification: whether staff were warned first'],
        contributorBlurbs: [{ handle: 'records.helper', blurb: 'Found the budget appendix.' }],
        abstained: false,
        mode: 'descriptive_fallback',
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }));

    const result = await callInterpolatorWriter(writerInput);

    expect(result.collapsedSummary).toContain('@author.test');
    expect(result.collapsedSummary).toContain('@records.helper');
  });

  it('uses specific thread-change signals in deterministic fallback copy', async () => {
    const writerInput: ThreadStateForWriter = {
      threadId: 'thread-specific-fallback',
      summaryMode: 'descriptive_fallback',
      confidence: {
        surfaceConfidence: 0.41,
        entityConfidence: 0.36,
        interpretiveConfidence: 0.24,
      },
      visibleReplyCount: 4,
      rootPost: {
        uri: 'at://did:plc:author/app.bsky.feed.post/root',
        handle: 'author.test',
        text: 'Officials say the school closure plan is a temporary budget measure.',
        createdAt: '2026-04-07T00:00:00.000Z',
      },
      selectedComments: [
        {
          uri: 'at://did:plc:r1/app.bsky.feed.post/1',
          handle: 'reply.one',
          text: 'One reply links the budget worksheet and says the closure list already exists.',
          impactScore: 0.77,
          role: 'source_bringer',
        },
        {
          uri: 'at://did:plc:r2/app.bsky.feed.post/2',
          handle: 'reply.two',
          text: 'Another asks whether parents were warned before the vote.',
          impactScore: 0.63,
          role: 'clarifying',
        },
      ],
      topContributors: [],
      safeEntities: [{ id: 'school-closure-plan', label: 'school closure plan', type: 'topic', confidence: 0.88, impact: 0.79 }],
      factualHighlights: ['A budget worksheet lists schools marked for closure.'],
      whatChangedSignals: ['source cited: budget worksheet', 'clarification: parent notice before the vote'],
    };

    vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('temporary outage', { status: 503 }))
      .mockResolvedValueOnce(new Response('temporary outage', { status: 503 }));

    const result = await callInterpolatorWriter(writerInput);

    expect(result.abstained).toBe(false);
    expect(result.collapsedSummary).toContain('budget worksheet');
    expect(result.collapsedSummary).toContain('parent notice before the vote');
    expect(result.collapsedSummary).not.toContain('Visible replies mostly ask for sourcing');
  });

  it('uses cleaner sparse-thread wording instead of "Visible replies mostly"', async () => {
    const writerInput: ThreadStateForWriter = {
      threadId: 'thread-sparse-comparison',
      summaryMode: 'descriptive_fallback',
      confidence: {
        surfaceConfidence: 0.39,
        entityConfidence: 0.31,
        interpretiveConfidence: 0.21,
      },
      visibleReplyCount: 4,
      rootPost: {
        uri: 'at://did:plc:author/app.bsky.feed.post/root',
        handle: 'author.test',
        text: "New Claude found zero-day's in OpenBSD, ffmpeg, Linux and FreeBSD.",
        createdAt: '2026-04-07T00:00:00.000Z',
      },
      selectedComments: [
        {
          uri: 'at://did:plc:r1/app.bsky.feed.post/1',
          handle: 'reply.one',
          text: 'This feels like the earlier XZ mess all over again.',
          impactScore: 0.44,
          role: 'direct_response',
        },
        {
          uri: 'at://did:plc:r2/app.bsky.feed.post/2',
          handle: 'reply.two',
          text: 'Another reply compares it to older supply-chain scares.',
          impactScore: 0.41,
          role: 'direct_response',
        },
      ],
      topContributors: [],
      safeEntities: [
        { id: 'openbsd', label: 'OpenBSD', type: 'topic', confidence: 0.92, impact: 0.8 },
        { id: 'ffmpeg', label: 'ffmpeg', type: 'topic', confidence: 0.9, impact: 0.76 },
      ],
      factualHighlights: [],
      whatChangedSignals: [],
    };

    vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('temporary outage', { status: 503 }))
      .mockResolvedValueOnce(new Response('temporary outage', { status: 503 }));

    const result = await callInterpolatorWriter(writerInput);

    expect(result.collapsedSummary).toContain('Replies add little beyond comparing it to earlier incidents.');
    expect(result.collapsedSummary).not.toContain('Visible replies mostly');
  });

  it('names strong contributors when they materially shape the fallback summary', async () => {
    const writerInput: ThreadStateForWriter = {
      threadId: 'thread-named-contributors',
      summaryMode: 'descriptive_fallback',
      confidence: {
        surfaceConfidence: 0.44,
        entityConfidence: 0.38,
        interpretiveConfidence: 0.27,
      },
      visibleReplyCount: 5,
      rootPost: {
        uri: 'at://did:plc:author/app.bsky.feed.post/root',
        handle: 'author.test',
        text: 'A leaked memo says the city is closing three neighborhood clinics next month.',
        createdAt: '2026-04-07T00:00:00.000Z',
      },
      selectedComments: [
        {
          uri: 'at://did:plc:r1/app.bsky.feed.post/1',
          handle: 'records.helper',
          text: 'I found the budget appendix and it lists the three clinics by name.',
          impactScore: 0.81,
          role: 'source_bringer',
        },
        {
          uri: 'at://did:plc:r2/app.bsky.feed.post/2',
          handle: 'local.nurse',
          text: 'Were staff told before patients started hearing about this in public?',
          impactScore: 0.73,
          role: 'clarifying',
        },
      ],
      topContributors: [
        {
          handle: 'records.helper',
          role: 'source-bringer',
          impactScore: 0.81,
          stanceSummary: 'main point: found the budget appendix naming the clinics',
          stanceExcerpt: 'found the budget appendix naming the clinics',
          resonance: 'high',
        },
        {
          handle: 'local.nurse',
          role: 'clarifier',
          impactScore: 0.73,
          stanceSummary: 'main point: asks whether staff were warned first',
          stanceExcerpt: 'asks whether staff were warned first',
          resonance: 'moderate',
        },
      ],
      safeEntities: [
        { id: 'city-clinics', label: 'city clinics', type: 'topic', confidence: 0.86, impact: 0.75 },
      ],
      factualHighlights: ['A budget appendix lists three clinics for closure.'],
      whatChangedSignals: ['source cited: budget appendix', 'clarification: whether staff were warned first'],
    };

    vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('temporary outage', { status: 503 }))
      .mockResolvedValueOnce(new Response('temporary outage', { status: 503 }));

    const result = await callInterpolatorWriter(writerInput);

    expect(result.collapsedSummary).toContain('@author.test');
    expect(result.collapsedSummary).toContain('@records.helper brings in sourcing');
    expect(result.collapsedSummary).toContain('@local.nurse clarifies a key point');
  });

  it('sends the selected premium provider header for deep interpolation requests', async () => {
    useInterpolatorSettingsStore.setState({
      enabled: true,
      premiumProviderPreference: 'openai',
    });

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        summary: 'A deeper read of the thread.',
        groundedContext: 'A grounded follow-up.',
        perspectiveGaps: [],
        followUpQuestions: [],
        confidence: 0.81,
        provider: 'openai',
        updatedAt: new Date().toISOString(),
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }));

    const result = await callPremiumDeepInterpolator({
      actorDid: 'did:plc:test-user',
      threadId: 'thread-premium-openai',
      summaryMode: 'normal',
      confidence: {
        surfaceConfidence: 0.83,
        entityConfidence: 0.68,
        interpretiveConfidence: 0.74,
      },
      visibleReplyCount: 6,
      rootPost: {
        uri: 'at://did:plc:test/app.bsky.feed.post/root',
        handle: 'author.test',
        text: 'A leaked memo says the shelter will close next month.',
        createdAt: new Date().toISOString(),
      },
      selectedComments: [],
      topContributors: [],
      safeEntities: [],
      factualHighlights: [],
      whatChangedSignals: [],
      interpretiveBrief: {
        summaryMode: 'normal',
        supports: [],
        limits: [],
      },
    });

    expect(result.provider).toBe('openai');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = requestInit?.headers as Record<string, string> | undefined;
    expect(headers?.['X-Glympse-AI-Provider']).toBe('openai');
    expect(headers?.['X-Glympse-User-Did']).toBe('did:plc:test-user');
  });
});
