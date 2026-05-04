import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function mockJsonResponse(payload: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    },
  });
}

async function loadEntityLinkingProvider() {
  const config = await import('../../server/src/config/env.js');
  Object.assign(config.env, {
    VERIFY_ENTITY_LINKING_PROVIDER: process.env.VERIFY_ENTITY_LINKING_PROVIDER,
    VERIFY_ENTITY_LINKING_ENDPOINT: process.env.VERIFY_ENTITY_LINKING_ENDPOINT,
    VERIFY_WIKIDATA_ENDPOINT: process.env.VERIFY_WIKIDATA_ENDPOINT,
    VERIFY_ENTITY_LINKING_TIMEOUT_MS: Number(process.env.VERIFY_ENTITY_LINKING_TIMEOUT_MS ?? 5000),
  });
  return import('../../server/src/verification/entity-linking.provider');
}

describe('hybrid entity-linking provider hardening', () => {
  const originalProvider = process.env.VERIFY_ENTITY_LINKING_PROVIDER;
  const originalDbpediaEndpoint = process.env.VERIFY_ENTITY_LINKING_ENDPOINT;
  const originalWikidataEndpoint = process.env.VERIFY_WIKIDATA_ENDPOINT;
  const originalTimeout = process.env.VERIFY_ENTITY_LINKING_TIMEOUT_MS;

  beforeEach(() => {
    process.env.VERIFY_ENTITY_LINKING_PROVIDER = 'hybrid';
    process.env.VERIFY_ENTITY_LINKING_ENDPOINT = 'https://api.dbpedia-spotlight.org/en/annotate';
    process.env.VERIFY_WIKIDATA_ENDPOINT = 'https://www.wikidata.org/w/api.php';
    process.env.VERIFY_ENTITY_LINKING_TIMEOUT_MS = '5000';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();

    if (originalProvider == null) delete process.env.VERIFY_ENTITY_LINKING_PROVIDER;
    else process.env.VERIFY_ENTITY_LINKING_PROVIDER = originalProvider;

    if (originalDbpediaEndpoint == null) delete process.env.VERIFY_ENTITY_LINKING_ENDPOINT;
    else process.env.VERIFY_ENTITY_LINKING_ENDPOINT = originalDbpediaEndpoint;

    if (originalWikidataEndpoint == null) delete process.env.VERIFY_WIKIDATA_ENDPOINT;
    else process.env.VERIFY_WIKIDATA_ENDPOINT = originalWikidataEndpoint;

    if (originalTimeout == null) delete process.env.VERIFY_ENTITY_LINKING_TIMEOUT_MS;
    else process.env.VERIFY_ENTITY_LINKING_TIMEOUT_MS = originalTimeout;
  });

  it('fuses DBpedia and Wikidata results and emits hybrid canonical links', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('dbpedia-spotlight.org')) {
        return mockJsonResponse({
          Resources: [
            {
              '@URI': 'http://dbpedia.org/resource/Douglas_Adams',
              '@surfaceForm': 'Douglas Adams',
              '@similarityScore': '0.81',
            },
          ],
        });
      }

      return mockJsonResponse({
        search: [
          {
            id: 'Q42',
            label: 'Douglas Adams',
            match: { type: 'label', text: 'Douglas Adams' },
          },
        ],
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    const { createEntityLinkingProvider } = await loadEntityLinkingProvider();
    const provider = createEntityLinkingProvider();
    const linked = await provider.linkEntities('Douglas Adams wrote Hitchhiker\'s Guide.', ['Douglas Adams']);

    expect(linked.length).toBeGreaterThan(0);
    expect(linked[0]).toMatchObject({
      mention: 'Douglas Adams',
      canonicalId: 'wikidata:Q42',
      canonicalLabel: 'Douglas Adams',
      provider: 'hybrid',
    });
  });

  it('redacts direct identifiers before sending text to DBpedia', async () => {
    process.env.VERIFY_ENTITY_LINKING_PROVIDER = 'dbpedia';

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('dbpedia-spotlight.org')) {
        const rawBody = String(init?.body ?? '');
        const params = new URLSearchParams(rawBody);
        const outboundText = params.get('text') ?? '';

        expect(outboundText).toContain('[redacted-email]');
        expect(outboundText).toContain('[redacted-phone]');
        expect(outboundText).not.toContain('alice@example.com');

        return mockJsonResponse({ Resources: [] });
      }

      return mockJsonResponse({ search: [] });
    });

    vi.stubGlobal('fetch', fetchMock);

    const { createEntityLinkingProvider } = await loadEntityLinkingProvider();
    const provider = createEntityLinkingProvider();

    await provider.linkEntities('Contact alice@example.com or +1 (425) 555-1234 about Douglas Adams.', ['Douglas Adams']);

    expect(fetchMock).toHaveBeenCalled();
  });

  it('retries Wikidata request on 429 using retry headers', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('wikidata.org')) {
        return mockJsonResponse({ Resources: [] });
      }

      calls += 1;
      if (calls === 1) {
        return mockJsonResponse({}, 429, { 'Retry-After': '0' });
      }

      return mockJsonResponse({
        search: [{ id: 'Q42', label: 'Douglas Adams', match: { type: 'label', text: 'Douglas Adams' } }],
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    const { createEntityLinkingProvider } = await loadEntityLinkingProvider();
    const provider = createEntityLinkingProvider();
    const linked = await provider.linkEntities('Douglas Adams', ['Douglas Adams']);

    expect(calls).toBeGreaterThanOrEqual(2);
    expect(linked.find((row) => row.canonicalId === 'wikidata:Q42')).toBeDefined();
  });
});
