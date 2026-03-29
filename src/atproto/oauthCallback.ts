const OAUTH_CALLBACK_QUERY_PARAMS = ['code', 'state', 'iss', 'error', 'error_description'];
const MAX_ERROR_DESCRIPTION_LENGTH = 200;

export interface OAuthCallbackError {
  code: string;
  description: string | null;
  message: string;
}

function normalizeCallbackValue(value: string | null): string | null {
  if (!value) return null;

  const normalized = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '')
    .trim();

  if (!normalized) return null;
  return normalized.slice(0, MAX_ERROR_DESCRIPTION_LENGTH);
}

function getSafeCallbackMessage(code: string, description: string | null): string {
  const normalizedCode = code.toLowerCase();
  const normalizedDescription = description?.toLowerCase() ?? '';

  if (
    normalizedCode === 'access_denied'
    || normalizedCode === 'cancelled'
    || normalizedDescription.includes('cancel')
    || normalizedDescription.includes('denied')
  ) {
    return 'Sign-in was cancelled.';
  }

  if (normalizedCode === 'temporarily_unavailable') {
    return 'Your ATProto provider is temporarily unavailable. Please try again shortly.';
  }

  if (normalizedCode === 'invalid_request' || normalizedCode === 'invalid_grant') {
    return 'The sign-in response was invalid. Please try again.';
  }

  return 'Could not complete OAuth sign-in. Please try again.';
}

export function hasOAuthCallbackParams(search: string): boolean {
  const params = new URLSearchParams(search);
  return OAUTH_CALLBACK_QUERY_PARAMS.some((key) => params.has(key));
}

export function getOAuthCallbackError(search: string): OAuthCallbackError | null {
  const params = new URLSearchParams(search);
  const code = normalizeCallbackValue(params.get('error'));
  if (!code) return null;

  const description = normalizeCallbackValue(params.get('error_description'));

  return {
    code,
    description,
    message: getSafeCallbackMessage(code, description),
  };
}

export function buildClearedOAuthCallbackUrl(href: string): string | null {
  const url = new URL(href);
  let changed = false;

  for (const key of OAUTH_CALLBACK_QUERY_PARAMS) {
    if (!url.searchParams.has(key)) continue;
    url.searchParams.delete(key);
    changed = true;
  }

  if (!changed) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}