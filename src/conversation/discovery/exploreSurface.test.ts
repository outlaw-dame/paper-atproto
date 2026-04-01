import { describe, expect, it } from 'vitest';
import {
  normalizeExternalExploreSearchQuery,
  normalizeHashtagFeedNavigationQuery,
  normalizePeopleFeedNavigationQuery,
  normalizeSearchStoryNavigationQuery,
  resolveVisibleDiscoverSections,
  shouldShowDiscoverSection,
  getExploreStoryTitle,
} from './exploreSurface';

describe('exploreSurface', () => {
  it('resolves visible discover sections from the active filter', () => {
    const visible = resolveVisibleDiscoverSections('Live');
    expect(visible?.has('live-sports')).toBe(true);
    expect(visible?.has('sources')).toBe(false);
  });

  it('shows all sections when no filter is active', () => {
    expect(shouldShowDiscoverSection(null, 'sources')).toBe(true);
  });

  it('normalizes external explore search queries into hashtag queries', () => {
    expect(normalizeExternalExploreSearchQuery('  #AI  ')).toBe('#AI');
    expect(normalizeExternalExploreSearchQuery('   ')).toBeNull();
  });

  it('normalizes hashtag feed queries conservatively', () => {
    expect(normalizeHashtagFeedNavigationQuery(' ##AI! now ')).toBe('#AInow');
    expect(normalizeHashtagFeedNavigationQuery('   ')).toBeNull();
  });

  it('normalizes people feed and search story queries', () => {
    expect(normalizePeopleFeedNavigationQuery('  john   doe  ')).toBe('john doe');
    expect(normalizeSearchStoryNavigationQuery('  #climate  ')).toBe('#climate');
  });

  it('builds bounded, sanitized story titles', () => {
    expect(getExploreStoryTitle('  A post title \u0000 with noise  ')).toBe('A post title with noise');
  });
});
