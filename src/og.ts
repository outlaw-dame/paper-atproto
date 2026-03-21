/**
 * Utility to fetch and parse OpenGraph metadata from a URL.
 * In a local-first/PWA context, we need a proxy to bypass CORS.
 */

export interface OGMetadata {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

const PROXY_URL = 'https://api.allorigins.win/get?url=';

export const fetchOGData = async (url: string): Promise<OGMetadata | null> => {
  try {
    const response = await fetch(`${PROXY_URL}${encodeURIComponent(url)}`);
    if (!response.ok) throw new Error('Failed to fetch OG data');
    
    const data = await response.json();
    const html = data.contents;
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    const getMeta = (property: string) => {
      return (
        doc.querySelector(`meta[property="${property}"]`)?.getAttribute('content') ||
        doc.querySelector(`meta[name="${property}"]`)?.getAttribute('content')
      );
    };

    const metadata: OGMetadata = {
      url,
      title: getMeta('og:title') || doc.title,
      description: getMeta('og:description') || getMeta('description'),
      image: getMeta('og:image'),
      siteName: getMeta('og:site_name'),
    };

    // Handle relative image URLs
    if (metadata.image && !metadata.image.startsWith('http')) {
      const baseUrl = new URL(url);
      metadata.image = new URL(metadata.image, baseUrl.origin).toString();
    }

    return metadata;
  } catch (error) {
    console.error('Error fetching OG data:', error);
    return null;
  }
};
