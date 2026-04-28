import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkedEntity } from '../../server/src/verification/entity-linking.provider';
import { linkAndMatchEntities } from './entityLinking';

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/^[@#]/, '').replace(/\s+/g, ' ').trim();
}

function asServerLinkedEntitiesFromClient(text: string): LinkedEntity[] {
  const impacts = linkAndMatchEntities(text, [], new Map());
  return impacts.map((impact) => ({
    mention: impact.entityText,
    canonicalId: impact.canonicalEntityId ?? `ent:${normalizeLabel(impact.entityText)}`,
    canonicalLabel: impact.canonicalLabel ?? impact.entityText,
    confidence: Math.max(0.4, Math.min(0.98, impact.matchConfidence ?? 0.75)),
    provider: 'heuristic' as const,
  }));
}

describe('entity matching parity between client and server', () => {
  const originalProvider = process.env.VERIFY_ENTITY_LINKING_PROVIDER;

  beforeEach(() => {
    process.env.VERIFY_ENTITY_LINKING_PROVIDER = 'heuristic';
  });

  afterEach(() => {
    vi.resetModules();
    if (originalProvider == null) {
      delete process.env.VERIFY_ENTITY_LINKING_PROVIDER;
    } else {
      process.env.VERIFY_ENTITY_LINKING_PROVIDER = originalProvider;
    }
  });

  it('keeps canonical concept aliases aligned across client extraction and server linking', async () => {
    const text = 'Machine learning and at proto moderation continue to shape this fediverse thread.';
    const topicHints = ['artificial intelligence', 'bluesky protocol', 'content moderation', 'fedi'];

    const clientImpacts = linkAndMatchEntities(text, [], new Map());
    const clientConcepts = new Set(
      clientImpacts
        .filter((impact) => impact.entityKind === 'concept')
        .map((impact) => normalizeLabel(impact.canonicalLabel ?? impact.entityText)),
    );

    const { createEntityLinkingProvider } = await import('../../server/src/verification/entity-linking.provider');
    const provider = createEntityLinkingProvider();
    const serverLinked = await provider.linkEntities(text, topicHints);
    const serverConcepts = new Set(serverLinked.map((entity) => normalizeLabel(entity.canonicalLabel)));

    expect(clientConcepts.has('ai')).toBe(true);
    expect(clientConcepts.has('atproto')).toBe(true);
    expect(clientConcepts.has('moderation')).toBe(true);
    expect(clientConcepts.has('fediverse')).toBe(true);

    expect(serverConcepts.has('ai')).toBe(true);
    expect(serverConcepts.has('atproto')).toBe(true);
    expect(serverConcepts.has('moderation')).toBe(true);
    expect(serverConcepts.has('fediverse')).toBe(true);
  });

  it('keeps server grounding high for client-linked entities that match canonicalized hints', async () => {
    const text = 'Writers are debating decentralisation and fedi migration patterns.';
    const topicHints = ['decentralization', 'fediverse'];

    const linkedFromClient = asServerLinkedEntitiesFromClient(text);
    const { computeEntityGrounding } = await import('../../server/src/verification/entity-linking.provider');
    const score = computeEntityGrounding(topicHints, linkedFromClient);

    expect(score).toBeGreaterThan(0.65);
  });

  it('drops grounding when hints and linked entities diverge semantically', async () => {
    const topicHints = ['atproto governance', 'federated moderation'];
    const unrelatedEntities: LinkedEntity[] = [
      {
        mention: 'NBA playoffs',
        canonicalId: 'topic:nba-playoffs',
        canonicalLabel: 'NBA playoffs',
        confidence: 0.92,
        provider: 'heuristic',
      },
      {
        mention: 'transfer rumors',
        canonicalId: 'topic:transfer-rumors',
        canonicalLabel: 'transfer rumors',
        confidence: 0.86,
        provider: 'heuristic',
      },
    ];

    const { computeEntityGrounding } = await import('../../server/src/verification/entity-linking.provider');
    const score = computeEntityGrounding(topicHints, unrelatedEntities);

    expect(score).toBeLessThan(0.5);
  });

  it('keeps grounding above medium when hints are near the similarity threshold', async () => {
    const topicHints = ['federated moderation policy'];
    const nearMatchEntities: LinkedEntity[] = [
      {
        mention: 'federated moderation',
        canonicalId: 'topic:federated-moderation',
        canonicalLabel: 'federated moderation',
        confidence: 0.84,
        provider: 'heuristic',
      },
      {
        mention: 'trust and safety governance',
        canonicalId: 'topic:trust-safety-governance',
        canonicalLabel: 'trust and safety governance',
        confidence: 0.7,
        provider: 'heuristic',
      },
    ];

    const { computeEntityGrounding } = await import('../../server/src/verification/entity-linking.provider');
    const score = computeEntityGrounding(topicHints, nearMatchEntities);

    expect(score).toBeGreaterThanOrEqual(0.5);
  });

  it('keeps grounding low-medium when overlap is lexical but below strong semantic agreement', async () => {
    const topicHints = ['federated moderation policy'];
    const weakOverlapEntities: LinkedEntity[] = [
      {
        mention: 'moderation queue updates',
        canonicalId: 'topic:moderation-queue-updates',
        canonicalLabel: 'moderation queue updates',
        confidence: 0.8,
        provider: 'heuristic',
      },
      {
        mention: 'content timeline ranking',
        canonicalId: 'topic:content-timeline-ranking',
        canonicalLabel: 'content timeline ranking',
        confidence: 0.72,
        provider: 'heuristic',
      },
    ];

    const { computeEntityGrounding } = await import('../../server/src/verification/entity-linking.provider');
    const score = computeEntityGrounding(topicHints, weakOverlapEntities);

    expect(score).toBeGreaterThan(0.32);
    expect(score).toBeLessThan(0.58);
  });
});
