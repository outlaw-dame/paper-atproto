import React, { useCallback, useMemo } from 'react';
import LinkPreviewTooltip from './LinkPreviewTooltip';
import { Emoji } from './Emoji';
import type { ResolvedFacet } from '../lib/resolver/atproto';

type OnMention = (handle: string) => void;
type OnHashtag = (tag: string) => void;
type OnCashtag = (cashtag: string) => void;

type Token = {
  type: 'text' | 'mention' | 'hashtag' | 'cashtag' | 'link';
  text: string;
  /** Full URI for link tokens (from facets — may differ from display text). */
  uri?: string;
};

function tokenizeRichText(text: string): Token[] {
  // Pattern: URLs, cashtags ($AAPL), @mentions, #hashtags
  const pattern = /(https?:\/\/[^\s]+|\$[A-Za-z][A-Za-z0-9]{0,4}|@[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*|#[\p{L}\p{N}_]+)/gu;
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
    } else if (tokenText.startsWith('$')) {
      tokens.push({ type: 'cashtag', text: tokenText.toUpperCase() });
    } else if (tokenText.startsWith('#')) {
      tokens.push({ type: 'hashtag', text: tokenText });
    } else {
      tokens.push({ type: 'link', text: tokenText, uri: tokenText });
    }
    lastIndex = match.index + tokenText.length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', text: text.slice(lastIndex) });
  }
  return tokens;
}

// Converts ATProto facets (byte-range annotations) to the same Token list shape.
// This is byte-accurate — ATProto uses UTF-8 byte offsets, not character offsets.
function tokenizeWithFacets(text: string, facets: ResolvedFacet[]): Token[] {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const bytes = enc.encode(text);
  const sorted = [...facets].sort((a, b) => a.byteStart - b.byteStart);
  const tokens: Token[] = [];
  let cursor = 0;

  for (const facet of sorted) {
    const start = Math.max(facet.byteStart, cursor);
    const end = Math.min(facet.byteEnd, bytes.length);
    if (start >= end) continue;

    if (start > cursor) {
      tokens.push({ type: 'text', text: dec.decode(bytes.slice(cursor, start)) });
    }

    const seg = dec.decode(bytes.slice(start, end));
    if (facet.kind === 'link') {
      tokens.push({ type: 'link', text: seg, uri: facet.uri ?? seg });
    } else if (facet.kind === 'mention') {
      tokens.push({ type: 'mention', text: seg });
    } else if (facet.kind === 'hashtag') {
      tokens.push({ type: 'hashtag', text: seg });
    } else if (facet.kind === 'cashtag') {
      tokens.push({ type: 'cashtag', text: seg });
    } else {
      tokens.push({ type: 'text', text: seg });
    }
    cursor = end;
  }

  if (cursor < bytes.length) {
    tokens.push({ type: 'text', text: dec.decode(bytes.slice(cursor)) });
  }
  return tokens;
}

interface Props {
  text: string;
  /** ATProto resolved facets. When provided, used instead of regex for byte-accurate rendering. */
  facets?: ResolvedFacet[];
  className?: string;
  style?: React.CSSProperties;
  onMention?: OnMention;
  onHashtag?: OnHashtag;
  onCashtag?: OnCashtag;
}

export default function TwemojiText({ text, facets, className, style, onMention, onHashtag, onCashtag }: Props) {
  const renderText = useCallback((raw: string) => <Emoji>{raw}</Emoji>, []);

  const tokens = useMemo(
    () => facets?.length ? tokenizeWithFacets(text, facets) : tokenizeRichText(text),
    [text, facets],
  );

  return (
    <span className={className} style={style}>
      {tokens.map((token, index) => {
        if (token.type === 'mention') {
          if (!onMention) {
            return (
              <span key={index} style={{ color: 'var(--blue)', fontWeight: 600 }}>
                {renderText(token.text)}
              </span>
            );
          }
          return (
            <button
              key={index}
              className="interactive-link-button"
              onClick={(e) => { e.stopPropagation(); onMention?.(token.text.replace(/^@/, '')); }}
              style={{ color: 'var(--blue)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              {renderText(token.text)}
            </button>
          );
        }

        if (token.type === 'hashtag') {
          if (!onHashtag) {
            return (
              <span key={index} style={{ color: 'var(--blue)', fontWeight: 600 }}>
                {renderText(token.text)}
              </span>
            );
          }
          return (
            <button
              key={index}
              className="interactive-link-button"
              onClick={(e) => { e.stopPropagation(); onHashtag?.(token.text.replace(/^#/, '')); }}
              style={{ color: 'var(--blue)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              {renderText(token.text)}
            </button>
          );
        }

        if (token.type === 'cashtag') {
          if (!onCashtag) {
            return (
              <span key={index} style={{ color: 'var(--teal)', fontWeight: 600 }}>
                {renderText(token.text)}
              </span>
            );
          }
          return (
            <button
              key={index}
              className="interactive-link-button"
              onClick={(e) => { e.stopPropagation(); onCashtag?.(token.text.replace(/^\$/, '')); }}
              style={{ color: 'var(--teal)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              {renderText(token.text)}
            </button>
          );
        }

        if (token.type === 'link') {
          const href = token.uri ?? token.text;
          return (
            <LinkPreviewTooltip
              key={index}
              url={href}
              linkStyle={{ color: 'var(--blue)', textDecoration: 'underline' }}
            >
              {renderText(token.text)}
            </LinkPreviewTooltip>
          );
        }

        return <React.Fragment key={index}>{renderText(token.text)}</React.Fragment>;
      })}
    </span>
  );
}
