import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAtp } from '../atproto/AtpContext.js';
import { RichText } from '@atproto/api';
import { inferenceClient } from '../workers/InferenceClient.js';
import { getAltTextMetricsSnapshot, recordAltPostCoverage, recordBulkAltRun } from '../perf/altTextTelemetry.js';
import { useUiStore } from '../store/uiStore.js';
import { atpCall } from '../lib/atproto/client.js';
import { resolveThread, type ThreadNode } from '../lib/resolver/atproto.js';
import { fetchOGData, type OGMetadata } from '../og.js';
import { GifPicker, type TenorGif } from './GifPicker.js';
import {
  getHashtagInsights,
  fetchTrendingTopics,
  type HashtagInsight,
  type TrendingTopic,
} from '../lib/hashtags/hashtagInsights.js';
import { analyzeSentiment, type SentimentResult } from '../lib/sentiment.js';
import TwemojiText from './TwemojiText.js';
import { useProfileNavigation } from '../hooks/useProfileNavigation.js';

interface Props {
  onClose: () => void;
}

const MAX = 300;

type AudienceOption = 'Everyone' | 'Following' | 'Mentioned';
const AUDIENCE_OPTIONS: AudienceOption[] = ['Everyone', 'Following', 'Mentioned'];

type ActiveTool = 'image' | 'gif' | 'link' | null;

interface ComposeMediaItem {
  id: string;
  file: File | null;
  previewUrl: string;
  remoteUrl?: string;
  alt: string;
  width: number;
  height: number;
  mediaType: 'image' | 'video'; // support images and videos
  // Video-specific fields
  captions?: Array<{
    lang: string; // ISO 639-1 code (e.g., 'en', 'pt', 'es')
    label: string; // human-readable label
    content: string; // caption content
  }>;
  videoDuration?: number; // in seconds, if video
}

const MAX_MEDIA = 4;
const ALT_REQUIREMENT_KEY = 'paper.compose.requireAltText';
const RECENT_HASHTAGS_KEY = 'paper.compose.recentHashtags';
const FAVORITE_HASHTAGS_KEY = 'paper.compose.favoriteHashtags';

const POPULAR_HASHTAGS = [
  'bluesky', 'atproto', 'technology', 'ai', 'design',
  'photography', 'art', 'music', 'sports', 'science',
  'nature', 'travel', 'food', 'news', 'politics',
  'crypto', 'dev', 'health', 'movies', 'gaming',
  'books', 'fashion', 'fitness', 'climate', 'space',
];

function extractHashtags(text: string): string[] {
  const matches = text.match(/#(\w+)/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(1).toLowerCase()))];
}

/** Deterministic pseudo-popularity 0–100 based on the tag string */
function hashtagScore(tag: string): number {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = ((h << 5) - h + tag.charCodeAt(i)) | 0;
  return 42 + (Math.abs(h) % 57);
}

function saveRecentHashtags(tags: string[]) {
  try {
    const prev: string[] = JSON.parse(localStorage.getItem(RECENT_HASHTAGS_KEY) ?? '[]');
    const merged = [...new Set([...tags, ...prev])].slice(0, 30);
    localStorage.setItem(RECENT_HASHTAGS_KEY, JSON.stringify(merged));
  } catch { /* ignore */ }
}
const ALT_MAX_CHARS = 500;

type AltLintLevel = 'warning' | 'error';

interface AltLintIssue {
  level: AltLintLevel;
  message: string;
}

function lintAltText(value: string): AltLintIssue[] {
  const alt = value.trim();
  if (!alt) return [];

  const issues: AltLintIssue[] = [];
  if (alt.length < 12) {
    issues.push({ level: 'error', message: 'Too short. Add key details so screen-reader users get meaningful context.' });
  }
  if (alt.length >= 12 && alt.length < 24) {
    issues.push({ level: 'warning', message: 'Consider adding more context such as action, subject, and important text.' });
  }
  if (/^(image|photo|picture|screenshot)\s+of\b/i.test(alt)) {
    issues.push({ level: 'warning', message: 'Skip "image/photo of" and start directly with the important content.' });
  }
  if (/\bhttps?:\/\//i.test(alt)) {
    issues.push({ level: 'warning', message: 'Avoid raw URLs in ALT text unless the link itself is the subject.' });
  }
  if (/#\w+|@\w+/i.test(alt)) {
    issues.push({ level: 'warning', message: 'Avoid hashtags and mentions in ALT text. Describe the media itself.' });
  }
  if (/\b\w+\.(png|jpe?g|gif|webp|heic|svg)\b/i.test(alt)) {
    issues.push({ level: 'warning', message: 'File names are usually not useful ALT text. Describe meaning and context.' });
  }
  if (alt.length > 90 && !/[.?!]$/.test(alt)) {
    issues.push({ level: 'warning', message: 'Long ALT reads better with punctuation.' });
  }

  return issues;
}

function describeAltQuality(value: string): string | null {
  const issues = lintAltText(value);
  if (issues.length === 0) return null;
  return issues[0].message;
}

async function loadImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const dims = await new Promise<{ width: number; height: number }>((resolve) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth || 1600, height: img.naturalHeight || 900 });
      };
      img.onerror = () => resolve({ width: 1600, height: 900 });
      img.src = url;
    });
    return dims;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadVideoDimensions(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const dims = await new Promise<{ width: number; height: number }>((resolve) => {
      const vid = document.createElement('video');
      vid.onloadedmetadata = () => {
        resolve({ width: vid.videoWidth || 1920, height: vid.videoHeight || 1080 });
      };
      vid.onerror = () => resolve({ width: 1920, height: 1080 });
      vid.src = url;
    });
    return dims;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function linkifyText(text: string): React.ReactNode[] {
  const parts = text.split(/(#\w+|\$[A-Z][A-Z0-9]{0,4}|@\w+(?:\.\w+)*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('#')) {
      return <span key={i} style={{ color: 'var(--blue)', fontWeight: 500 }}>{part}</span>;
    }
    if (part.startsWith('$')) {
      // Cashtag for financial ticker
      return <span key={i} style={{ color: 'var(--teal)', fontWeight: 600 }}>{part}</span>;
    }
    if (part.startsWith('@')) {
      return <span key={i} style={{ color: 'var(--blue)', fontWeight: 500 }}>{part}</span>;
    }
    return part;
  });
}

function detectLinks(text: string): string[] {
  const urlRe = /https?:\/\/[^\s]+/g;
  return text.match(urlRe) ?? [];
}

function normalizeDetectedUrl(rawUrl: string): string {
  return rawUrl.replace(/[),.!?;:]+$/g, '');
}

function getFirstPreviewUrl(text: string): string | null {
  const first = detectLinks(text)[0];
  if (!first) return null;

  const normalized = normalizeDetectedUrl(first);
  try {
    return new URL(normalized).toString();
  } catch {
    return null;
  }
}

interface ComposeLinkPreview {
  url: string;
  title: string;
  description: string;
  siteName: string;
  image?: string;
  author?: string;
  authorHandle?: string;
}

function buildPreviewFromMetadata(url: string, metadata: OGMetadata | null): ComposeLinkPreview {
  let hostname = url;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // Keep the original URL as a final fallback.
  }

  const title = metadata?.title?.trim() || hostname;
  const description = metadata?.description?.trim() || '';
  const siteName = metadata?.siteName?.trim() || hostname;

  return {
    url,
    title,
    description,
    siteName,
    ...(metadata?.image ? { image: metadata.image } : {}),
    ...(metadata?.author ? { author: metadata.author } : {}),
    ...(metadata?.authorHandle ? { authorHandle: metadata.authorHandle } : {}),
  };
}

// Add captions to a video media item (for AT Protocol video embed)
function addCaptionToVideo(
  mediaItem: ComposeMediaItem,
  lang: string,
  label: string,
  content: string
): ComposeMediaItem {
  if (mediaItem.mediaType !== 'video') {
    console.warn('Captions can only be added to video media items');
    return mediaItem;
  }
  return {
    ...mediaItem,
    captions: [
      ...(mediaItem.captions ?? []),
      { lang, label, content },
    ],
  };
}

// Remove a caption from a video media item
function removeCaptionFromVideo(
  mediaItem: ComposeMediaItem,
  index: number
): ComposeMediaItem {
  if (mediaItem.mediaType !== 'video' || !mediaItem.captions) {
    return mediaItem;
  }
  return {
    ...mediaItem,
    captions: mediaItem.captions.filter((_, i) => i !== index),
  };
}

function collectThreadContextTexts(root: ThreadNode): {
  threadTexts: string[];
  commentTexts: string[];
  totalCommentCount: number;
} {
  const queue: ThreadNode[] = [root];
  const threadTexts: string[] = [];
  const commentTexts: string[] = [];
  let seen = 0;

  while (queue.length > 0 && seen < 120) {
    const current = queue.shift();
    if (!current) continue;
    seen += 1;

    const text = current.text?.trim();
    if (text) {
      if (current.depth <= 1 && threadTexts.length < 8) {
        threadTexts.push(text);
      } else if (commentTexts.length < 32) {
        commentTexts.push(text);
      }
    }

    for (const child of current.replies ?? []) {
      queue.push(child);
    }
  }

  return {
    threadTexts,
    commentTexts,
    totalCommentCount: commentTexts.length,
  };
}

// ─── Sentiment banner ──────────────────────────────────────────────────────
interface SentimentBannerProps {
  result: SentimentResult;
  parentSnippet?: string;   // first ~120 chars of the post being replied to
  onDismiss: () => void;
}

