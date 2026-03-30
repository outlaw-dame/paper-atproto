import { getConfiguredApiBaseUrl, resolveApiUrl } from './apiBase.js';
const BASE_URL = getConfiguredApiBaseUrl(import.meta.env?.VITE_GLYMPSE_VERIFY_BASE_URL, import.meta.env?.VITE_GLYMPSE_API_BASE_URL);
export async function searchPodcastIndex(term, max = 12) {
    const query = term.trim();
    if (!query)
        return [];
    const endpoint = new URL(resolveApiUrl('/api/podcastindex/search', BASE_URL), window.location.origin);
    endpoint.searchParams.set('term', query);
    endpoint.searchParams.set('max', String(max));
    const response = await fetch(endpoint.toString());
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Podcast Index search failed');
    }
    return payload.feeds ?? [];
}
//# sourceMappingURL=podcastIndexClient.js.map