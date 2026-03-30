import React from 'react';
import { Card } from 'konsta/react';
import { getSafeExternalHostname, openExternalUrl, sanitizeExternalUrl } from '../lib/safety/externalUrl';

interface LinkPreviewProps {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

export const LinkPreview: React.FC<LinkPreviewProps> = ({
  url,
  title,
  description,
  image,
  siteName,
}) => {
  const safeUrl = sanitizeExternalUrl(url);
  const hostname = getSafeExternalHostname(url);

  if (!safeUrl || !hostname) {
    return null;
  }

  return (
    <Card
      margin="m-0"
      className="overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors"
      onClick={() => { openExternalUrl(safeUrl); }}
    >
      {image && (
        <div className="aspect-video w-full overflow-hidden border-b border-zinc-200 dark:border-zinc-800">
          <img
            src={image}
            alt={title || 'Link preview'}
            className="w-full h-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
            decoding="async"
          />
        </div>
      )}
      <div className="p-3">
        <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1 truncate">
          {siteName || hostname}
        </div>
        {title && (
          <div className="font-bold text-sm dark:text-white line-clamp-2 mb-1">
            {title}
          </div>
        )}
        {description && (
          <div className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
            {description}
          </div>
        )}
      </div>
    </Card>
  );
};
