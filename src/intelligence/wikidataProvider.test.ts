import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function mockJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function loadEntityLinkingProvider() {
  const config = await import('../../server/src/config/env.js');
  Object.assign(config.env, {
    VERIFY_ENTITY_LINKING_PROVIDER: process.env.VERIFY_ENTITY_LINKING_PROVIDER,
    VERIFY_WIKIDATA_ENDPOINT: process.env.VERIFY_WIKIDATA_ENDPOINT,
    VERIFY_ENTITY_LINKING_TIMEOUT_MS: Number(process.env.VERIFY_ENTITY_LINKING_TIMEOUT_MS ?? 5000),
  });
  return import('../../server/src/verification/entity-linking.provider');
}

describe('wikidata entity-linking provider', () => {
  const originalProvider = process.env.VERIFY_ENTITY_LINKING_PROVIDER;
  const originalEndpoint = process.env.VERIFY_WIKIDATA_ENDPOINT;
  const originalTimeout = process.env.VERIFY_ENTITY_LINKING_TIMEOUT_MS;

  beforeEach(() => {
    process.env.VERIFY_ENTITY_LINKING_PROVIDER = 'wikidata';
    process.env.VERIFY_WIKIDATA_ENDPOINT = 'https://www.wikidata.org/w/api.php';
    process.env.VERIFY_ENTITY_LINKING_TIMEOUT_MS = '5000';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();

    if (originalProvider == null) delete process.env.VERIFY_ENTITY_LINKING_PROVIDER;
    else process.env.VERIFY_ENTITY_LINKING_PROVIDER = originalProvider;

    if (originalEndpoint == null) delete process.env.VERIFY_WIKIDATA_ENDPOINT;
    else process.env.VERIFY_WIKIDATA_ENDPOINT = originalEndpoint;

    if (originalTimeout == null) delete process.env.VERIFY_ENTITY_LINKING_TIMEOUT_MS;
    else process.env.VERIFY_ENTITY_LINKING_TIMEOUT_MS = originalTimeout;
  });

  it('returns wikidata:Q* canonical IDs and issues compliant wbsearchentities requests', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('action')).toBe('wbsearchentities');
      expect(url.searchParams.get('format')).toBe('json');
      expect(url.searchParams.get('formatversion')).toBe('2');
      expect(url.searchParams.get('language')).toBe('en');
      expect(url.searchParams.get('uselang')).toBe('en');
      expect(url.searchParams.get('type')).toBe('item');
      expect(url.searchParams.get('strictlanguage')).toBe('false');
      expect(url.searchParams.get('limit')).toBe('5');
      expect(url.searchParams.get('maxlag')).toBe('5');
      expect(url.searchParams.get('search')).toBe('Q42');

      return mockJsonResponse({
        search: [
          { id: 'Q1', label: 'human', match: { type: 'label', text: 'Q1' } },
          { id: 'Q42', label: 'Douglas Adams', match: { type: 'alias', text: 'Q42' } },
        ],
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    const { createEntityLinkingProvider } = await loadEntityLinkingProvider();
    const provider = createEntityLinkingProvider();
    const linked = await provider.linkEntities('', ['Q42']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({
      mention: 'Q42',
      canonicalId: 'wikidata:Q42',
      canonicalLabel: 'Douglas Adams',
      provider: 'wikidata',
    });
    expect(linked[0]?.confidence).toBeGreaterThan(0.5);
  });

  it('prefers stronger label matches over weaker alias-only candidates', async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({
      search: [
        {
          id: 'Q42',
          label: 'Douglas Noel Adams',
          match: { type: 'alias', text: 'DNA' },
        },
        {
          id: 'Q123456',
          label: 'Douglas Adams',
          match: { type: 'label', text: 'Douglas Adams' },
        },
      ],
    }));

    vi.stubGlobal('fetch', fetchMock);

    const { createEntityLinkingProvider } = await loadEntityLinkingProvider();
    const provider = createEntityLinkingProvider();
    const linked = await provider.linkEntities('', ['Douglas Adams']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(linked).toHaveLength(1);
    expect(linked[0]?.canonicalId).toBe('wikidata:Q123456');
    expect(linked[0]?.canonicalLabel).toBe('Douglas Adams');
  });
});
