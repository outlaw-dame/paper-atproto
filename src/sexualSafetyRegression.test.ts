import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  filterTextContent,
  filterWriterResponse as filterWriterResponseService,
  filterPremiumDeepInterpolatorResponse,
} from '../server/src/services/safetyFilters';
import { filterResponseForSafety, filterWriterResponse as filterWriterResponseSafeguards } from '../server/src/lib/safeguards';
import { callInterpolatorWriter, callPremiumDeepInterpolator } from './intelligence/modelClient';
import type { ThreadStateForWriter } from './intelligence/llmContracts';

describe('sexual-content safety regressions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('normalizes explicit/slang sexual wording in free text', () => {
    const input = 'The post is horny and links porn with a hook up thread.';
    const result = filterTextContent(input);

    expect(result.flagged).toBe(true);
    expect(result.categories).toContain('sexual_content');
    expect(result.filtered).toMatch(/sexually aroused/i);
    expect(result.filtered).toMatch(/graphic sexual content/i);
    expect(result.filtered).toMatch(/casual sexual encounter/i);
    expect(result.filtered).not.toMatch(/\bhorny\b/i);
    expect(result.filtered).not.toMatch(/\bporn\b/i);
    expect(result.filtered).not.toMatch(/\bhook\s?up\b/i);
  });

  it('keeps contributor blurbs but formalizes sexual phrasing', () => {
    const payload = {
      collapsedSummary: 'A thread with horny reactions and porn references.',
      contributorBlurbs: [
        { handle: 'alpha', blurb: 'mentions porn and a hook up in slang.' },
      ],
    };

    const { filtered, safetyMetadata } = filterWriterResponseService(payload);

    expect(safetyMetadata.flagged).toBe(true);
    expect(safetyMetadata.categories).toContain('sexual_content');
    expect(filtered.contributorBlurbs).toHaveLength(1);
    expect(filtered.contributorBlurbs[0]?.blurb).toMatch(/graphic sexual content/i);
    expect(filtered.contributorBlurbs[0]?.blurb).toMatch(/casual sexual encounter/i);
    expect(filtered.contributorBlurbs[0]?.blurb).not.toMatch(/\bporn\b/i);
    expect(filtered.contributorBlurbs[0]?.blurb).not.toMatch(/\bhook\s?up\b/i);
  });

  it('sanitizes deterministic fallback summaries after writer abstains', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        collapsedSummary: '',
        whatChanged: [],
        contributorBlurbs: [],
        abstained: true,
        mode: 'normal',
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);

    const input: ThreadStateForWriter = {
      threadId: 't-1',
      summaryMode: 'normal',
      confidence: {
        surfaceConfidence: 0.3,
        entityConfidence: 0.2,
        interpretiveConfidence: 0.2,
      },
      rootPost: {
        uri: 'at://did:plc:test/app.bsky.feed.post/1',
        handle: 'root-user',
        text: 'Root post says people are horny and sharing porn links.',
        createdAt: new Date().toISOString(),
      },
      selectedComments: [
        {
          uri: 'at://did:plc:test/app.bsky.feed.post/2',
          handle: 'reply-user',
          text: 'A reply suggests a hook up with explicit terms.',
          impactScore: 0.91,
        },
      ],
      topContributors: [
        {
          handle: 'contrib-user',
          role: 'clarifier',
          impactScore: 0.74,
          stanceSummary: 'using horny slang and porn jokes',
        },
      ],
      safeEntities: [],
      factualHighlights: [],
      whatChangedSignals: ['people are horny and suggest a hook up'],
    };

    const output = await callInterpolatorWriter(input);

    expect(output.abstained).toBe(false);
    expect(output.collapsedSummary).toMatch(/sexually aroused|explicit sexual content|casual sexual encounter/i);
    expect(output.collapsedSummary).not.toMatch(/\bhorny\b/i);
    expect(output.collapsedSummary).not.toMatch(/\bporn\b/i);
    expect(output.whatChanged.join(' ')).not.toMatch(/\bhorny\b|\bhook\s?up\b/i);
    expect(output.contributorBlurbs[0]?.blurb ?? '').not.toMatch(/\bhorny\b|\bporn\b/i);
  });

  it('falls back when a reply-rich thread gets a root-only writer summary', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        collapsedSummary: 'Stephen Miller allegedly urged Department of Homeland Security agents to force confrontations with protesters in Minneapolis.',
        whatChanged: [],
        contributorBlurbs: [],
        abstained: false,
        mode: 'normal',
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);

    const input: ThreadStateForWriter = {
      threadId: 't-2',
      summaryMode: 'normal',
      confidence: {
        surfaceConfidence: 0.82,
        entityConfidence: 0.68,
        interpretiveConfidence: 0.74,
      },
      rootPost: {
        uri: 'at://did:plc:test/app.bsky.feed.post/root',
        handle: 'root-user',
        text: 'Stephen Miller allegedly urged Department of Homeland Security agents to “force confrontations” with protesters in Minneapolis in order to win a “PR battle.”',
        createdAt: new Date().toISOString(),
      },
      selectedComments: [
        {
          uri: 'at://did:plc:test/app.bsky.feed.post/2',
          handle: 'reply-user-1',
          text: 'Several replies argue the reporting relies on anonymous sourcing and ask for the underlying memo.',
          impactScore: 0.91,
        },
        {
          uri: 'at://did:plc:test/app.bsky.feed.post/3',
          handle: 'reply-user-2',
          text: 'Others point to Minneapolis protest footage and debate whether the phrasing reflects actual operational guidance.',
          impactScore: 0.84,
        },
        {
          uri: 'at://did:plc:test/app.bsky.feed.post/4',
          handle: 'reply-user-3',
          text: 'A few users add prior DHS examples to argue this fits an existing escalation pattern.',
          impactScore: 0.79,
        },
      ],
      topContributors: [
        {
          handle: 'reply-user-1',
          role: 'clarifier',
          impactScore: 0.82,
          stanceSummary: 'questioning the sourcing behind the claim',
        },
      ],
      safeEntities: [],
      factualHighlights: [],
      whatChangedSignals: [
        'clarification: several replies ask for the underlying memo',
        'new angle: commenters compare the claim to prior DHS protest responses',
      ],
    };

    const output = await callInterpolatorWriter(input);

    expect(output.collapsedSummary).not.toBe(
      'Stephen Miller allegedly urged Department of Homeland Security agents to force confrontations with protesters in Minneapolis.',
    );
    expect(output.collapsedSummary).toMatch(/add context|repl(?:y|ies)|commenters|others/i);
  });

  it('normalizes narrated link phrasing in writer summaries', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        collapsedSummary: 'Trump may be thinking about walking away and accepting defeat in Iran, with a link to https://time.com/article/2026/example.',
        whatChanged: [],
        contributorBlurbs: [],
        abstained: false,
        mode: 'normal',
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);

    const input: ThreadStateForWriter = {
      threadId: 't-3',
      summaryMode: 'normal',
      confidence: {
        surfaceConfidence: 0.76,
        entityConfidence: 0.62,
        interpretiveConfidence: 0.66,
      },
      rootPost: {
        uri: 'at://did:plc:test/app.bsky.feed.post/root',
        handle: 'root-user',
        text: 'Trump may be thinking about walking away and accepting defeat in Iran.',
        createdAt: new Date().toISOString(),
      },
      selectedComments: [
        {
          uri: 'at://did:plc:test/app.bsky.feed.post/reply-1',
          handle: 'reply-user',
          text: 'One reply links Time reporting and argues the White House is signaling retreat.',
          impactScore: 0.82,
        },
      ],
      topContributors: [],
      safeEntities: [],
      factualHighlights: [],
      whatChangedSignals: [],
    };

    const output = await callInterpolatorWriter(input);

    expect(output.collapsedSummary).toContain('citing Time reporting');
    expect(output.collapsedSummary).not.toMatch(/with a link to/i);
    expect(output.collapsedSummary).not.toContain('/article/2026/example');
  });

  it('normalizes narrated link phrasing in premium deep summaries', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        summary: 'The thread leans toward reading the move as a retreat, with a link to https://time.com/article/2026/example.',
        groundedContext: 'Several replies anchor that read in Time reporting.',
        perspectiveGaps: ['No direct administration statement is visible in the thread.'],
        followUpQuestions: ['Does the reporting describe a tactical pause or a broader shift?'],
        confidence: 0.72,
        provider: 'gemini',
        updatedAt: new Date().toISOString(),
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);

    const result = await callPremiumDeepInterpolator({
      actorDid: 'did:plc:test',
      threadId: 't-4',
      summaryMode: 'normal',
      confidence: {
        surfaceConfidence: 0.81,
        entityConfidence: 0.69,
        interpretiveConfidence: 0.73,
      },
      visibleReplyCount: 12,
      rootPost: {
        uri: 'at://did:plc:test/app.bsky.feed.post/root',
        handle: 'root-user',
        text: 'Trump may be thinking about walking away and accepting defeat in Iran.',
        createdAt: new Date().toISOString(),
      },
      selectedComments: [],
      topContributors: [],
      safeEntities: [],
      factualHighlights: [],
      whatChangedSignals: [],
      interpretiveBrief: {
        summaryMode: 'normal',
        baseSummary: 'The thread is split between reading the move as retreat and waiting for firmer evidence.',
        supports: [],
        limits: [],
      },
    });

    expect(result.summary).toContain('citing Time reporting');
    expect(result.summary).not.toMatch(/with a link to/i);
    expect(result.summary).not.toContain('/article/2026/example');
    expect(result.provider).toBe('gemini');
  });

  it('fails premium deep output closed when safety filtering removes the summary', () => {
    const { filtered, safetyMetadata } = filterPremiumDeepInterpolatorResponse({
      summary: 'This says a group should be eradicated.',
      groundedContext: 'Some replies repeat the same violent framing.',
      perspectiveGaps: ['No one challenges the violent phrasing.'],
      followUpQuestions: ['Who else should be targeted next?'],
      confidence: 0.81,
      provider: 'gemini',
      updatedAt: new Date().toISOString(),
    });

    expect(filtered.summary).toBe('');
    expect(safetyMetadata.passed).toBe(false);
    expect(safetyMetadata.severity).toBe('high');
    expect(safetyMetadata.categories).toContain('hate_speech');
  });

  it('normalizes explicit sexual phrasing in premium deep output', () => {
    const { filtered, safetyMetadata } = filterPremiumDeepInterpolatorResponse({
      summary: 'The thread uses horny slang and porn references to frame the allegation.',
      groundedContext: 'A linked post repeats the same hook up language.',
      perspectiveGaps: ['No reply clarifies whether the explicit framing is factual or performative.'],
      followUpQuestions: ['Are replies reacting to the allegation or the explicit sexual framing?'],
      confidence: 0.49,
      provider: 'gemini',
      updatedAt: new Date().toISOString(),
    });

    expect(filtered.summary).toMatch(/sexually aroused/i);
    expect(filtered.summary).toMatch(/graphic sexual content/i);
    expect(filtered.groundedContext).toMatch(/casual sexual encounter/i);
    expect(filtered.summary).not.toMatch(/\bhorny\b|\bporn\b/i);
    expect(safetyMetadata.flagged).toBe(true);
    expect(safetyMetadata.categories).toContain('sexual_content');
  });

  it('redacts profanity while also normalizing sexual slang in one pass', () => {
    const input = 'This is shitty and horny, with porn and hook up chatter.';
    const result = filterTextContent(input);

    expect(result.flagged).toBe(true);
    expect(result.categories).toContain('profanity');
    expect(result.categories).toContain('sexual_content');

    expect(result.filtered).toContain('[redacted]');
    expect(result.filtered).toMatch(/sexually aroused/i);
    expect(result.filtered).toMatch(/graphic sexual content/i);
    expect(result.filtered).toMatch(/casual sexual encounter/i);

    expect(result.filtered).not.toMatch(/\bshitty\b/i);
    expect(result.filtered).not.toMatch(/\bhorny\b/i);
    expect(result.filtered).not.toMatch(/\bporn\b/i);
    expect(result.filtered).not.toMatch(/\bhook\s?up\b/i);
  });

  it('safeguards normalize explicit sexual text without replacing whole response', () => {
    const input = 'Thread includes horny jokes and porn references.';
    const result = filterResponseForSafety(input);

    expect(result.isSafe).toBe(true);
    expect(result.filtered).toMatch(/sexually aroused/i);
    expect(result.filtered).toMatch(/explicit sexual content/i);
    expect(result.filtered).not.toMatch(/\bhorny\b/i);
    expect(result.filtered).not.toMatch(/\bporn\b/i);
  });

  it('tracks medium/high severity from array fields in safety metadata', () => {
    const payload = {
      collapsedSummary: 'Routine summary.',
      whatChanged: ['people are horny in replies'],
      contributorBlurbs: [
        { handle: 'alpha', blurb: 'this says go back to where they came from' },
      ],
    };

    const { safetyMetadata } = filterWriterResponseService(payload);
    expect(safetyMetadata.flagged).toBe(true);
    expect(safetyMetadata.categories).toContain('sexual_content');
    expect(safetyMetadata.categories).toContain('hate_speech');
    expect(safetyMetadata.severity).toBe('high');
  });

  it('safeguards writer filter keeps explicit-sexual blurbs by formalizing wording', () => {
    const payload = {
      collapsedSummary: 'Users share horny replies.',
      whatChanged: ['new angle: porn references increase'],
      contributorBlurbs: [
        { handle: 'alpha', blurb: 'mentions porn and a hook up detail' },
      ],
      abstained: false,
      mode: 'normal',
    };

    const { filtered } = filterWriterResponseSafeguards(payload);
    expect(filtered.collapsedSummary ?? '').toMatch(/sexually aroused/i);
    expect(filtered.whatChanged?.[0] ?? '').toMatch(/explicit sexual content/i);
    expect(filtered.contributorBlurbs?.[0]?.blurb ?? '').toMatch(/casual sexual encounter/i);
    expect(filtered.contributorBlurbs).toHaveLength(1);
  });
});
