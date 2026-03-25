import React, { useCallback, useMemo } from 'react';
import twemoji from 'twemoji';

// Using the jdecked fork via jsdelivr to get the latest Unicode 15+ assets.
const TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/';

const escapeHtml = (str: string) => str.replace(/[&<>"']/g, (m) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[m] ?? m));

type OnMention = (handle: string) => void;
type OnHashtag = (tag: string) => void;

type Token = {
  type: 'text' | 'mention' | 'hashtag' | 'link';
  text: string;
};

function tokenizeRichText(text: string): Token[] {
  const pattern = /(https?:\/\/[^\s]+|@[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*|#[a-zA-Z0-9_]+)/g;
  const tokens: Token[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }
    const tokenText = match[0];
    if (tokenText.startsWith('@')) {
      tokens.push({ type: 'mention', text: tokenText });
    } else if (tokenText.startsWith('#')) {
      tokens.push({ type: 'hashtag', text: tokenText });
    } else {
      tokens.push({ type: 'link', text: tokenText });
    }
    lastIndex = match.index + tokenText.length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', text: text.slice(lastIndex) });
  }
  return tokens;
}

interface Props {
  text: string;
  className?: string;
  style?: React.CSSProperties;
  onMention?: OnMention;
  onHashtag?: OnHashtag;
}

export default function TwemojiText({ text, className, style, onMention, onHashtag }: Props) {
  const renderText = useCallback((raw: string) => {
    const encoded = escapeHtml(raw);
    const parsed = twemoji.parse(encoded, {
      folder: 'svg',
      ext: '.svg',
      base: TWEMOJI_BASE,
      attributes: () => ({
        style: 'height: 1.2em; width: 1.2em; margin: 0 0.05em 0 0.1em; vertical-align: -0.2em; display: inline-block;',
        loading: 'lazy',
      }),
    });
    return <span dangerouslySetInnerHTML={{ __html: parsed }} />;
  }, []);

  const tokens = useMemo(() => tokenizeRichText(text), [text]);

  return (
    <span className={className} style={style}>
      {tokens.map((token, index) => {
        if (token.type === 'mention') {
          if (!onMention) {
            return (
              <span
                key={index}
                style={{ color: 'var(--purple)', fontWeight: 600 }}
              >
                {renderText(token.text)}
              </span>
            );
          }
          return (
            <button
              key={index}
              onClick={(e) => { e.stopPropagation(); onMention?.(token.text.slice(1)); }}
              style={{ color: 'var(--purple)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              {renderText(token.text)}
            </button>
          );
        }

        if (token.type === 'hashtag') {
          if (!onHashtag) {
            return (
              <span
                key={index}
                style={{ color: 'var(--blue)', fontWeight: 600 }}
              >
                {renderText(token.text)}
              </span>
            );
          }
          return (
            <button
              key={index}
              onClick={(e) => { e.stopPropagation(); onHashtag?.(token.text.slice(1)); }}
              style={{ color: 'var(--blue)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              {renderText(token.text)}
            </button>
          );
        }

        if (token.type === 'link') {
          return (
            <a
              key={index}
              href={token.text}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ color: 'var(--blue)', textDecoration: 'underline' }}
            >
              {renderText(token.text)}
            </a>
          );
        }

        return <React.Fragment key={index}>{renderText(token.text)}</React.Fragment>;
      })}
    </span>
  );
}
