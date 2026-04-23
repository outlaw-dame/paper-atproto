import { describe, expect, it } from 'vitest';

import { detectCoverageGapForCluster } from './coverageGap';

describe('detectCoverageGapForCluster', () => {
  it('detects divergent source coverage without exposing raw comparison payloads', async () => {
    const signal = await detectCoverageGapForCluster(
      {
        rootUri: 'at://did:plc:root/app.bsky.feed.post/root',
        quotedUris: [],
        externalDomains: ['official.example'],
        externalUrls: ['https://official.example/report'],
        mentionedDids: ['did:plc:one'],
        canonicalEntityIds: ['wikidata:Q1'],
      },
      {
        fetchComparisons: async () => [
          { domains: ['news.example'], mentionedDids: ['did:plc:two'], canonicalEntityIds: ['wikidata:Q1'] },
          { domains: ['archive.example'], mentionedDids: ['did:plc:three'], canonicalEntityIds: ['wikidata:Q1'] },
        ],
      },
    );

    expect(signal.kind).toBe('divergent_sources');
    expect(signal.magnitude).toBeGreaterThan(0.4);
    expect(signal.comparisonCount).toBe(2);
    expect(signal.schemaVersion).toBe(1);
    expect(JSON.stringify(signal)).not.toContain('official.example');
    expect(JSON.stringify(signal)).not.toContain('did:plc');
  });

  it('derives source divergence from external URLs when domains are absent', async () => {
    const signal = await detectCoverageGapForCluster(
      {
        rootUri: 'at://did:plc:root/app.bsky.feed.post/root',
        quotedUris: [],
        externalDomains: [],
        externalUrls: ['https://official.example/report'],
        mentionedDids: [],
        canonicalEntityIds: [],
      },
      {
        fetchComparisons: async () => [
          { externalUrls: ['https://analysis.example/report'] },
          { externalUrls: ['https://archive.example/report'] },
        ],
      },
    );

    expect(signal.kind).toBe('divergent_sources');
    expect(signal.magnitude).toBeGreaterThan(0.4);
    expect(JSON.stringify(signal)).not.toContain('official.example');
  });

  it('detects narrow participant overlap without ideological labels', async () => {
    const signal = await detectCoverageGapForCluster(
      {
        rootUri: 'at://did:plc:root/app.bsky.feed.post/root',
        quotedUris: [],
        externalDomains: ['same.example'],
        externalUrls: [],
        mentionedDids: ['did:plc:one'],
        canonicalEntityIds: [],
      },
      {
        fetchComparisons: async () => [
          { domains: ['same.example'], mentionedDids: ['did:plc:two'] },
          { domains: ['same.example'], mentionedDids: ['did:plc:three'] },
        ],
      },
    );

    expect(signal.kind).toBe('narrow_participant_set');
    expect(signal.magnitude).toBeGreaterThan(0.4);
    expect(JSON.stringify(signal)).not.toContain('did:plc');
  });

  it('fails soft when comparison lookup throws', async () => {
    const signal = await detectCoverageGapForCluster(
      {
        rootUri: 'at://did:plc:root/app.bsky.feed.post/root',
        quotedUris: [],
        externalDomains: ['official.example'],
        externalUrls: [],
        mentionedDids: [],
        canonicalEntityIds: [],
      },
      {
        fetchComparisons: async () => {
          throw new Error('temporary lookup failure');
        },
      },
    );

    expect(signal).toEqual({
      magnitude: 0,
      kind: 'none',
      comparisonCount: 0,
      schemaVersion: 1,
    });
  });
});
