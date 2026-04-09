import { describe, expect, it } from 'vitest';
import type { MockPost } from '../../data/mockData';
import {
  assessmentFromMediaAnalysis,
  detectSensitiveMedia,
  mergeSensitiveMediaAssessments,
} from './sensitiveMedia';

function basePost(overrides: Partial<MockPost> = {}): MockPost {
  return {
    id: 'p1',
    author: {
      did: 'did:plc:test',
      handle: 'tester.bsky.social',
      displayName: 'Tester',
    },
    content: 'hello world',
    createdAt: new Date().toISOString(),
    likeCount: 0,
    replyCount: 0,
    repostCount: 0,
    bookmarkCount: 0,
    chips: [],
    ...overrides,
  };
}

describe('detectSensitiveMedia', () => {
  it('flags visual posts with severe hate speech text for blur/warn', () => {
    const post = basePost({
      content: 'Wine drunk be different fr n i g g a',
      media: [
        { type: 'image', url: 'https://example.com/a.jpg' },
      ],
    });

    const result = detectSensitiveMedia(post);
    expect(result.isSensitive).toBe(true);
    expect(result.reasons).toContain('hate-speech');
    expect(result.action).toBe('warn');
    expect(result.allowReveal).toBe(true);
  });

  it('does not flag text-only posts when no visual media is present', () => {
    const post = basePost({ content: 'n i g g a' });

    const result = detectSensitiveMedia(post);
    expect(result.isSensitive).toBe(false);
    expect(result.action).toBe('none');
  });

  it('treats sexual or graphic labels as blur-worthy media', () => {
    const post = basePost({
      contentLabels: ['nudity'],
      media: [{ type: 'image', url: 'https://example.com/image.jpg' }],
    });

    const result = detectSensitiveMedia(post);
    expect(result.isSensitive).toBe(true);
    expect(result.action).toBe('blur');
    expect(result.allowReveal).toBe(true);
  });

  it('builds multimodal drop assessments from severe model recommendations', () => {
    const result = assessmentFromMediaAnalysis({
      cautionFlags: [],
      moderation: {
        action: 'drop',
        categories: ['child-safety'],
        confidence: 0.94,
        allowReveal: false,
        rationale: 'The image may depict exploitative content involving a child.',
      },
    });

    expect(result).toEqual({
      isSensitive: true,
      reasons: ['child-safety'],
      action: 'drop',
      allowReveal: false,
      rationale: 'The image may depict exploitative content involving a child.',
      source: 'multimodal',
    });
  });

  it('merges label-based blur signals with stronger multimodal drop recommendations', () => {
    const merged = mergeSensitiveMediaAssessments(
      {
        isSensitive: true,
        reasons: ['nudity'],
        action: 'blur',
        allowReveal: true,
        source: 'label',
      },
      {
        isSensitive: true,
        reasons: ['child-safety'],
        action: 'drop',
        allowReveal: false,
        rationale: 'Severe exploitative content detected.',
        source: 'multimodal',
      },
    );

    expect(merged).toEqual({
      isSensitive: true,
      reasons: ['nudity', 'child-safety'],
      action: 'drop',
      allowReveal: false,
      rationale: 'Severe exploitative content detected.',
      source: 'hybrid',
    });
  });
});
