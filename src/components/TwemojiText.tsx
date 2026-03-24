import React, { useMemo } from 'react';
import twemoji from 'twemoji';

// Using the jdecked fork via jsdelivr to get the latest Unicode 15+ assets.
// The official twitter/twemoji repo is no longer actively maintained.
const TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/';

// Simple HTML escape to prevent XSS when using dangerouslySetInnerHTML
const escapeHtml = (str: string) => str.replace(/[&<>"']/g, (m) => ({ 
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' 
}[m] ?? m));

interface Props {
  text: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function TwemojiText({ text, className, style }: Props) {
  const html = useMemo(() => {
    const encoded = escapeHtml(text);
    return twemoji.parse(encoded, {
      folder: 'svg',
      ext: '.svg',
      base: TWEMOJI_BASE,
      // Inject inline styles directly onto the img tags for self-contained layout
      attributes: () => ({
        style: 'height: 1.2em; width: 1.2em; margin: 0 0.05em 0 0.1em; vertical-align: -0.2em; display: inline-block;',
        loading: 'lazy',
      }),
    });
  }, [text]);

  return <span className={className} style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}