function SentimentBanner({ result, parentSnippet, onDismiss }: SentimentBannerProps) {
  if (result.level === 'ok') return null;

  const isAlert = result.level === 'alert';
  const isPositive = result.level === 'positive';
  const isReply = result.isReplyContext && (result.parentSignals.length > 0 || !!parentSnippet);
  const accentColor = isAlert
    ? 'var(--red)'
    : isPositive
      ? 'var(--green)'
      : 'var(--orange)';
  const bgColor = isAlert
    ? 'rgba(255,59,48,0.09)'
    : isPositive
      ? 'rgba(52,199,89,0.1)'
      : 'rgba(255,149,0,0.09)';
  const borderColor = isAlert
    ? 'rgba(255,59,48,0.25)'
    : isPositive
      ? 'rgba(52,199,89,0.3)'
      : 'rgba(255,149,0,0.25)';
  // In reply mode the label is more specific
  const label = isAlert
    ? 'Content notice'
    : isPositive
      ? (isReply ? 'Reply context · Supportive reply + Constructive signal' : 'Supportive reply + Constructive signal')
      : (isReply ? 'Reply context · Tone check' : 'Tone check');

  return (
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={{ duration: 0.2 }}
      style={{
        marginTop: 10,
        borderRadius: 14,
        background: bgColor,
        border: `1px solid ${borderColor}`,
        overflow: 'hidden',
        // Reply-mode gets a left accent stripe for visual emphasis
        boxShadow: isReply ? `inset 3px 0 0 ${accentColor}` : 'none',
      }}
    >
      {/* Header row */}
      <div style={{
        display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6,
        padding: '9px 12px 8px',
        borderBottom: `0.5px solid ${borderColor}`,
      }}>
        {isAlert ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        ) : isPositive ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        )}
        <span style={{ fontSize: 11, fontWeight: 800, color: accentColor, textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 }}>
          {label}
        </span>
        <button
          onClick={onDismiss}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: accentColor, opacity: 0.55, fontSize: 18, lineHeight: 1 }}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>

      <div style={{ padding: '9px 12px 11px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Parent post snippet — shown only in reply context */}
        {isReply && parentSnippet && (
          <div style={{
            padding: '7px 10px',
            borderRadius: 9,
            background: 'rgba(0,0,0,0.04)',
            borderLeft: `2px solid ${accentColor}`,
          }}>
            <p style={{ margin: '0 0 3px', fontSize: 10, fontWeight: 700, color: accentColor, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              Replying to
            </p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--label-2)', lineHeight: 1.4, fontStyle: 'italic' }}>
              "{parentSnippet.length > 120 ? parentSnippet.slice(0, 117) + '…' : parentSnippet}"
            </p>
          </div>
        )}

        {/* Parent-derived context signals */}
        {result.parentSignals.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {result.parentSignals.map((s, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 10, color: accentColor, marginTop: 2, flexShrink: 0 }}>›</span>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--label-3)', lineHeight: 1.4 }}>{s}</p>
              </div>
            ))}
          </div>
        )}

        {/* Divider between parent signals and reply signals */}
        {result.parentSignals.length > 0 && result.signals.length > 0 && (
          <div style={{ height: 1, background: borderColor }} />
        )}

        {/* Reply / draft signals */}
        {result.signals.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {result.signals.map((s, i) => (
              <p key={i} style={{ margin: 0, fontSize: 12, color: 'var(--label-2)', lineHeight: 1.4 }}>
                {s}
              </p>
            ))}
          </div>
        )}

        {isPositive && (result.supportiveReplySignals.length > 0 || result.constructiveSignals.length > 0) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {result.supportiveReplySignals.length > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, color: accentColor, background: 'rgba(52,199,89,0.14)', border: '1px solid rgba(52,199,89,0.26)', borderRadius: 999, padding: '2px 8px' }}>
                Supportive reply
              </span>
            )}
            {result.constructiveSignals.length > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, color: accentColor, background: 'rgba(52,199,89,0.14)', border: '1px solid rgba(52,199,89,0.26)', borderRadius: 999, padding: '2px 8px' }}>
                Constructive signal
              </span>
            )}
          </div>
        )}

        {/* Footnote */}
        <p style={{ margin: 0, fontSize: 11, color: 'var(--label-4)', fontStyle: 'italic' }}>
          {isPositive
            ? 'Constructive framing like this usually helps conversations feel safer and more useful.'
            : 'You can still post — this is just a heads-up.'}
        </p>
      </div>
    </motion.div>
  );
}

function SentimentDebugCard({
  result,
  draftText,
  parentSnippet,
  dismissedAt,
}: {
  result: SentimentResult;
  draftText: string;
  parentSnippet?: string;
  dismissedAt: number | null;
}) {
  if (!import.meta.env.DEV) return null;

  return (
    <div
      style={{
        marginTop: 10,
        borderRadius: 12,
        border: '1px dashed var(--sep)',
        background: 'rgba(120,120,128,0.08)',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <p style={{ margin: 0, fontSize: 10, fontWeight: 800, color: 'var(--label-3)', letterSpacing: 0.4, textTransform: 'uppercase' }}>
        Sentiment Debug
      </p>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
        level={result.level} | draftLength={draftText.trim().length} | replyContext={String(result.isReplyContext)} | dismissed={dismissedAt === null ? 'false' : 'true'}
      </p>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
        draft="{draftText.trim() || '(empty)'}"
      </p>
      {parentSnippet && (
        <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          parent="{parentSnippet.length > 120 ? `${parentSnippet.slice(0, 117)}...` : parentSnippet}"
        </p>
      )}
      <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
        signals={result.signals.length ? result.signals.join(' | ') : '(none)'}
      </p>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
        supportiveReplySignals={result.supportiveReplySignals.length ? result.supportiveReplySignals.join(' | ') : '(none)'}
      </p>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
        constructiveSignals={result.constructiveSignals.length ? result.constructiveSignals.join(' | ') : '(none)'}
      </p>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
        parentSignals={result.parentSignals.length ? result.parentSignals.join(' | ') : '(none)'}
      </p>
    </div>
  );
}

// ─── Character ring ────────────────────────────────────────────────────────
function CharRing({ used, max }: { used: number; max: number }) {
  const r = 11;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(used / max, 1);
  const remaining = max - used;
  const isOver = remaining < 0;
  const isWarning = remaining >= 0 && remaining < 30;
  const strokeColor = isOver ? 'var(--red)' : isWarning ? 'var(--orange)' : 'var(--blue)';

  return (
    <div style={{ position: 'relative', width: 30, height: 30, flexShrink: 0 }}>
      <svg width="30" height="30" viewBox="0 0 30 30">
        <circle cx="15" cy="15" r={r} fill="none" stroke="var(--fill-3)" strokeWidth={2.5} />
        <circle
          cx="15" cy="15" r={r} fill="none"
          stroke={strokeColor}
          strokeWidth={2.5}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round"
          transform="rotate(-90 15 15)"
          style={{ transition: 'stroke-dashoffset 0.1s, stroke 0.15s' }}
        />
      </svg>
      {(isWarning || isOver) && (
        <span style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 8, fontWeight: 800,
          color: isOver ? 'var(--red)' : 'var(--orange)',
        }}>
          {remaining}
        </span>
      )}
    </div>
  );
}

