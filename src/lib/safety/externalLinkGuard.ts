import { openExternalUrl, sanitizeExternalUrl } from './externalUrl';
import { recordExternalUrlGuardDroppedInvalid } from './externalUrlTelemetry';

let installedDocument: Document | null = null;

function resolveAnchorFromEventTarget(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null;
  const anchor = target.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if ((anchor.target ?? '').toLowerCase() !== '_blank') return null;
  return anchor;
}

function resolveCandidateUrl(anchor: HTMLAnchorElement): string | null {
  const rawHref = anchor.getAttribute('href') ?? anchor.href;
  const trimmed = rawHref.trim();
  if (!trimmed || trimmed === '#') return null;
  return sanitizeExternalUrl(trimmed);
}

export function installExternalLinkGuard(): void {
  if (typeof document === 'undefined' || installedDocument === document) return;
  installedDocument = document;

  const guardAndOpen = (event: Event): void => {
    if (event.defaultPrevented) return;

    const anchor = resolveAnchorFromEventTarget(event.target);
    if (!anchor) return;

    const safeUrl = resolveCandidateUrl(anchor);
    if (!safeUrl) {
      recordExternalUrlGuardDroppedInvalid();
      event.preventDefault();
      return;
    }

    event.preventDefault();
    void openExternalUrl(safeUrl);
  };

  document.addEventListener(
    'click',
    (event) => {
      guardAndOpen(event);
    },
    true,
  );

  document.addEventListener(
    'auxclick',
    (event) => {
      if (!(event instanceof MouseEvent)) return;
      if (event.button !== 1) return;
      guardAndOpen(event);
    },
    true,
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      if (event.key !== 'Enter') return;
      guardAndOpen(event);
    },
    true,
  );
}
