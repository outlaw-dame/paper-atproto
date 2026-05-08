// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MockPost } from '../data/mockData';

vi.mock('framer-motion', () => {
  const MotionDiv = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ children, ...props }, ref) => <div ref={ref} {...props}>{children}</div>,
  );
  MotionDiv.displayName = 'MotionDiv';

  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: {
      div: MotionDiv,
    },
  };
});

vi.mock('../intelligence/modelClient', () => ({
  callMediaAnalyzer: vi.fn().mockResolvedValue({
    mediaType: 'photo',
    mediaSummary: 'A test image.',
    extractedText: '',
    confidence: 0.9,
    safety: { isSensitive: false, reasons: [] },
    mediaCentrality: 0.2,
    analysisStatus: 'complete',
    moderationStatus: 'available',
  }),
}));

vi.mock('./ProfileCardTrigger', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./InlineTranslation', () => ({
  default: ({ renderText, sourceText }: { renderText: (text: string) => React.ReactNode; sourceText: string }) => (
    <>{renderText(sourceText)}</>
  ),
  TranslateIcon: () => null,
}));

vi.mock('./TwemojiText', () => ({
  default: ({ text }: { text: string }) => <>{text}</>,
}));

vi.mock('./Gif', () => ({
  Gif: () => <div data-testid="gif" />,
}));

vi.mock('./VideoPlayer', () => ({
  default: () => <div data-testid="video-player" />,
}));

vi.mock('./YouTubeEmbedCard', () => ({
  default: () => <div data-testid="youtube-embed-card" />,
}));

vi.mock('./SportsAccountBadge', () => ({
  OfficialSportsBadge: () => <span data-testid="sports-badge" />,
  SportsPostIndicator: () => <div data-testid="sports-post-indicator" />,
}));

vi.mock('../hooks/useProfileNavigation', () => ({
  useProfileNavigation: () => vi.fn(),
}));

const { default: PostCard } = await import('./PostCard');
const { useSensitiveMediaStore } = await import('../store/sensitiveMediaStore');

Element.prototype.scrollTo = vi.fn();

function createPost(overrides: Partial<MockPost> = {}): MockPost {
  return {
    id: 'post-sensitive-image',
    author: {
      did: 'did:plc:test',
      handle: 'tester.example',
      displayName: 'Tester',
    },
    content: 'A post with media',
    createdAt: new Date('2026-05-05T12:00:00Z').toISOString(),
    likeCount: 0,
    replyCount: 0,
    repostCount: 0,
    bookmarkCount: 0,
    media: [
      {
        type: 'image',
        url: 'https://example.test/image.jpg',
        alt: 'Sensitive test image',
        aspectRatio: 16 / 9,
      },
    ],
    chips: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  useSensitiveMediaStore.setState({
    policy: {
      blurSensitiveMedia: true,
      allowReveal: true,
      telemetryOptIn: false,
    },
    revealedPostIds: {},
  });
});

describe('PostCard media interactions', () => {
  it('reveals and re-hides blurred sensitive media without opening the story card', () => {
    const onOpenStory = vi.fn();
    const post = createPost({
      sensitiveMedia: {
        isSensitive: true,
        reasons: ['sexual'],
        action: 'blur',
        allowReveal: true,
      },
    });

    render(<PostCard post={post} onOpenStory={onOpenStory} index={0} />);

    fireEvent.click(screen.getByRole('button', { name: /sensitive media hidden/i }));
    expect(onOpenStory).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /hide sensitive media/i })).toBeTruthy();

    fireEvent.click(screen.getByAltText('Sensitive test image'));
    expect(onOpenStory).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /sensitive media hidden/i })).toBeTruthy();
    expect(screen.queryByText('1/1')).toBeNull();
  });

  it('opens the image lightbox without also opening the story card', () => {
    const onOpenStory = vi.fn();

    render(<PostCard post={createPost()} onOpenStory={onOpenStory} index={0} />);

    fireEvent.click(screen.getByAltText('Sensitive test image'));

    expect(onOpenStory).not.toHaveBeenCalled();
    expect(screen.getByText('1/1')).toBeTruthy();
  });
});