// ─── Audience picker ───────────────────────────────────────────────────────
function AudiencePicker({ value, onChange }: { value: AudienceOption; onChange: (v: AudienceOption) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5,
          padding: '5px 12px', borderRadius: 100,
          background: 'rgba(0,122,255,0.1)', color: 'var(--blue)',
          fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
        }}
      >
        <AudienceIcon audience={value} />
        {value}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            style={{
              position: 'absolute', bottom: 'calc(100% + 8px)', right: 0,
              background: 'var(--surface)',
              borderRadius: 16, overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
              border: '0.5px solid var(--sep)',
              minWidth: 160, zIndex: 10,
            }}
          >
            {AUDIENCE_OPTIONS.map((opt, i) => (
              <button
                key={opt}
                onClick={() => { onChange(opt); setOpen(false); }}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '12px 16px',
                  display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10,
                  background: value === opt ? 'rgba(0,122,255,0.08)' : 'none',
                  borderBottom: i < AUDIENCE_OPTIONS.length - 1 ? '0.5px solid var(--sep)' : 'none',
                  color: value === opt ? 'var(--blue)' : 'var(--label-1)',
                  fontSize: 14, fontWeight: value === opt ? 600 : 400,
                  cursor: 'pointer', border: 'none',
                }}
              >
                <AudienceIcon audience={opt} />
                {opt}
                {value === opt && (
                  <svg style={{ marginLeft: 'auto' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AudienceIcon({ audience }: { audience: AudienceOption }) {
  if (audience === 'Everyone') return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
    </svg>
  );
  if (audience === 'Following') return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
    </svg>
  );
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-3.92 7.94"/>
    </svg>
  );
}

// ─── Live preview card ─────────────────────────────────────────────────────
function LivePreview({ text, audience }: { text: string; audience: AudienceOption }) {
  const links = detectLinks(text);
  const hashtags = text.match(/#\w+/g) ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98 }}
      transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
      style={{
        background: 'var(--bg)', borderRadius: 16,
        border: '1px solid var(--sep)',
        overflow: 'hidden', marginTop: 10, marginBottom: 4,
      }}
    >
      {/* Preview label */}
      <div style={{
        display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6,
        padding: '8px 12px 8px',
        borderBottom: '0.5px solid var(--sep)',
        background: 'rgba(0,122,255,0.04)',
      }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
        </svg>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Preview</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--label-4)', fontWeight: 500 }}>{audience}</span>
      </div>

      {/* Post preview */}
      <div style={{ padding: '12px 14px' }}>
        {/* Author mock */}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>Y</div>
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--label-1)', letterSpacing: -0.2 }}>you.bsky.social</p>
            <p style={{ fontSize: 11, color: 'var(--label-4)' }}>just now</p>
          </div>
        </div>
        {/* Rendered text */}
        <p style={{ fontSize: 15, lineHeight: 1.45, letterSpacing: -0.2, color: 'var(--label-1)', wordBreak: 'break-word' }}>
          {linkifyText(text)}
        </p>
        {/* Hashtag chips */}
        {hashtags.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {hashtags.slice(0, 5).map((tag, i) => (
              <span key={i} style={{ padding: '3px 10px', borderRadius: 100, background: 'rgba(0,122,255,0.1)', color: 'var(--blue)', fontSize: 12, fontWeight: 500 }}>{tag}</span>
            ))}
          </div>
        )}
        {/* Detected link pill */}
        {links.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, padding: '7px 10px', borderRadius: 10, background: 'var(--fill-2)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--label-3)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
            </svg>
            <span style={{ fontSize: 12, color: 'var(--label-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{links[0]}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Toolbar button ────────────────────────────────────────────────────────
function ToolBtn({
  label, active, onPress, children,
}: {
  label: string; active?: boolean; onPress?: () => void; children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      onClick={onPress}
      style={{
        width: 40, height: 40, borderRadius: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: active ? 'var(--blue)' : 'var(--label-2)',
        background: active ? 'rgba(0,122,255,0.1)' : 'none',
        border: 'none', cursor: 'pointer',
        transition: 'background 0.12s, color 0.12s',
      }}
    >
      {children}
    </button>
  );
}

// ─── Format toolbar (bold/italic/link) ────────────────────────────────────
function FormatBar({ onInsert }: { onInsert: (text: string) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 44 }}
      exit={{ opacity: 0, height: 0 }}
      style={{
        display: 'flex', flexDirection: 'row', alignItems: 'center',
        padding: '0 12px', gap: 2, overflow: 'hidden',
        borderBottom: '0.5px solid var(--sep)',
        background: 'var(--fill-3)',
      }}
    >
      <ToolBtn label="Bold" onPress={() => onInsert('**bold**')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z"/><path d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z"/>
        </svg>
      </ToolBtn>
      <ToolBtn label="Italic" onPress={() => onInsert('_italic_')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>
        </svg>
      </ToolBtn>
      <ToolBtn label="Quote" onPress={() => onInsert('> ')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>
          <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>
        </svg>
      </ToolBtn>
      <div style={{ width: 1, height: 20, background: 'var(--sep)', margin: '0 4px' }} />
      <ToolBtn label="Bullet list" onPress={() => onInsert('\n- ')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
          <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
        </svg>
      </ToolBtn>
    </motion.div>
  );
}

// ─── Hashtag Insights Panel ────────────────────────────────────────────────
function HashtagInsightsPanel({
  insights,
  loading,
}: {
  insights: HashtagInsight[];
  loading: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18 }}
      style={{
        marginTop: 10,
        border: '1px solid var(--sep)',
        borderRadius: 14,
        overflow: 'hidden',
        background: 'var(--fill-1)',
      }}
    >
      {/* Header */}
      <div style={{ padding: '10px 12px 8px', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7, borderBottom: '0.5px solid var(--sep)', background: 'var(--fill-2)' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--label-1)', letterSpacing: -0.2 }}>Hashtag Insights</span>
        {loading && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth={2.5} strokeLinecap="round" style={{ marginLeft: 'auto', flexShrink: 0 }}>
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
              <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.7s" repeatCount="indefinite"/>
            </path>
          </svg>
        )}
      </div>
      <div style={{ padding: '7px 12px 4px', fontSize: 11, color: 'var(--label-3)', lineHeight: 1.4 }}>
        Using local ML and real-time Bluesky data, Paper analyzes the reach of the hashtags you used.
      </div>
      <div style={{ padding: '4px 12px 10px' }}>
        {insights.map((insight) => {
          const labelColor =
            insight.isTrending ? 'var(--red)' : insight.score > 65 ? '#34c759' : 'var(--label-3)';
          return (
            <div key={insight.tag} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-2)', minWidth: 90, flexShrink: 0 }}>#{insight.tag}</span>
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--fill-3)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: loading ? '0%' : `${insight.score}%`, borderRadius: 4,
                  background: 'linear-gradient(90deg, #34c759 0%, #ffd60a 55%, #ff9f0a 100%)',
                  transition: 'width 0.55s cubic-bezier(0.34,1.56,0.64,1)',
                }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: labelColor, minWidth: 52, textAlign: 'right' }}>
                {loading ? '…' : insight.label}
              </span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ─── Hashtag Browser ────────────────────────────────────────────────────────
function HashtagBrowser({
  agent,
  onSelect,
  onClose,
}: {
  agent: ReturnType<typeof useAtp>['agent'];
  onSelect: (tag: string) => void;
  onClose: () => void;
}) {
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(FAVORITE_HASHTAGS_KEY) ?? '[]'); } catch { return []; }
  });
  const [recents] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_HASHTAGS_KEY) ?? '[]'); } catch { return []; }
  });
  const [search, setSearch] = useState('');
  const [trendingTopics, setTrendingTopics] = useState<TrendingTopic[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(true);

  // Load live trending topics on mount
  useEffect(() => {
    let cancelled = false;
    fetchTrendingTopics(agent).then((topics) => {
      if (!cancelled) {
        setTrendingTopics(topics.length > 0 ? topics : POPULAR_HASHTAGS.map((s) => ({ slug: s, displayName: s })));
        setTrendingLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [agent]);

  const toggleFavorite = (tag: string) => {
    const next = favorites.includes(tag) ? favorites.filter((f) => f !== tag) : [tag, ...favorites];
    setFavorites(next);
    localStorage.setItem(FAVORITE_HASHTAGS_KEY, JSON.stringify(next));
  };

  const filtered = (list: string[]) =>
    search ? list.filter((t) => t.toLowerCase().includes(search.toLowerCase())) : list;

  const TagChip = ({ tag }: { tag: string }) => {
    const isFav = favorites.includes(tag);
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 1, background: 'var(--fill-2)', borderRadius: 999, border: '0.5px solid var(--sep)', overflow: 'hidden', marginRight: 6, marginBottom: 6 }}>
        <button
          onClick={() => { onSelect(tag); onClose(); }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 10px 6px 12px', fontSize: 13, fontWeight: 600, color: 'var(--blue)', letterSpacing: -0.1 }}
        >
          #{tag}
        </button>
        <button
          onClick={() => toggleFavorite(tag)}
          aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 10px 6px 4px', fontSize: 13, color: isFav ? '#ffd60a' : 'var(--label-4)' }}
        >
          {isFav ? '★' : '☆'}
        </button>
      </div>
    );
  };

  const Section = ({ title, tags, emptyMsg }: { title: string; tags: string[]; emptyMsg: string }) => (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.6, color: 'var(--label-3)', textTransform: 'uppercase', marginBottom: 8 }}>{title}</div>
      {tags.length === 0
        ? <div style={{ fontSize: 13, color: 'var(--label-4)', fontStyle: 'italic' }}>{emptyMsg}</div>
        : <div style={{ display: 'flex', flexWrap: 'wrap' }}>{tags.map((t) => <TagChip key={t} tag={t} />)}</div>
      }
    </div>
  );

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 240 }}
      />
      {/* Sheet */}
      <motion.div
        initial={{ opacity: 0, y: 60 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 60 }}
        transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0,
          maxHeight: '80vh', zIndex: 241,
          background: 'var(--surface)', borderRadius: '20px 20px 0 0',
          border: '0.5px solid var(--sep)',
          boxShadow: '0 -8px 36px rgba(0,0,0,0.2)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px 10px', borderBottom: '0.5px solid var(--sep)', gap: 10 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--label-2)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/>
            <line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>
          </svg>
          <span style={{ flex: 1, fontSize: 16, fontWeight: 800, color: 'var(--label-1)', letterSpacing: -0.3 }}>Hashtags</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--label-3)', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>

        {/* Search */}
        <div style={{ padding: '10px 16px 8px', borderBottom: '0.5px solid var(--sep)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--fill-2)', borderRadius: 10, padding: '8px 12px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--label-3)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search hashtags…"
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 14, color: 'var(--label-1)', fontFamily: 'inherit' }}
            />
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px', paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}>
          <Section title="Recently Used" tags={filtered(recents)} emptyMsg="No recently used hashtags yet." />
          <Section title="Favorites" tags={filtered(favorites)} emptyMsg="Star a hashtag to save it here." />
          <Section
            title={trendingLoading ? 'Currently Popular' : 'Currently Popular · Live'}
            tags={filtered(trendingTopics.map((t) => t.slug))}
            emptyMsg={trendingLoading ? 'Loading trending topics…' : 'No results.'}
          />
        </div>
      </motion.div>
    </>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export default function ComposeSheet({ onClose }: Props) {
  const { agent, profile } = useAtp();
  const navigateToProfile = useProfileNavigation();
  const replyTarget = useUiStore(s => s.replyTarget);
  const replyParentText = replyTarget?.content?.trim() || undefined;
  const [replyThreadContext, setReplyThreadContext] = useState<{
    threadTexts: string[];
    commentTexts: string[];
    totalCommentCount: number;
  }>({
    threadTexts: [],
    commentTexts: [],
    totalCommentCount: 0,
  });
  const [text, setText] = useState('');
  const [audience, setAudience] = useState<AudienceOption>('Everyone');
  const [showPreview, setShowPreview] = useState(false);
  const [showFormatBar, setShowFormatBar] = useState(false);
  const [activeTool, setActiveTool] = useState<ActiveTool>(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [mediaItems, setMediaItems] = useState<ComposeMediaItem[]>([]);
  const [editingAltId, setEditingAltId] = useState<string | null>(null);
  const [altDraft, setAltDraft] = useState('');
  const [altSuggestionError, setAltSuggestionError] = useState<string | null>(null);
  const [isGeneratingAltSuggestion, setIsGeneratingAltSuggestion] = useState(false);
  const [isGeneratingBulkAlt, setIsGeneratingBulkAlt] = useState(false);
  const [bulkAltProgress, setBulkAltProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkAltError, setBulkAltError] = useState<string | null>(null);
  const [showMissingAltConfirm, setShowMissingAltConfirm] = useState(false);
  const [showLowQualityAltConfirm, setShowLowQualityAltConfirm] = useState(false);
  const [altMetrics, setAltMetrics] = useState(() => getAltTextMetricsSnapshot());
  const [linkPreview, setLinkPreview] = useState<ComposeLinkPreview | null>(null);
  const [linkPreviewLoading, setLinkPreviewLoading] = useState(false);
  const [linkPreviewError, setLinkPreviewError] = useState<string | null>(null);
  const [dismissedPreviewUrl, setDismissedPreviewUrl] = useState<string | null>(null);
  const [requireAltText, setRequireAltText] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(ALT_REQUIREMENT_KEY) === '1';
  });
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showHashtagBrowser, setShowHashtagBrowser] = useState(false);
  const [activeCarouselIdx, setActiveCarouselIdx] = useState(0);
  const [hashtagInsights, setHashtagInsights] = useState<HashtagInsight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [sentimentResult, setSentimentResult] = useState<SentimentResult>({
    level: 'ok',
    signals: [],
    constructiveSignals: [],
    supportiveReplySignals: [],
    parentSignals: [],
    isReplyContext: false,
  });
  const [sentimentDismissedAt, setSentimentDismissedAt] = useState<number | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const altTaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaCarouselRef = useRef<HTMLDivElement>(null);
  const linkPreviewRequestIdRef = useRef(0);
  const remaining = MAX - text.length;
  const hasDraftContent = text.trim().length > 0 || mediaItems.length > 0;
  const canPost = hasDraftContent && remaining >= 0 && !posting;

  const missingAltCount = useMemo(
    () => mediaItems.reduce((count, item) => count + (item.alt.trim().length === 0 ? 1 : 0), 0),
    [mediaItems]
  );
  const describedMediaCount = mediaItems.length - missingAltCount;
  const editingMedia = useMemo(
    () => mediaItems.find((item) => item.id === editingAltId) ?? null,
    [mediaItems, editingAltId]
  );
  const altQualityHint = useMemo(() => describeAltQuality(altDraft), [altDraft]);
  const altLintIssues = useMemo(() => lintAltText(altDraft), [altDraft]);
  const lowQualityAltCount = useMemo(
    () => mediaItems.reduce((count, item) => {
      if (!item.alt.trim()) return count;
      return count + (lintAltText(item.alt).length > 0 ? 1 : 0);
    }, 0),
    [mediaItems]
  );

  useEffect(() => {
    localStorage.setItem(ALT_REQUIREMENT_KEY, requireAltText ? '1' : '0');
  }, [requireAltText]);

  useEffect(() => {
    return () => {
      for (const item of mediaItems) URL.revokeObjectURL(item.previewUrl);
    };
  }, [mediaItems]);

  useEffect(() => {
    if (!replyTarget?.id) {
      setReplyThreadContext({ threadTexts: [], commentTexts: [], totalCommentCount: 0 });
      return;
    }

    let cancelled = false;

    const localThreadTexts = [replyTarget.threadRoot?.content, replyTarget.content]
      .filter((v): v is string => !!v)
      .map(v => v.trim())
      .filter(Boolean);
    const localCommentTexts = [replyTarget.replyTo?.content]
      .filter((v): v is string => !!v)
      .map(v => v.trim())
      .filter(Boolean);

    setReplyThreadContext({
      threadTexts: Array.from(new Set(localThreadTexts)).slice(0, 8),
      commentTexts: Array.from(new Set(localCommentTexts)).slice(0, 32),
      totalCommentCount: Math.max(replyTarget.replyCount ?? 0, localCommentTexts.length),
    });

    void (async () => {
      try {
        const rootUri = replyTarget.threadRoot?.id ?? replyTarget.id;
        if (!rootUri) return;

        const response = await atpCall(() => agent.getPostThread({ uri: rootUri, depth: 6 }), { maxAttempts: 1 });
        const threadData = response?.data?.thread;
        if (!threadData || threadData.$type !== 'app.bsky.feed.defs#threadViewPost') return;

        const resolved = resolveThread(threadData as any);
        const collected = collectThreadContextTexts(resolved);

        if (cancelled) return;
        setReplyThreadContext({
          threadTexts: Array.from(new Set(collected.threadTexts)).slice(0, 8),
          commentTexts: Array.from(new Set(collected.commentTexts)).slice(0, 32),
          totalCommentCount: Math.max(replyTarget.replyCount ?? 0, collected.totalCommentCount),
        });
      } catch {
        // Best effort only — local reply context remains available.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agent, replyTarget?.id, replyTarget?.replyCount, replyTarget?.threadRoot?.id, replyTarget?.threadRoot?.content, replyTarget?.content, replyTarget?.replyTo?.content]);

  useEffect(() => {
    const previewUrl = getFirstPreviewUrl(text);

    if (!previewUrl) {
      setLinkPreview(null);
      setLinkPreviewLoading(false);
      setLinkPreviewError(null);
      return;
    }

    if (dismissedPreviewUrl === previewUrl) {
      setLinkPreview(null);
      setLinkPreviewLoading(false);
      setLinkPreviewError(null);
      return;
    }

    if (linkPreview?.url === previewUrl) {
      return;
    }

    setLinkPreviewLoading(true);
    setLinkPreviewError(null);

    const requestId = linkPreviewRequestIdRef.current + 1;
    linkPreviewRequestIdRef.current = requestId;

    const timer = window.setTimeout(() => {
      void (async () => {
        const metadata = await fetchOGData(previewUrl);
        if (linkPreviewRequestIdRef.current !== requestId) return;

        const previewData = buildPreviewFromMetadata(previewUrl, metadata);
        setLinkPreview(previewData);
        if (!metadata) {
          setLinkPreviewError('Could not fetch full preview metadata. The link will still be attached.');
        }
        setLinkPreviewLoading(false);
      })();
    }, 450);

    return () => {
      window.clearTimeout(timer);
    };
  }, [dismissedPreviewUrl, linkPreview?.url, text]);

  // ── Sentiment analysis — debounced 600 ms after typing stops ─────────────
  useEffect(() => {
    const id = window.setTimeout(() => {
      const result = analyzeSentiment(text, {
        parentText: replyParentText,
        parentReplyCount: replyTarget?.replyCount,
        parentThreadCount: replyTarget?.threadCount,
        threadTexts: replyThreadContext.threadTexts,
        commentTexts: replyThreadContext.commentTexts,
        totalCommentCount: replyThreadContext.totalCommentCount,
      });
      // Only update (and un-dismiss) if the level changed or new signals appeared.
      setSentimentResult(prev => {
        const sameLevel = prev.level === result.level;
        const sameSignals = (prev.signals ?? []).join() === result.signals.join();
        const sameSupportiveSignals = (prev.supportiveReplySignals ?? []).join() === result.supportiveReplySignals.join();
        const sameConstructiveSignals = (prev.constructiveSignals ?? []).join() === result.constructiveSignals.join();
        const sameParentSignals = (prev.parentSignals ?? []).join() === result.parentSignals.join();
        const sameReplyContext = (prev.isReplyContext ?? false) === result.isReplyContext;
        if (sameLevel && sameSignals && sameSupportiveSignals && sameConstructiveSignals && sameParentSignals && sameReplyContext) return prev;

        // If the visible notice content changes, re-show it.
        setSentimentDismissedAt(null);
        return result;
      });
    }, 600);
    return () => window.clearTimeout(id);
  }, [
    replyParentText,
    replyTarget?.replyCount,
    replyTarget?.threadCount,
    replyThreadContext.threadTexts,
    replyThreadContext.commentTexts,
    replyThreadContext.totalCommentCount,
    text,
  ]);

  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return;

    (window as Window & { __PAPER_COMPOSE_DEBUG__?: unknown }).__PAPER_COMPOSE_DEBUG__ = {
      draftText: text,
      replyParentText,
      sentimentResult,
      sentimentDismissedAt,
    };
  }, [replyParentText, sentimentDismissedAt, sentimentResult, text]);

  // ── Hashtag insights — debounced 600 ms, runs all three signals in parallel
  useEffect(() => {
    const tags = extractHashtags(text);
    if (tags.length === 0) {
      setHashtagInsights([]);
      setInsightsLoading(false);
      return;
    }
    // Show skeleton bars immediately while data loads
    setInsightsLoading(true);
    setHashtagInsights(tags.map((tag) => ({
      tag, score: 0, volumeScore: 0, relevanceScore: 0, isTrending: false, label: 'Active',
    })));
    const timer = window.setTimeout(() => {
      void getHashtagInsights(agent, tags, text).then((results) => {
        setHashtagInsights(results);
        setInsightsLoading(false);
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [text, agent]);

  const buildExternalEmbed = useCallback(async (
    preview: ComposeLinkPreview
  ): Promise<{
    $type: 'app.bsky.embed.external';
    external: {
      uri: string;
      title: string;
      description: string;
      thumb?: unknown;
    };
  }> => {
    let thumbBlobRef: unknown;

    if (preview.image) {
      try {
        const imageResponse = await fetch(preview.image);
        if (imageResponse.ok) {
          const imageBlob = await imageResponse.blob();
          if (imageBlob.type.startsWith('image/')) {
            const upload = await agent.uploadBlob(imageBlob, {
              encoding: imageBlob.type || 'image/jpeg',
            });
            thumbBlobRef = upload.data.blob;
          }
        }
      } catch {
        // Thumbnail upload is optional for external embeds.
      }
    }

    return {
      $type: 'app.bsky.embed.external',
      external: {
        uri: preview.url,
        title: preview.title,
        description: preview.description,
        ...(thumbBlobRef ? { thumb: thumbBlobRef } : {}),
      },
    };
  }, [agent]);

  const commitPost = useCallback(async () => {
    if (!canPost || !agent.session) return;
    setPosting(true);
    setPostError(null);
    try {
      const trimmedText = text.trim();
      const rt = new RichText({ text: trimmedText });
      if (trimmedText.length > 0) {
        await rt.detectFacets(agent);
      }

      let embed:
        | {
            $type: 'app.bsky.embed.images';
            images: Array<{
              image: unknown;
              alt: string;
              aspectRatio?: { width: number; height: number };
            }>;
          }
        | {
            $type: 'app.bsky.embed.external';
            external: {
              uri: string;
              title: string;
              description: string;
              thumb?: unknown;
            };
          }
        | undefined;

      if (mediaItems.length > 0) {
        const uploadedImages: Array<{
          image: unknown;
          alt: string;
          aspectRatio?: { width: number; height: number };
        }> = [];
        for (const item of mediaItems) {
          let blobToUpload: Blob | File | null = item.file;
          let encoding = item.file?.type || 'image/jpeg';

          if (!blobToUpload && item.remoteUrl) {
            const remoteRes = await fetch(item.remoteUrl);
            if (!remoteRes.ok) {
              throw new Error('Failed to fetch selected GIF. Try another GIF.');
            }
            blobToUpload = await remoteRes.blob();
            encoding = blobToUpload.type || 'image/gif';
          }

          if (!blobToUpload) {
            throw new Error('Missing media data for upload.');
          }

          const upload = await agent.uploadBlob(blobToUpload, {
            encoding,
          });
          const alt = item.alt.trim();
          uploadedImages.push({
            image: upload.data.blob,
            alt,
            ...(item.width > 0 && item.height > 0 ? { aspectRatio: { width: item.width, height: item.height } } : {}),
          });
        }
        embed = {
          $type: 'app.bsky.embed.images',
          images: uploadedImages,
        };
      } else if (linkPreview) {
        embed = await buildExternalEmbed(linkPreview);
      }

      // Build reply ref when replying to an existing post.
      const replyRef = replyTarget ? {
        root: {
          uri: replyTarget.threadRoot?.id ?? replyTarget.id,
          cid: replyTarget.threadRoot?.cid ?? replyTarget.cid ?? '',
        },
        parent: {
          uri: replyTarget.id,
          cid: replyTarget.cid ?? '',
        },
      } : undefined;

      await agent.post({
        text: rt.text,
        facets: rt.facets,
        createdAt: new Date().toISOString(),
        ...(embed ? { embed } : {}),
        ...(replyRef ? { reply: replyRef } : {}),
      });

      if (mediaItems.length > 0) {
        const describedItems = mediaItems.reduce((count, item) => count + (item.alt.trim().length > 0 ? 1 : 0), 0);
        recordAltPostCoverage(mediaItems.length, describedItems);
        setAltMetrics(getAltTextMetricsSnapshot());
      }

      const usedTags = extractHashtags(text);
      if (usedTags.length > 0) saveRecentHashtags(usedTags);

      onClose();
    } catch (err: any) {
      setPostError(err?.message ?? 'Failed to post. Please try again.');
    } finally {
      setPosting(false);
    }
  }, [agent, buildExternalEmbed, canPost, linkPreview, mediaItems, onClose, replyTarget, text]);

  const handlePost = useCallback(() => {
    if (!canPost) return;
    if (missingAltCount > 0) {
      if (requireAltText) {
        setPostError(`Add ALT text for all media before posting (${missingAltCount} missing).`);
        return;
      }
      setShowMissingAltConfirm(true);
      return;
    }
    if (lowQualityAltCount > 0) {
      setShowLowQualityAltConfirm(true);
      return;
    }
    void commitPost();
  }, [canPost, commitPost, missingAltCount, requireAltText, lowQualityAltCount]);

  useEffect(() => {
    const timer = setTimeout(() => taRef.current?.focus(), 120);
    return () => clearTimeout(timer);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val.slice(0, MAX + 10));
    if (dismissedPreviewUrl) {
      const nextUrl = getFirstPreviewUrl(val);
      if (nextUrl !== dismissedPreviewUrl) {
        setDismissedPreviewUrl(null);
      }
    }
    // Auto-show preview once there's meaningful content
    if (val.trim().length > 15 && !showPreview) setShowPreview(true);
    if (val.trim().length === 0) setShowPreview(false);
    // Auto-resize
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 220) + 'px';
  };

  const insertText = useCallback((snippet: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const newText = text.slice(0, start) + snippet + text.slice(end);
    setText(newText.slice(0, MAX + 10));
    setTimeout(() => {
      ta.focus();
      const pos = start + snippet.length;
      ta.setSelectionRange(pos, pos);
    }, 0);
  }, [text]);

  const toggleTool = (tool: ActiveTool) => {
    setActiveTool(prev => prev === tool ? null : tool);
  };

  const openMediaPicker = () => {
    fileInputRef.current?.click();
  };

  const handleAddLink = useCallback(() => {
    const urlInText = getFirstPreviewUrl(text);
    if (!urlInText) {
      const needsLeadingSpace = text.length > 0 && !text.endsWith(' ');
      insertText(`${needsLeadingSpace ? ' ' : ''}https://`);
      return;
    }
    setShowPreview(true);
  }, [insertText, text]);

  const handleCarouselScroll = useCallback(() => {
    const el = mediaCarouselRef.current;
    if (!el || mediaItems.length === 0) return;
    const itemWidth = el.scrollWidth / mediaItems.length;
    const idx = Math.round(el.scrollLeft / itemWidth);
    setActiveCarouselIdx(Math.min(Math.max(idx, 0), mediaItems.length - 1));
  }, [mediaItems.length]);

  const handleMediaSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const slotsLeft = Math.max(0, MAX_MEDIA - mediaItems.length);
    const acceptedFiles = files
      .filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/'))
      .slice(0, slotsLeft);
    if (acceptedFiles.length === 0) {
      setPostError(`You can attach up to ${MAX_MEDIA} photos or videos.`);
      e.target.value = '';
      return;
    }

    const items = await Promise.all(
      acceptedFiles.map(async (file) => {
        const isVideo = file.type.startsWith('video/');
        const { width, height } = isVideo
          ? await loadVideoDimensions(file)
          : await loadImageDimensions(file);
        return {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          file,
          previewUrl: URL.createObjectURL(file),
          alt: '',
          width,
          height,
          mediaType: (isVideo ? 'video' : 'image') as 'image' | 'video',
        } satisfies ComposeMediaItem;
      })
    );

    setMediaItems(prev => [...prev, ...items]);
    setActiveTool(null);
    setShowAttachMenu(false);
    e.target.value = '';
  };

  const removeMedia = (id: string) => {
    setMediaItems(prev => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
    if (editingAltId === id) {
      setEditingAltId(null);
      setAltDraft('');
    }
  };

  const handleGifSelected = useCallback((gif: TenorGif) => {
    if (mediaItems.length >= MAX_MEDIA) {
      setPostError(`You can attach up to ${MAX_MEDIA} photos or videos.`);
      return;
    }

    const [gifWidth, gifHeight] = gif.media_formats.gif.dims;
    const width = Number.isFinite(gifWidth) && gifWidth > 0 ? gifWidth : 480;
    const height = Number.isFinite(gifHeight) && gifHeight > 0 ? gifHeight : 270;

    setMediaItems((prev) => [
      ...prev,
      {
        id: `tenor-${gif.id}-${Date.now()}`,
        file: null,
        previewUrl: gif.media_formats.gif.url,
        remoteUrl: gif.media_formats.gif.url,
        alt: gif.title?.trim() || 'Animated GIF',
        width,
        height,
        mediaType: 'image',
      },
    ]);

    setShowGifPicker(false);
    setShowAttachMenu(false);
    setActiveTool(null);
  }, [mediaItems.length]);

  const openAltEditor = useCallback((id: string) => {
    const item = mediaItems.find((entry) => entry.id === id);
    if (!item) return;
    setEditingAltId(id);
    setAltDraft(item.alt);
    setAltSuggestionError(null);
  }, [mediaItems]);

  const closeAltEditor = useCallback(() => {
    setEditingAltId(null);
    setAltDraft('');
    setAltSuggestionError(null);
  }, []);

  const saveAltDraft = useCallback(() => {
    if (!editingAltId) return;
    setMediaItems(prev => prev.map((item) => (item.id === editingAltId ? { ...item, alt: altDraft } : item)));
    closeAltEditor();
  }, [altDraft, closeAltEditor, editingAltId]);

  const openNextAltEditor = useCallback(() => {
    if (mediaItems.length === 0) return;
    const next = mediaItems.find((item) => item.alt.trim().length === 0) ?? mediaItems[0];
    openAltEditor(next.id);
  }, [mediaItems, openAltEditor]);

  const suggestAltDraft = useCallback(async () => {
    if (!editingMedia) return;
    setIsGeneratingAltSuggestion(true);
    setAltSuggestionError(null);
    try {
      const caption = await inferenceClient.captionImage(editingMedia.previewUrl);
      const normalized = caption.trim();
      if (!normalized) throw new Error('No caption generated');
      setAltDraft(normalized.slice(0, ALT_MAX_CHARS));
    } catch {
      setAltSuggestionError('Suggestion failed. You can still write ALT manually.');
    } finally {
      setIsGeneratingAltSuggestion(false);
    }
  }, [editingMedia]);

  const regenerateAltDraft = useCallback(async () => {
    if (!editingMedia || isGeneratingAltSuggestion) return;
    setIsGeneratingAltSuggestion(true);
    setAltSuggestionError(null);
    try {
      const caption = await inferenceClient.captionImage(editingMedia.previewUrl);
      const normalized = caption.trim();
      if (!normalized) throw new Error('No caption generated');
      setAltDraft(normalized.slice(0, ALT_MAX_CHARS));
    } catch {
      setAltSuggestionError('Regeneration failed. You can still edit ALT manually.');
    } finally {
      setIsGeneratingAltSuggestion(false);
    }
  }, [editingMedia, isGeneratingAltSuggestion]);

  const generateMissingAltDrafts = useCallback(async () => {
    const missing = mediaItems.filter((item) => item.alt.trim().length === 0);
    if (missing.length === 0 || isGeneratingBulkAlt) return;

    setIsGeneratingBulkAlt(true);
    setBulkAltError(null);
    setBulkAltProgress({ done: 0, total: missing.length });

    const generated = new Map<string, string>();
    let failures = 0;

    try {
      for (let i = 0; i < missing.length; i += 1) {
        const item = missing[i];
        try {
          const caption = await inferenceClient.captionImage(item.previewUrl);
          const normalized = caption.trim();
          if (normalized) {
            generated.set(item.id, normalized.slice(0, ALT_MAX_CHARS));
          } else {
            failures += 1;
          }
        } catch {
          failures += 1;
        }
        setBulkAltProgress({ done: i + 1, total: missing.length });
      }

      if (generated.size > 0) {
        setMediaItems((prev) => prev.map((item) => (
          generated.has(item.id)
            ? { ...item, alt: generated.get(item.id) ?? item.alt }
            : item
        )));
      }

      recordBulkAltRun(missing.length, generated.size, failures);
      setAltMetrics(getAltTextMetricsSnapshot());

      if (failures > 0) {
        setBulkAltError(`Generated ${generated.size}/${missing.length}. ${failures} suggestion${failures > 1 ? 's' : ''} failed.`);
      }
    } finally {
      setIsGeneratingBulkAlt(false);
      setTimeout(() => setBulkAltProgress(null), 1200);
    }
  }, [isGeneratingBulkAlt, mediaItems]);

  useEffect(() => {
    if (!editingMedia) return;
    const timer = setTimeout(() => altTaRef.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, [editingMedia]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      const typingTarget = tag === 'INPUT' || tag === 'TEXTAREA';

      if (event.altKey && (event.key === 'a' || event.key === 'A') && !typingTarget) {
        event.preventDefault();
        openNextAltEditor();
      }

      if (!editingMedia) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        closeAltEditor();
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        saveAltDraft();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeAltEditor, editingMedia, openNextAltEditor, saveAltDraft]);

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          zIndex: 200,
        }}
      />

      {/* Sheet */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 400, damping: 42, mass: 0.9 }}
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0,
          background: 'var(--surface)',
          borderRadius: '24px 24px 0 0',
          zIndex: 201,
          boxShadow: '0 -8px 48px rgba(0,0,0,0.22)',
          display: 'flex', flexDirection: 'column',
          maxHeight: '94vh',
        }}
      >
        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 2px', flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--fill-3)' }} />
        </div>

        {/* Header */}
        <div style={{
          display: 'flex', flexDirection: 'row', alignItems: 'center',
          padding: '6px 16px 12px',
          borderBottom: '0.5px solid var(--sep)',
          flexShrink: 0, gap: 8,
        }}>
          <button
            onClick={onClose}
            style={{ fontSize: 15, color: 'var(--label-2)', fontWeight: 400, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', minWidth: 56 }}
          >
            Cancel
          </button>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--label-1)', letterSpacing: -0.4 }}>
              {replyTarget ? 'Reply' : 'New Post'}
            </span>
          </div>
          <div style={{ minWidth: 56, display: 'flex', justifyContent: 'flex-end' }}>
            <motion.button
              disabled={!canPost}
              onClick={handlePost}
              whileTap={canPost ? { scale: 0.94 } : {}}
              style={{
                padding: '8px 20px', borderRadius: 100,
                background: canPost ? 'var(--blue)' : 'var(--fill-2)',
                color: canPost ? '#fff' : 'var(--label-3)',
                fontSize: 15, fontWeight: 700, border: 'none',
                cursor: canPost ? 'pointer' : 'default',
                transition: 'background 0.15s, color 0.15s',
                letterSpacing: -0.2,
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {posting ? (
                <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></path></svg>Posting…</>
              ) : 'Post'}
            </motion.button>
          </div>
        </div>

        {/* Format bar (collapsible) */}
        <AnimatePresence>
          {showFormatBar && <FormatBar onInsert={insertText} />}
        </AnimatePresence>

        {/* Post error */}
        {postError && (
          <div style={{ padding: '8px 16px', background: 'rgba(255,59,48,0.08)', borderBottom: '0.5px solid rgba(255,59,48,0.2)' }}>
            <p style={{ fontSize: 13, color: 'var(--red)' }}>{postError}</p>
          </div>
        )}

        {/* Reply context — quoted post the user is replying to */}
        {replyTarget && (
          <div style={{
            margin: '0 16px 0',
            padding: '10px 12px',
            borderRadius: 12,
            background: 'var(--fill-2)',
            border: '0.5px solid var(--sep)',
            display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'flex-start',
            flexShrink: 0,
          }}>
            {/* Reply-to indicator line */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, paddingTop: 2 }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
                background: 'var(--fill-3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700, color: 'var(--label-2)',
              }}>
                {replyTarget.author.avatar
                  ? <img src={replyTarget.author.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : (replyTarget.author.displayName?.[0] ?? replyTarget.author.handle[0] ?? '?').toUpperCase()
                }
              </div>
              <div style={{ width: 1.5, flex: 1, minHeight: 8, background: 'var(--sep)', borderRadius: 1 }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-2)', marginBottom: 2 }}>
                <button className="interactive-link-button" onClick={(e) => { e.stopPropagation(); void navigateToProfile(replyTarget.author.did || replyTarget.author.handle); }} style={{ font: 'inherit', fontWeight: 600, color: 'inherit', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                  {replyTarget.author.displayName ?? replyTarget.author.handle}
                </button>
                <button className="interactive-link-button" onClick={(e) => { e.stopPropagation(); void navigateToProfile(replyTarget.author.did || replyTarget.author.handle); }} style={{ fontWeight: 400, color: 'var(--label-3)', marginLeft: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>@{replyTarget.author.handle}</button>
              </p>
              <p style={{
                fontSize: 13, color: 'var(--label-2)', lineHeight: 1.4,
                overflow: 'hidden', display: '-webkit-box',
                WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              }}>
                <TwemojiText text={replyTarget.content} onMention={(handle) => { void navigateToProfile(handle); }} />
              </p>
            </div>
          </div>
        )}

        {/* Scrollable body */}
        <div className="scroll-y" style={{ flex: 1, minHeight: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 12, padding: '14px 16px 0' }}>
            {/* Avatar */}
            <div style={{
              width: 42, height: 42, borderRadius: '50%', overflow: 'hidden',
              background: 'linear-gradient(135deg, var(--blue) 0%, var(--indigo) 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 17, fontWeight: 800, flexShrink: 0,
              boxShadow: '0 2px 8px rgba(0,122,255,0.3)',
            }}>
              {profile?.avatar
                ? <img src={profile.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : (profile?.displayName?.[0] ?? profile?.handle?.[0] ?? 'Y')
              }
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Handle + audience */}
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--label-1)', letterSpacing: -0.3 }}>
                  {profile?.displayName ?? profile?.handle ?? 'you.bsky.social'}
                </span>
                <AudiencePicker value={audience} onChange={setAudience} />
              </div>

              {/* Textarea */}
              <textarea
                ref={taRef}
                value={text}
                onChange={handleChange}
                placeholder="What's on your mind?"
                rows={4}
                style={{
                  width: '100%', fontSize: 17, lineHeight: 1.48, letterSpacing: -0.3,
                  color: 'var(--label-1)', background: 'none', border: 'none', outline: 'none',
                  resize: 'none', fontFamily: 'inherit', minHeight: 100, maxHeight: 220,
                  caretColor: 'var(--blue)',
                }}
              />

              {/* Sentiment / content analysis banner */}
              <AnimatePresence>
                {sentimentResult.level !== 'ok' && sentimentDismissedAt === null && (
                  <SentimentBanner
                    result={sentimentResult}
                    parentSnippet={replyParentText}
                    onDismiss={() => setSentimentDismissedAt(Date.now())}
                  />
                )}
              </AnimatePresence>

              <SentimentDebugCard
                result={sentimentResult}
                draftText={text}
                parentSnippet={replyParentText}
                dismissedAt={sentimentDismissedAt}
              />

              {/* Live preview */}
              <AnimatePresence>
                {showPreview && text.trim().length > 15 && (
                  <LivePreview text={text} audience={audience} />
                )}
              </AnimatePresence>

              {(linkPreviewLoading || linkPreview) && (
                <div style={{
                  marginTop: 10,
                  border: '1px solid var(--sep)',
                  borderRadius: 14,
                  overflow: 'hidden',
                  background: 'var(--fill-1)',
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderBottom: '0.5px solid var(--sep)',
                    background: 'rgba(10,132,255,0.07)',
                    gap: 8,
                  }}>
                    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.3, color: 'var(--blue)' }}>
                      LINK PREVIEW
                    </span>
                    {linkPreview?.url && (
                      <button
                        type="button"
                        onClick={() => {
                          setDismissedPreviewUrl(linkPreview.url);
                          setLinkPreview(null);
                          setLinkPreviewError(null);
                        }}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--label-3)',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                          padding: 0,
                        }}
                      >
                        Dismiss
                      </button>
                    )}
                  </div>

                  {linkPreviewLoading && (
                    <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--label-3)' }}>
                      Generating preview…
                    </div>
                  )}

                  {!linkPreviewLoading && linkPreview && (
                    <>
                      {linkPreview.image && (
                        <div style={{ height: 160, background: 'var(--fill-2)' }}>
                          <img
                            src={linkPreview.image}
                            alt={linkPreview.title || 'Link preview image'}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        </div>
                      )}
                      <div style={{ padding: '10px 12px' }}>
                        <p style={{ margin: 0, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--label-3)' }}>
                          {linkPreview.siteName}
                        </p>
                        <p style={{ margin: '4px 0 0', fontSize: 14, fontWeight: 700, color: 'var(--label-1)', lineHeight: 1.35 }}>
                          {linkPreview.title}
                        </p>
                        {linkPreview.description && (
                          <p style={{ margin: '5px 0 0', fontSize: 12, color: 'var(--label-3)', lineHeight: 1.35 }}>
                            {linkPreview.description}
                          </p>
                        )}
                        {(linkPreview.author || linkPreview.authorHandle) && (
                          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--label-3)', lineHeight: 1.35 }}>
                            {linkPreview.author && (
                              <span>By <span style={{ fontWeight: 600, color: 'var(--label-2)' }}>{linkPreview.author}</span></span>
                            )}
                            {linkPreview.authorHandle && (
                              <span style={{ marginLeft: linkPreview.author ? 4 : 0, color: 'var(--blue)' }}>
                                {linkPreview.authorHandle}
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    </>
                  )}

                  {linkPreviewError && !linkPreviewLoading && (
                    <p style={{ margin: '0 12px 10px', fontSize: 11, color: 'var(--orange)', lineHeight: 1.35 }}>
                      {linkPreviewError}
                    </p>
                  )}
                </div>
              )}

              {/* Hashtag Insights — shown whenever #hashtags are detected */}
              <AnimatePresence>
                {hashtagInsights.length > 0 && (
                  <HashtagInsightsPanel insights={hashtagInsights} loading={insightsLoading} />
                )}
              </AnimatePresence>

              {mediaItems.length > 0 && (
                <div style={{
                  marginTop: 12,
                  border: '1px solid var(--sep)',
                  borderRadius: 14,
                  padding: 10,
                  background: 'var(--fill-1)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-2)', letterSpacing: 0.2 }}>
                      Media ALT coverage: {describedMediaCount}/{mediaItems.length}
                    </div>
                    <button
                      type="button"
                      onClick={() => setRequireAltText(prev => !prev)}
                      style={{
                        border: 'none',
                        background: requireAltText ? 'rgba(0,122,255,0.14)' : 'transparent',
                        color: requireAltText ? 'var(--blue)' : 'var(--label-3)',
                        fontSize: 12,
                        fontWeight: 700,
                        borderRadius: 999,
                        padding: '5px 10px',
                        cursor: 'pointer',
                      }}
                    >
                      {requireAltText ? 'Require ALT: On' : 'Require ALT: Off'}
                    </button>
                  </div>

                  <div style={{ marginBottom: 8, fontSize: 11, color: 'var(--label-4)' }}>
                    Session ALT completion {(altMetrics.completionRate * 100).toFixed(0)}% · Bulk success {(altMetrics.bulkSuccessRate * 100).toFixed(0)}%
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => { void generateMissingAltDrafts(); }}
                      disabled={isGeneratingBulkAlt || missingAltCount === 0}
                      style={{
                        border: 'none',
                        background: 'var(--blue)',
                        color: '#fff',
                        fontSize: 12,
                        fontWeight: 800,
                        borderRadius: 999,
                        padding: '6px 12px',
                        cursor: isGeneratingBulkAlt || missingAltCount === 0 ? 'default' : 'pointer',
                        opacity: isGeneratingBulkAlt || missingAltCount === 0 ? 0.65 : 1,
                      }}
                    >
                      {isGeneratingBulkAlt ? 'Generating ALT…' : 'Generate Missing ALT'}
                    </button>
                    <button
                      type="button"
                      onClick={openNextAltEditor}
                      style={{
                        border: '1px solid var(--sep)',
                        background: 'var(--surface)',
                        color: 'var(--label-2)',
                        fontSize: 12,
                        fontWeight: 700,
                        borderRadius: 999,
                        padding: '6px 12px',
                        cursor: 'pointer',
                      }}
                    >
                      Edit Next ALT (Alt+A)
                    </button>
                    {bulkAltProgress && (
                      <span style={{ fontSize: 11, color: 'var(--label-3)', fontWeight: 700 }}>
                        {bulkAltProgress.done}/{bulkAltProgress.total}
                      </span>
                    )}
                  </div>

                  {/* Carousel scroll container */}
                  <div
                    ref={mediaCarouselRef}
                    onScroll={handleCarouselScroll}
                    style={{
                      display: 'flex', flexDirection: 'row',
                      overflowX: 'auto', scrollSnapType: 'x mandatory',
                      scrollBehavior: 'smooth', gap: 8, borderRadius: 14,
                      WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
                    } as React.CSSProperties}
                  >
                    {mediaItems.map((item, idx) => {
                      const hasAlt = item.alt.trim().length > 0;
                      return (
                        <div
                          key={item.id}
                          style={{
                            flexShrink: 0, scrollSnapAlign: 'start',
                            width: mediaItems.length === 1 ? '100%' : 'calc(88%)',
                            position: 'relative', borderRadius: 14,
                            overflow: 'hidden', background: 'var(--fill-2)', aspectRatio: '4/3',
                          }}
                        >
                          {item.mediaType === 'video' ? (
                            <video
                              src={item.previewUrl}
                              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                              muted playsInline
                            />
                          ) : (
                            <img src={item.previewUrl} alt={item.alt || ''} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                          )}

                          {/* Video play overlay */}
                          {item.mediaType === 'video' && (
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                              <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,0.52)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                              </div>
                            </div>
                          )}

                          {/* Remove */}
                          <button
                            type="button"
                            onClick={() => removeMedia(item.id)}
                            style={{
                              position: 'absolute', top: 8, right: 8,
                              border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff',
                              width: 26, height: 26, borderRadius: '50%', cursor: 'pointer',
                              fontWeight: 700, fontSize: 15,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                          >×</button>

                          {/* ALT */}
                          <button
                            type="button"
                            onClick={() => openAltEditor(item.id)}
                            style={{
                              position: 'absolute', left: 8, bottom: 8,
                              border: 'none',
                              background: hasAlt ? 'rgba(10,132,255,0.9)' : 'rgba(255,149,0,0.92)',
                              color: '#fff', fontSize: 11, fontWeight: 800,
                              borderRadius: 999, padding: '4px 8px', cursor: 'pointer',
                            }}
                          >
                            {hasAlt ? 'ALT ✓' : 'Add ALT'}
                          </button>

                          {/* Position badge */}
                          {mediaItems.length > 1 && (
                            <div style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,0.48)', color: '#fff', borderRadius: 999, fontSize: 10, fontWeight: 700, padding: '2px 7px' }}>
                              {idx + 1}/{mediaItems.length}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Dot indicators */}
                  {mediaItems.length > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 5, marginTop: 8 }}>
                      {mediaItems.map((_, idx) => (
                        <div
                          key={idx}
                          style={{
                            width: activeCarouselIdx === idx ? 16 : 6,
                            height: 6, borderRadius: 3,
                            background: activeCarouselIdx === idx ? 'var(--blue)' : 'var(--fill-3)',
                            transition: 'width 0.2s, background 0.2s',
                          }}
                        />
                      ))}
                    </div>
                  )}

                  {missingAltCount > 0 && (
                    <p style={{ marginTop: 8, fontSize: 12, color: 'var(--orange)', lineHeight: 1.35 }}>
                      {missingAltCount} image{missingAltCount > 1 ? 's are' : ' is'} missing ALT text.
                    </p>
                  )}

                  {lowQualityAltCount > 0 && (
                    <p style={{ marginTop: 6, fontSize: 12, color: 'var(--orange)', lineHeight: 1.35 }}>
                      {lowQualityAltCount} ALT description{lowQualityAltCount > 1 ? 's need' : ' needs'} more detail.
                    </p>
                  )}

                  {bulkAltError && (
                    <p style={{ marginTop: 6, fontSize: 12, color: 'var(--red)', lineHeight: 1.35 }}>
                      {bulkAltError}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Thread add row */}
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, padding: '8px 16px 14px' }}>
            <div style={{ width: 42, display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: 1.5, height: 20, background: 'var(--sep)', borderRadius: 1 }} />
            </div>
            <button style={{ fontSize: 14, color: 'var(--label-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              Add to thread…
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div style={{
          flexShrink: 0,
          borderTop: '0.5px solid var(--sep)',
          background: 'var(--surface)',
        }}>
          {/* Attach menu — slides in above toolbar row */}
          <AnimatePresence>
            {showAttachMenu && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
                style={{ overflow: 'hidden', borderBottom: '0.5px solid var(--sep)' }}
              >
                <div style={{ display: 'flex', flexDirection: 'row', gap: 4, padding: '12px 14px 10px' }}>
                  {/* Photos & Videos */}
                  <button
                    onClick={() => { openMediaPicker(); setShowAttachMenu(false); }}
                    disabled={mediaItems.length >= MAX_MEDIA}
                    style={{
                      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      padding: '10px 6px', borderRadius: 14,
                      background: 'var(--fill-1)', border: 'none', cursor: mediaItems.length >= MAX_MEDIA ? 'default' : 'pointer',
                      opacity: mediaItems.length >= MAX_MEDIA ? 0.45 : 1,
                    }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--label-2)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2.5"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--label-2)', letterSpacing: 0.1 }}>Media</span>
                  </button>

                  {/* GIF */}
                  <button
                    onClick={() => { setShowGifPicker(true); setActiveTool('gif'); setShowAttachMenu(false); }}
                    style={{
                      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      padding: '10px 6px', borderRadius: 14,
                      background: activeTool === 'gif' ? 'rgba(0,122,255,0.1)' : 'var(--fill-1)',
                      border: 'none', cursor: 'pointer',
                    }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={activeTool === 'gif' ? 'var(--blue)' : 'var(--label-2)'} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="6" width="20" height="12" rx="2"/>
                      <path d="M10 9v6"/><path d="M7 9v6"/><path d="M7 12h3"/>
                      <path d="M14 9h3v2h-2v2h2v2h-3"/>
                    </svg>
                    <span style={{ fontSize: 10, fontWeight: 600, color: activeTool === 'gif' ? 'var(--blue)' : 'var(--label-2)', letterSpacing: 0.1 }}>GIF</span>
                  </button>

                  {/* Link */}
                  <button
                    onClick={() => { handleAddLink(); setShowAttachMenu(false); }}
                    style={{
                      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      padding: '10px 6px', borderRadius: 14,
                      background: 'var(--fill-1)', border: 'none', cursor: 'pointer',
                    }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--label-2)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
                      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
                    </svg>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--label-2)', letterSpacing: 0.1 }}>Link</span>
                  </button>

                  {/* Mention */}
                  <button
                    onClick={() => { insertText('@'); setShowAttachMenu(false); }}
                    style={{
                      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      padding: '10px 6px', borderRadius: 14,
                      background: 'var(--fill-1)', border: 'none', cursor: 'pointer',
                    }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--label-2)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="4"/>
                      <path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-3.92 7.94"/>
                    </svg>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--label-2)', letterSpacing: 0.1 }}>Mention</span>
                  </button>

                  {/* Hashtag */}
                  <button
                    onClick={() => { setShowHashtagBrowser(true); setShowAttachMenu(false); }}
                    style={{
                      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      padding: '10px 6px', borderRadius: 14,
                      background: 'var(--fill-1)', border: 'none', cursor: 'pointer',
                    }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--label-2)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                      <line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/>
                      <line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>
                    </svg>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--label-2)', letterSpacing: 0.1 }}>Tag</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Primary tool row */}
          <div style={{
            display: 'flex', flexDirection: 'row', alignItems: 'center',
            padding: '8px 10px',
            paddingBottom: 'calc(var(--safe-bottom) + 8px)',
            gap: 0,
          }}>
            {/* + Attach button */}
            <motion.button
              onClick={() => setShowAttachMenu(prev => !prev)}
              aria-label="Add attachment"
              animate={{ rotate: showAttachMenu ? 45 : 0 }}
              transition={{ duration: 0.18 }}
              style={{
                width: 34, height: 34, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: showAttachMenu ? 'var(--blue)' : 'var(--label-2)',
                background: showAttachMenu ? 'rgba(0,122,255,0.1)' : 'none',
                border: `1.5px solid ${showAttachMenu ? 'var(--blue)' : 'var(--sep)'}`,
                cursor: 'pointer', marginRight: 4,
                transition: 'background 0.12s, color 0.12s, border-color 0.12s',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </motion.button>

            {/* Format toggle */}
            <ToolBtn label="Formatting" active={showFormatBar} onPress={() => setShowFormatBar(v => !v)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>
              </svg>
            </ToolBtn>

            {/* Preview toggle */}
            <ToolBtn label="Toggle preview" active={showPreview} onPress={() => setShowPreview(v => !v)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </ToolBtn>

            <div style={{ flex: 1 }} />

            {mediaItems.length > 0 && (
              <span style={{ fontSize: 12, fontWeight: 700, color: missingAltCount > 0 ? 'var(--orange)' : 'var(--label-3)', marginRight: 8 }}>
                ALT {describedMediaCount}/{mediaItems.length}
              </span>
            )}

            {/* Character ring */}
            <CharRing used={text.length} max={MAX} />

            {/* Divider */}
            <div style={{ width: 1, height: 22, background: 'var(--sep)', margin: '0 8px', flexShrink: 0 }} />

            {/* Audience picker */}
            <AudiencePicker value={audience} onChange={setAudience} />
          </div>
        </div>
      </motion.div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        onChange={handleMediaSelected}
        style={{ display: 'none' }}
      />

      {showGifPicker && (
        <GifPicker
          onSelect={handleGifSelected}
          onClose={() => {
            setShowGifPicker(false);
            setActiveTool(null);
          }}
        />
      )}

      <AnimatePresence>
        {showHashtagBrowser && (
          <HashtagBrowser
            agent={agent}
            onSelect={(tag) => {
              const needsSpace = text.length > 0 && !text.endsWith(' ');
              insertText(`${needsSpace ? ' ' : ''}#${tag} `);
            }}
            onClose={() => setShowHashtagBrowser(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingMedia && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                closeAltEditor();
              }}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 230 }}
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              style={{
                position: 'fixed',
                left: 16,
                right: 16,
                bottom: 'calc(var(--safe-bottom) + 16px)',
                zIndex: 231,
                background: 'var(--surface)',
                borderRadius: 16,
                border: '1px solid var(--sep)',
                boxShadow: '0 12px 36px rgba(0,0,0,0.25)',
                overflow: 'hidden',
              }}
            >
              <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--sep)', background: 'var(--fill-1)' }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--label-1)' }}>Media description (ALT text)</div>
                <div style={{ fontSize: 12, color: 'var(--label-3)', marginTop: 2 }}>Describe what matters in this image, not just the colors. Press Cmd/Ctrl+Enter to save.</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => {
                      void suggestAltDraft();
                    }}
                    disabled={isGeneratingAltSuggestion}
                    style={{
                      border: 'none',
                      background: 'var(--blue)',
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 800,
                      borderRadius: 999,
                      padding: '5px 10px',
                      cursor: isGeneratingAltSuggestion ? 'default' : 'pointer',
                      opacity: isGeneratingAltSuggestion ? 0.7 : 1,
                    }}
                  >
                    {isGeneratingAltSuggestion ? 'Generating…' : 'Suggest ALT (Open Source)'}
                  </button>
                    <button
                      type="button"
                      onClick={() => {
                        void regenerateAltDraft();
                      }}
                      disabled={isGeneratingAltSuggestion}
                      style={{
                        border: '1px solid var(--sep)',
                        background: 'var(--surface)',
                        color: 'var(--label-2)',
                        fontSize: 11,
                        fontWeight: 800,
                        borderRadius: 999,
                        padding: '5px 10px',
                        cursor: isGeneratingAltSuggestion ? 'default' : 'pointer',
                        opacity: isGeneratingAltSuggestion ? 0.7 : 1,
                      }}
                    >
                      Regenerate ALT
                    </button>
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--label-4)', textAlign: 'right' }}>
                    Inspired by Ice Cubes AI descriptions, but local/open-source.
                  </span>
                </div>
              </div>
              <div style={{ padding: 12 }}>
                <textarea
                  ref={altTaRef}
                  value={altDraft}
                  onChange={(e) => setAltDraft(e.target.value.slice(0, ALT_MAX_CHARS))}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault();
                      saveAltDraft();
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      closeAltEditor();
                    }
                  }}
                  placeholder="Example: Screenshot of a code editor showing a TypeScript function that builds a feed ranking list."
                  rows={4}
                  style={{
                    width: '100%',
                    borderRadius: 10,
                    border: '1px solid var(--sep)',
                    background: 'var(--bg)',
                    color: 'var(--label-1)',
                    fontSize: 14,
                    lineHeight: 1.4,
                    padding: '10px 12px',
                    resize: 'vertical',
                    minHeight: 90,
                    maxHeight: 220,
                    outline: 'none',
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => setAltDraft('Decorative image.')}
                    style={{ border: 'none', background: 'transparent', color: 'var(--blue)', fontSize: 12, fontWeight: 700, padding: 0, cursor: 'pointer' }}
                  >
                    Mark decorative
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--label-4)', fontWeight: 600 }}>{altDraft.trim().length}/{ALT_MAX_CHARS}</span>
                </div>
                {altQualityHint && (
                  <p style={{ marginTop: 8, fontSize: 11, color: 'var(--orange)', lineHeight: 1.35 }}>
                    {altQualityHint}
                  </p>
                )}
                {altLintIssues.length > 1 && (
                  <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 16 }}>
                    {altLintIssues.slice(1, 4).map((issue, index) => (
                      <li key={`${issue.message}-${index}`} style={{ fontSize: 11, color: issue.level === 'error' ? 'var(--red)' : 'var(--orange)', lineHeight: 1.35, marginTop: 2 }}>
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
                {altSuggestionError && (
                  <p style={{ marginTop: 8, fontSize: 11, color: 'var(--red)', lineHeight: 1.35 }}>
                    {altSuggestionError}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '0 12px 12px' }}>
                <button
                  type="button"
                  onClick={() => {
                    closeAltEditor();
                  }}
                  style={{ border: '1px solid var(--sep)', background: 'var(--surface)', color: 'var(--label-2)', borderRadius: 10, padding: '8px 12px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveAltDraft}
                  style={{ border: 'none', background: 'var(--blue)', color: '#fff', borderRadius: 10, padding: '8px 12px', fontWeight: 800, cursor: 'pointer' }}
                >
                  Save ALT
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showLowQualityAltConfirm && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowLowQualityAltConfirm(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 242 }}
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.16 }}
              style={{
                position: 'fixed',
                left: 16,
                right: 16,
                bottom: 'calc(var(--safe-bottom) + 16px)',
                zIndex: 243,
                background: 'var(--surface)',
                borderRadius: 16,
                border: '1px solid var(--sep)',
                boxShadow: '0 12px 36px rgba(0,0,0,0.26)',
                padding: 14,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--label-1)' }}>Post with weak ALT quality?</h3>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--label-2)', lineHeight: 1.45 }}>
                {lowQualityAltCount} ALT description{lowQualityAltCount > 1 ? 's look' : ' looks'} incomplete. You can still post, but refining ALT improves screen-reader experience.
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowLowQualityAltConfirm(false);
                    openNextAltEditor();
                  }}
                  style={{ border: '1px solid var(--sep)', background: 'var(--surface)', color: 'var(--label-2)', borderRadius: 10, padding: '8px 12px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Improve ALT
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowLowQualityAltConfirm(false);
                    void commitPost();
                  }}
                  style={{ border: 'none', background: 'var(--orange)', color: '#fff', borderRadius: 10, padding: '8px 12px', fontWeight: 800, cursor: 'pointer' }}
                >
                  Post anyway
                </button>
              </div>
            </motion.div>
          </>
        )}

        {showMissingAltConfirm && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMissingAltConfirm(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 240 }}
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.16 }}
              style={{
                position: 'fixed',
                left: 16,
                right: 16,
                bottom: 'calc(var(--safe-bottom) + 16px)',
                zIndex: 241,
                background: 'var(--surface)',
                borderRadius: 16,
                border: '1px solid var(--sep)',
                boxShadow: '0 12px 36px rgba(0,0,0,0.26)',
                padding: 14,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--label-1)' }}>Post without ALT text?</h3>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--label-2)', lineHeight: 1.45 }}>
                {missingAltCount} image{missingAltCount > 1 ? 's are' : ' is'} missing media descriptions. Mastodon-style clients usually warn here so you can add ALT before publishing.
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setShowMissingAltConfirm(false)}
                  style={{ border: '1px solid var(--sep)', background: 'var(--surface)', color: 'var(--label-2)', borderRadius: 10, padding: '8px 12px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Go back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMissingAltConfirm(false);
                    void commitPost();
                  }}
                  style={{ border: 'none', background: 'var(--orange)', color: '#fff', borderRadius: 10, padding: '8px 12px', fontWeight: 800, cursor: 'pointer' }}
                >
                  Post anyway
                </button>
              </div>
            </motion.div>
          </>
        )}

      </AnimatePresence>
    </>
  );
}
