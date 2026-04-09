import { describe, expect, it } from 'vitest';

import {
  normalizeLocalResult,
  normalizePremiumProviders,
  normalizeTargets,
  summarizeEnhancerDelta,
  toLocalWriterRequest,
} from './eval_premium_providers.mjs';

describe('eval premium providers harness helpers', () => {
  it('normalizes targets with aliases and dedupes', () => {
    expect(normalizeTargets('local,local-openai,local-gemini,raw,gemini,openai,local')).toEqual([
      'local-shipped',
      'local-shipped-openai',
      'local-shipped-gemini',
      'local-raw',
      'gemini',
      'openai',
    ]);
  });

  it('falls back to all default targets when the target list is empty', () => {
    expect(normalizeTargets('')).toEqual([
      'local-shipped',
      'local-raw',
      'gemini',
      'openai',
    ]);
  });

  it('normalizes premium providers only', () => {
    expect(normalizePremiumProviders('gemini,openai,unknown')).toEqual(['gemini', 'openai']);
  });

  it('adapts premium fixture requests into local writer requests without premium-only fields', () => {
    const adapted = toLocalWriterRequest({
      actorDid: 'did:plc:test',
      threadId: 'thread-1',
      summaryMode: 'normal',
      confidence: { surfaceConfidence: 0.8, entityConfidence: 0.7, interpretiveConfidence: 0.6 },
      visibleReplyCount: 4,
      rootPost: {
        uri: 'at://root/1',
        handle: 'author.test',
        text: 'Root text',
        createdAt: '2026-04-08T15:30:00.000Z',
      },
      selectedComments: [],
      topContributors: [],
      safeEntities: [],
      factualHighlights: ['fact'],
      whatChangedSignals: ['signal'],
      interpretiveExplanation: 'brief interpretation',
      entityThemes: ['theme'],
      interpretiveBrief: {
        summaryMode: 'normal',
        supports: [],
        limits: [],
      },
    });

    expect(adapted).toEqual({
      threadId: 'thread-1',
      summaryMode: 'normal',
      confidence: { surfaceConfidence: 0.8, entityConfidence: 0.7, interpretiveConfidence: 0.6 },
      visibleReplyCount: 4,
      rootPost: {
        uri: 'at://root/1',
        handle: 'author.test',
        text: 'Root text',
        createdAt: '2026-04-08T15:30:00.000Z',
      },
      selectedComments: [],
      topContributors: [],
      safeEntities: [],
      factualHighlights: ['fact'],
      whatChangedSignals: ['signal'],
      interpretiveExplanation: 'brief interpretation',
      entityThemes: ['theme'],
    });
  });

  it('normalizes local writer responses into shared eval output shape', () => {
    expect(normalizeLocalResult('local-raw', {
      collapsedSummary: 'Summary sentence.',
      expandedSummary: 'Expanded context.',
      whatChanged: ['clarification: details'],
      contributorBlurbs: [{ handle: '@reply.one', blurb: 'adds a source' }],
      mode: 'normal',
    })).toEqual({
      target: 'local-raw',
      summary: 'Summary sentence.',
      groundedContext: 'Expanded context.',
      perspectiveGaps: [],
      followUpQuestions: [],
      meta: {
        mode: 'normal',
        whatChanged: ['clarification: details'],
        contributorBlurbs: [{ handle: '@reply.one', blurb: 'adds a source' }],
      },
    });
  });

  it('summarizes enhancer telemetry deltas', () => {
    const delta = summarizeEnhancerDelta(
      {
        enhancer: {
          invocations: 2,
          reviews: 1,
          appliedTakeovers: { candidate: 0, rescue: 0 },
          failures: { total: 0 },
          rejectedReplacements: { total: 0 },
          issueDistribution: { 'generic-summary-framing': 1, uniqueLabels: 1 },
        },
      },
      {
        enhancer: {
          invocations: 4,
          reviews: 2,
          appliedTakeovers: { candidate: 1, rescue: 0 },
          failures: { total: 1 },
          rejectedReplacements: { total: 0 },
          issueDistribution: { 'generic-summary-framing': 2, 'missing-contributor-blurbs': 1, uniqueLabels: 2 },
          lastFailure: { failureClass: 'timeout' },
        },
      },
    );

    expect(delta).toEqual({
      invocations: 2,
      reviews: 1,
      candidateTakeovers: 1,
      rescueTakeovers: 0,
      failures: 1,
      rejectedReplacements: 0,
      issueLabels: [
        { label: 'generic-summary-framing', count: 1 },
        { label: 'missing-contributor-blurbs', count: 1 },
      ],
      lastFailure: { failureClass: 'timeout' },
    });
  });
});
