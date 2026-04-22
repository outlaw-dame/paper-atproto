import React from 'react';
import type { WriterEntity } from '../intelligence/llmContracts';
import { accent } from '../design/index';

const SUMMARY_TOKEN_RE =
  /(@[\w.:-]+|#[\w]+|https?:\/\/[^\s<>"')]+|(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>"')]+)?)/gi;

type SummaryEntityCandidate = {
  entity: WriterEntity;
  label: string;
  normalizedLabel: string;
};

export type SummaryRenderOptions = {
  summaryEntities?: SummaryEntityCandidate[];
  onEntityTap?: (entity: WriterEntity) => void;
  onMentionTap?: (actor: string) => void;
};

function splitSummaryTokenSuffix(token: string): { core: string; suffix: string } {
  const match = token.match(/^(.*?)([),.;!?…]+)?$/);
  if (!match) return { core: token, suffix: '' };
  return {
    core: match[1] || token,
    suffix: match[2] || '',
  };
}

function buildSummaryHref(token: string): string | null {
  const candidate = /^https?:\/\//i.test(token) ? token : `https://${token}`;
  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}

function isEntityBoundaryChar(value: string | undefined): boolean {
  return !value || !/[A-Za-z0-9_@#]/.test(value);
}

function findEntityMatch(
  text: string,
  startIndex: number,
  candidates: SummaryEntityCandidate[],
): { index: number; candidate: SummaryEntityCandidate } | null {
  if (candidates.length === 0) return null;

  const lowerText = text.toLowerCase();
  let best: { index: number; candidate: SummaryEntityCandidate } | null = null;

  for (const candidate of candidates) {
    let searchFrom = startIndex;
    while (searchFrom < text.length) {
      const index = lowerText.indexOf(candidate.normalizedLabel, searchFrom);
      if (index < 0) break;

      const before = index > 0 ? text[index - 1] : undefined;
      const afterIndex = index + candidate.label.length;
      const after = afterIndex < text.length ? text[afterIndex] : undefined;
      if (isEntityBoundaryChar(before) && isEntityBoundaryChar(after)) {
        if (!best || index < best.index || (index === best.index && candidate.label.length > best.candidate.label.length)) {
          best = { index, candidate };
        }
        break;
      }

      searchFrom = index + candidate.label.length;
    }
  }

  return best;
}

function renderPlainSummarySegment(
  text: string,
  keyPrefix: string,
  options: SummaryRenderOptions,
): React.ReactNode[] {
  const { summaryEntities = [], onEntityTap } = options;
  const candidates = summaryEntities;
  if (text.length === 0 || candidates.length === 0 || !onEntityTap) return text ? [text] : [];

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let partIndex = 0;

  while (cursor < text.length) {
    const match = findEntityMatch(text, cursor, candidates);
    if (!match) {
      nodes.push(text.slice(cursor));
      break;
    }

    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }

    const label = text.slice(match.index, match.index + match.candidate.label.length);
    nodes.push(
      <button
        key={`${keyPrefix}-entity-${partIndex}`}
        type="button"
        className="interactive-link-button"
        onMouseEnter={(e) => {
          e.stopPropagation();
          onEntityTap(match.candidate.entity);
        }}
        onFocus={(e) => {
          e.stopPropagation();
          onEntityTap(match.candidate.entity);
        }}
        onClick={(e) => {
          e.stopPropagation();
          onEntityTap(match.candidate.entity);
        }}
        style={{
          color: accent.blue500,
          font: 'inherit',
          fontWeight: 600,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        {label}
      </button>,
    );

    cursor = match.index + match.candidate.label.length;
    partIndex += 1;
  }

  return nodes;
}

export function renderSummaryText(text: string, options: SummaryRenderOptions = {}): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const { onMentionTap } = options;
  let cursor = 0;

  for (const match of text.matchAll(SUMMARY_TOKEN_RE)) {
    const index = match.index ?? 0;
    const token = match[0];
    if (!token) continue;

    if (index > cursor) {
      nodes.push(...renderPlainSummarySegment(
        text.slice(cursor, index),
        `plain-${cursor}`,
        options,
      ));
    }

    const { core, suffix } = splitSummaryTokenSuffix(token);

    if (core.startsWith('@')) {
      nodes.push(
        <button
          key={`mention-${index}`}
          type="button"
          className="interactive-link-button"
          style={{ color: accent.blue500, font: 'inherit', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          onClick={(e) => {
            e.stopPropagation();
            onMentionTap?.(core);
          }}
        >
          {core}
        </button>,
      );
    } else if (core.startsWith('#')) {
      const tag = core.slice(1);
      nodes.push(
        <a
          key={`tag-${index}`}
          href={`https://bsky.app/search?q=%23${tag}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: accent.blue500, textDecoration: 'none', fontWeight: 600 }}
          onClick={(e) => e.stopPropagation()}
        >
          {core}
        </a>,
      );
    } else {
      const href = buildSummaryHref(core);
      if (href) {
        const label = (() => {
          try {
            return new URL(href).hostname.replace(/^www\./, '');
          } catch {
            return core;
          }
        })();
        nodes.push(
          <a
            key={`url-${index}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: accent.blue500, textDecoration: 'none', fontWeight: 600 }}
            onClick={(e) => e.stopPropagation()}
          >
            {label}
          </a>,
        );
      } else {
        nodes.push(core);
      }
    }

    if (suffix) {
      nodes.push(suffix);
    }

    cursor = index + token.length;
  }

  if (cursor < text.length) {
    nodes.push(...renderPlainSummarySegment(
      text.slice(cursor),
      `plain-tail-${cursor}`,
      options,
    ));
  }

  return nodes.length > 0 ? nodes : [text];
}
