// ─── Profile Tab ────────────────────────────────────────────────────────────
// Apple Connect-inspired profile page with 6 sub-tabs.
// Own profile by default (session.did); accepts an optional actorDid prop
// for viewing other users' profiles in the future.

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AppBskyFeedDefs, AppBskyActorDefs, AppBskyGraphDefs } from '@atproto/api';
import { useSessionStore } from '../store/sessionStore';
import { useUiStore } from '../store/uiStore';
import { useTranslationStore } from '../store/translationStore';
import { atpCall } from '../lib/atproto/client';
import { mapFeedViewPost, hasDisplayableRecordContent } from '../atproto/mappers';
import PostCard from '../components/PostCard';
import TranslationSettingsSheet from '../components/TranslationSettingsSheet';
import type { MockPost } from '../data/mockData';
import { formatCount, formatTime } from '../data/mockData';
import type { StoryEntry } from '../App';
import { usePostFilterResults } from '../lib/contentFilters/usePostFilterResults';
import { warnMatchReasons } from '../lib/contentFilters/presentation';
import type { WarnMatchReason } from '../lib/contentFilters/presentation';
import { usePlatform, getButtonTokens } from '../hooks/usePlatform';
import { useAppearanceStore } from '../store/appearanceStore';
import {
  useMuteActor,
  useUnmuteActor,
  useBlockActor,
  useUnblockActor,
  usePreferences,
  useAddLabeler,
  useRemoveLabeler,
} from '../lib/atproto/queries';
import { useConversationBatchHydration } from '../conversation/sessionHydration';
import { useTimelineConversationHintsProjection } from '../conversation/sessionSelectors';
import { embeddingPipeline } from '../intelligence/embeddingPipeline';

// ─── Sub-tabs ──────────────────────────────────────────────────────────────
const PROFILE_TABS = ['Posts', 'Library', 'Media', 'Feeds', 'Starter Packs', 'Lists'] as const;
type ProfileTab = typeof PROFILE_TABS[number];
type LibrarySort = 'Newest' | 'Oldest' | 'A-Z' | 'Z-A';
type LibraryCardEntry =
  | { kind: 'warn'; post: MockPost; reasons: WarnMatchReason[] }
  | { kind: 'post'; post: MockPost };

type StarterPackMember = {
  did: string;
  handle?: string;
  avatar?: string;
  following: boolean;
  blocked: boolean;
};

type StarterPackFollowState = {
  inFlight: boolean;
  attempted: number;
  succeeded: number;
  failed: number;
  lastError: string | null;
  optimisticFollowedDids: string[];
};

interface Props {
  onOpenStory: (e: StoryEntry) => void;
  actorDid?: string; // if omitted, shows the signed-in user
}

// ─── URL shortener ─────────────────────────────────────────────────────────
function shortenUrl(raw: string): string {
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const path = u.pathname.replace(/\/$/, '');
    const short = path.length > 20 ? path.slice(0, 18) + '…' : path || '';
    return u.hostname.replace(/^www\./, '') + short;
  } catch {
    return raw.length > 30 ? raw.slice(0, 28) + '…' : raw;
  }
}

function starterPackRkeyFromUri(uri: string | undefined): string {
  const safe = String(uri ?? '').trim();
  if (!safe) return '';
  const parts = safe.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function starterPackTitle(pack: any): string {
  const recordName = String(pack?.record?.name ?? '').trim();
  if (recordName) return recordName;
  const displayName = String(pack?.displayName ?? '').trim();
  if (displayName) return displayName;
  const creatorHandle = String(pack?.creator?.handle ?? '').trim();
  if (creatorHandle) return `${creatorHandle}'s starter pack`;
  return 'Starter Pack';
}

function normalizeDid(input: string): string {
  return input.trim().toLowerCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractStarterPackMembers(pack: any): StarterPackMember[] {
  const rawCandidates = [
    ...(Array.isArray(pack?.listItemsSample) ? pack.listItemsSample : []),
    ...(Array.isArray(pack?.details?.listItemsSample) ? pack.details.listItemsSample : []),
    ...(Array.isArray(pack?.details?.members) ? pack.details.members : []),
  ];
  const out = new Map<string, StarterPackMember>();

  for (const entry of rawCandidates) {
    const subject = entry?.subject ?? entry;
    const did = normalizeDid(String(subject?.did ?? ''));
    if (!did.startsWith('did:')) continue;
    out.set(did, {
      did,
      ...(typeof subject?.handle === 'string' ? { handle: subject.handle } : {}),
      ...(typeof subject?.avatar === 'string' ? { avatar: subject.avatar } : {}),
      following: Boolean(subject?.viewer?.following),
      blocked: Boolean(subject?.viewer?.blocking || subject?.viewer?.blockedBy),
    });
  }

  return [...out.values()];
}

// ─── Bio text (linkified hashtags + URLs) ──────────────────────────────────
const BIO_SEGMENT_RE = /(https?:\/\/[^\s]+|#[\w]+)/g;

function BioText({ text, onHashtagClick }: { text: string; onHashtagClick?: (tag: string) => void }) {
  const segments = useMemo(() => {
    const parts: { key: number; type: 'text' | 'url' | 'tag'; value: string }[] = [];
    let last = 0, match: RegExpExecArray | null, i = 0;
    BIO_SEGMENT_RE.lastIndex = 0;
    while ((match = BIO_SEGMENT_RE.exec(text)) !== null) {
      if (match.index > last) parts.push({ key: i++, type: 'text', value: text.slice(last, match.index) });
      const v = match[0];
      parts.push({ key: i++, type: v.startsWith('#') ? 'tag' : 'url', value: v });
      last = match.index + v.length;
    }
    if (last < text.length) parts.push({ key: i++, type: 'text', value: text.slice(last) });
    return parts;
  }, [text]);

  return (
    <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--label-2)', textAlign: 'center', padding: '10px 24px 0', maxWidth: 340 }}>
      {segments.map(({ key, type, value }) => {
        if (type === 'tag') return (
          <span key={key} onClick={() => onHashtagClick?.(value.slice(1))} style={{ color: 'var(--blue)', fontWeight: 600, cursor: onHashtagClick ? 'pointer' : 'default' }}>{value}</span>
        );
        if (type === 'url') return (
          <a key={key} href={value} target="_blank" rel="noopener noreferrer"
            style={{ color: 'var(--blue)', textDecoration: 'none', borderBottom: '1px solid rgba(0,122,255,0.3)' }}>
            {shortenUrl(value)}
          </a>
        );
        return <React.Fragment key={key}>{value}</React.Fragment>;
      })}
    </p>
  );
}

// ─── Spinner ───────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth={2.5} strokeLinecap="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
        </path>
      </svg>
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────
function EmptyState({ message }: { message: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '56px 24px', gap: 10 }}>
      <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--fill-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--label-3)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <p style={{ fontSize: 14, color: 'var(--label-3)', textAlign: 'center', lineHeight: 1.4 }}>{message}</p>
    </div>
  );
}

// ─── Stats pill ────────────────────────────────────────────────────────────
function StatItem({ count, label }: { count: number; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--label-1)', letterSpacing: -0.5, fontVariantNumeric: 'tabular-nums' }}>
        {formatCount(count)}
      </span>
      <span style={{ fontSize: 12, color: 'var(--label-3)', fontWeight: 500, letterSpacing: 0.1 }}>{label}</span>
    </div>
  );
}

interface FeaturedHashtag {
  name: string;
  statusesCount: number;
  lastStatusAt: string | null;
}

interface FeaturedHashtagCandidate extends FeaturedHashtag {
  rankingScore: number;
}

type FeaturedTagSignal = 'post-facet' | 'post-text' | 'pinned' | 'bio' | 'counterpart' | 'popular';

function formatFeaturedTagLastUsed(isoDate: string | null): string {
  if (!isoDate) return 'No recent post';
  const t = Date.parse(isoDate);
  if (!Number.isFinite(t)) return 'No recent post';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(t));
}

function formatFeaturedTagRelativeLastUsed(isoDate: string | null): string {
  if (!isoDate) return 'No recent post';
  const t = Date.parse(isoDate);
  if (!Number.isFinite(t)) return 'No recent post';

  const deltaMs = Date.now() - t;
  if (deltaMs < 0) return 'Just now';

  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 60) {
    if (minutes <= 1) return 'Just now';
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1h ago' : `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks === 1 ? '1w ago' : `${weeks}w ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? '1mo ago' : `${months}mo ago`;

  const years = Math.floor(days / 365);
  return years === 1 ? '1y ago' : `${years}y ago`;
}

const HASHTAG_RE = /(^|\s)#([a-z0-9_]{2,64})\b/gi;
const WORD_RE = /[a-z0-9_]{2,64}/gi;
const POPULAR_TAG_FALLBACK = [
  'news',
  'tech',
  'sports',
  'music',
  'art',
  'gaming',
  'books',
  'movies',
  'photography',
  'travel',
] as const;

function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#/, '').toLowerCase();
}

function extractHashtagsFromText(text: string): string[] {
  if (!text.trim()) return [];
  const set = new Set<string>();
  HASHTAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HASHTAG_RE.exec(text)) !== null) {
    const tag = normalizeTag(match[2] ?? '');
    if (tag) set.add(tag);
  }
  return [...set];
}

function extractWordsFromText(text: string): Set<string> {
  const out = new Set<string>();
  if (!text.trim()) return out;
  WORD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD_RE.exec(text.toLowerCase())) !== null) {
    const word = match[0]?.trim();
    if (word) out.add(word);
  }
  return out;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (!len) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

function FeaturedHashtagsCard({
  tags,
  onTagClick,
}: {
  tags: FeaturedHashtag[];
  onTagClick: (tag: string) => void;
}) {
  if (tags.length === 0) return null;

  return (
    <div
      style={{
        width: 'calc(100% - 32px)',
        margin: '12px 16px 0',
        border: '1px solid var(--sep)',
        borderRadius: 14,
        background: 'var(--surface)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--sep)' }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--label-3)' }}>
          Featured Hashtags
        </div>
      </div>
      <div style={{ display: 'grid' }}>
        {tags.map((tag, index) => (
          (() => {
            const relativeLastUsed = formatFeaturedTagRelativeLastUsed(tag.lastStatusAt);
            const absoluteLastUsed = formatFeaturedTagLastUsed(tag.lastStatusAt);
            return (
          <button
            key={tag.name}
            onClick={() => onTagClick(tag.name)}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 10,
              textAlign: 'left',
              width: '100%',
              border: 'none',
              borderTop: index === 0 ? 'none' : '1px solid var(--sep)',
              background: 'transparent',
              padding: '10px 12px',
              cursor: 'pointer',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--blue)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                #{tag.name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--label-3)', marginTop: 2 }}>
                {tag.statusesCount} {tag.statusesCount === 1 ? 'post' : 'posts'}
              </div>
            </div>
            <div
              style={{
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: 2,
                maxWidth: '42%',
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--label-2)',
                  whiteSpace: 'nowrap',
                }}
                aria-label={`Last used ${relativeLastUsed}`}
                title={`Last used ${absoluteLastUsed}`}
              >
                {relativeLastUsed}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--label-3)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {absoluteLastUsed}
              </div>
            </div>
          </button>
            );
          })()
        ))}
      </div>
    </div>
  );
}

// ─── Feed row (used in Library) ────────────────────────────────────────────
function FeedRow({ feed, index }: { feed: AppBskyFeedDefs.GeneratorView; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      style={{
        display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12,
        padding: '12px 16px', background: 'var(--surface)', borderRadius: 16,
        marginBottom: 8, boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
      }}
    >
      <div style={{
        width: 48, height: 48, borderRadius: 14, overflow: 'hidden', flexShrink: 0,
        background: 'linear-gradient(135deg, rgba(0,122,255,0.15) 0%, rgba(90,200,250,0.15) 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {feed.avatar
          ? <img src={feed.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 22 }}>⚡</span>
        }
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--label-1)', letterSpacing: -0.3, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {feed.displayName}
        </p>
        <p style={{ fontSize: 12, color: 'var(--label-3)' }}>
          {formatCount(feed.likeCount ?? 0)} likes
          {feed.description ? ` · ${feed.description.slice(0, 48)}` : ''}
        </p>
      </div>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--label-4)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </motion.div>
  );
}

// ─── List row ──────────────────────────────────────────────────────────────
function ListRow({ list, index }: { list: AppBskyGraphDefs.ListView; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      style={{
        display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12,
        padding: '12px 16px', background: 'var(--surface)', borderRadius: 16,
        marginBottom: 8, boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
      }}
    >
      <div style={{
        width: 48, height: 48, borderRadius: 14, overflow: 'hidden', flexShrink: 0,
        background: 'linear-gradient(135deg, rgba(175,82,222,0.15) 0%, rgba(90,200,250,0.12) 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {list.avatar
          ? <img src={list.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        }
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--label-1)', letterSpacing: -0.3, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {list.name}
        </p>
        <p style={{ fontSize: 12, color: 'var(--label-3)' }}>
          {list.listItemCount != null ? `${formatCount(list.listItemCount)} members` : 'List'}
          {list.description ? ` · ${list.description.slice(0, 48)}` : ''}
        </p>
      </div>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--label-4)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </motion.div>
  );
}

function StarterPackRow({
  pack,
  index,
  members,
  followState,
  onFollowAll,
}: {
  pack: any;
  index: number;
  members: StarterPackMember[];
  followState: StarterPackFollowState | undefined;
  onFollowAll: (pack: any) => void;
}) {
  const title = starterPackTitle(pack);
  const creatorHandle = String(pack?.creator?.handle ?? '').trim();
  const listCount = Number(pack?.list?.listItemCount ?? 0);
  const description = String(pack?.record?.description ?? '').trim();
  const rkey = starterPackRkeyFromUri(String(pack?.uri ?? ''));
  const handleOrDid = creatorHandle || String(pack?.creator?.did ?? '').trim();
  const href = handleOrDid && rkey ? `https://bsky.app/start/${handleOrDid}/${rkey}` : '';
  const avatars = members
    .map((member) => member.avatar)
    .filter((avatar): avatar is string => typeof avatar === 'string' && avatar.length > 0)
    .slice(0, 5);
  const optimisticFollowed = new Set(followState?.optimisticFollowedDids ?? []);
  const followedCount = members.filter((member) => member.following || optimisticFollowed.has(member.did)).length;
  const followableMembers = members.filter((member) => {
    if (member.blocked) return false;
    return !member.following && !optimisticFollowed.has(member.did);
  });
  const knownMembers = members.length;
  const totalMembers = listCount > 0 ? listCount : knownMembers;
  const followButtonLabel = followState?.inFlight
    ? `Following ${Math.min(followState.attempted, followableMembers.length)}/${followableMembers.length}`
    : followableMembers.length === 0
      ? 'All followed'
      : `Follow all (${followableMembers.length})`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      style={{
        display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12,
        padding: '12px 16px', background: 'var(--surface)', borderRadius: 16,
        marginBottom: 8, boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', minWidth: 84 }}>
        {avatars.length > 0 ? (
          avatars.map((avatar, avatarIndex) => (
            <img
              key={`${pack?.uri ?? index}:${avatarIndex}`}
              src={avatar}
              alt=""
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                border: '1px solid var(--surface)',
                marginLeft: avatarIndex === 0 ? 0 : -8,
                background: 'var(--fill-1)',
              }}
            />
          ))
        ) : (
          <div style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            background: 'linear-gradient(135deg, rgba(0,122,255,0.16) 0%, rgba(90,200,250,0.12) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--blue)',
            fontWeight: 700,
            fontSize: 12,
          }}>
            PACK
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--label-1)', letterSpacing: -0.3, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </p>
        <p style={{ fontSize: 12, color: 'var(--label-3)', marginBottom: description ? 2 : 0 }}>
          {creatorHandle ? `By @${creatorHandle}` : 'Starter pack'}
          {totalMembers > 0 ? ` · ${formatCount(totalMembers)} members` : ''}
        </p>
        <p style={{ fontSize: 12, color: 'var(--label-3)', marginBottom: description ? 2 : 0 }}>
          Following {formatCount(followedCount)}
          {knownMembers > 0 ? ` of ${formatCount(knownMembers)} loaded` : ''}
        </p>
        {description && (
          <p style={{ fontSize: 12, color: 'var(--label-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {description}
          </p>
        )}
        {!!followState?.lastError && (
          <p style={{ fontSize: 11, color: 'var(--red)', marginTop: 3 }}>
            {followState.lastError}
          </p>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => onFollowAll(pack)}
          disabled={followState?.inFlight || followableMembers.length === 0}
          style={{
            padding: '6px 10px',
            borderRadius: 999,
            border: 'none',
            background: followableMembers.length === 0
              ? 'var(--fill-2)'
              : 'var(--blue)',
            color: followableMembers.length === 0 ? 'var(--label-3)' : '#fff',
            fontSize: 11,
            fontWeight: 700,
            cursor: followState?.inFlight || followableMembers.length === 0 ? 'default' : 'pointer',
            opacity: followState?.inFlight ? 0.72 : 1,
            minWidth: 98,
          }}
        >
          {followButtonLabel}
        </button>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              border: 'none',
              background: 'var(--blue)',
              color: '#fff',
              fontSize: 12,
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            Open
          </a>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--label-4)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        )}
      </div>
    </motion.div>
  );
}

// ─── Media grid ────────────────────────────────────────────────────────────
function MediaGrid({ posts, onOpenStory }: { posts: MockPost[]; onOpenStory: (e: StoryEntry) => void }) {
  const mediaPosts = posts.filter(p => p.media && p.media.length > 0);
  if (mediaPosts.length === 0) return <EmptyState message="No photos or videos yet." />;
  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: '10px 0 14px' }}>
      <style>{`
        .media-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
        }
        .media-card {
          position: relative;
          paddingTop: 100%;
          borderRadius: 12px;
          overflow: hidden;
          cursor: pointer;
          border: 1px solid var(--sep);
          background: var(--fill-1);
          filter: drop-shadow(0 2px 6px rgb(0 0 0 / 5%));
          transition: filter 0.2s ease, transform 0.2s ease;
        }
        .media-card:active {
          filter: drop-shadow(0 4px 12px rgb(0 0 0 / 10%));
          transform: scale(0.99);
        }
        .media-card img {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          objectFit: cover;
          transition: transform 0.3s ease;
        }
        .media-card:active img {
          transform: scale(1.02);
        }
        .media-overlay {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: linear-gradient(to top, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.2) 70%, transparent 100%);
          color: white;
          padding: 16px 12px 12px;
          display: flex;
          flexDirection: column;
          gap: 6px;
        }
        .media-title {
          fontFamily: Iowan Old Style, Georgia, Times New Roman, serif;
          fontSize: 14px;
          lineHeight: 1.28;
          letterSpacing: -0.1px;
          margin: 0;
          display: -webkit-box;
          webkitLineClamp: 2;
          webkitBoxOrient: vertical;
          overflow: hidden;
        }
        .media-byline {
          fontSize: 12px;
          fontWeight: 600;
          opacity: 0.9;
          display: flex;
          alignItems: center;
          gap: 6px;
        }
        .media-dot {
          width: 2px;
          height: 2px;
          borderRadius: 50%;
          background: currentColor;
          opacity: 0.6;
        }
        @media (min-width: 640px) {
          .media-grid { grid-template-columns: repeat(2, 1fr); gap: 14px; }
          .media-title { fontSize: 15px; }
        }
        @media (min-width: 1024px) {
          .media-grid { grid-template-columns: repeat(3, 1fr); gap: 16px; }
          .media-title { fontSize: 15px; }
        }
      `}</style>
      <div className="media-grid">
        {mediaPosts.map((post, i) => {
          const thumbUrl = post.media?.[0]?.url;
          const byline = post.author.displayName || post.author.handle;
          return (
            <motion.button
              key={post.id}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.03 }}
              onClick={() => onOpenStory({ type: 'post', id: post.id, title: post.author.displayName })}
              className="media-card"
              style={{
                position: 'relative',
                paddingTop: '100%',
                borderRadius: 12,
                overflow: 'hidden',
                cursor: 'pointer',
                border: '1px solid var(--sep)',
                background: 'var(--fill-1)',
                filter: 'drop-shadow(0 2px 6px rgb(0 0 0 / 5%))',
              }}
            >
              {thumbUrl ? (
                <img src={thumbUrl} alt={post.media?.[0]?.alt ?? ''} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ position: 'absolute', inset: 0, background: 'var(--fill-2)' }} />
              )}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.2) 70%, transparent 100%)', color: 'white', padding: '16px 12px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <p className="media-title" style={{ margin: 0, fontFamily: 'Iowan Old Style, Georgia, Times New Roman, serif', fontSize: 14, lineHeight: 1.28, letterSpacing: -0.1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {getLibraryStoryTitle(post)}
                </p>
                <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.9, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>{byline}</span>
                  <span style={{ width: 2, height: 2, borderRadius: '50%', background: 'currentColor', opacity: 0.6 }} />
                  <span style={{ flexShrink: 0, fontSize: 11 }}>{formatTime(post.createdAt)}</span>
                  {post.media!.length > 1 && (
                    <>
                      <span style={{ width: 2, height: 2, borderRadius: '50%', background: 'currentColor', opacity: 0.6 }} />
                      <span style={{ flexShrink: 0, fontSize: 11 }}>+{post.media!.length - 1}</span>
                    </>
                  )}
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

function getLibraryStoryTitle(post: MockPost): string {
  if (post.embed?.type === 'external') {
    const title = (post.embed as { title?: string }).title;
    if (title && title.trim().length > 0) return title.trim();
  }
  const text = post.content.trim();
  if (!text) return 'Untitled story';
  return text.length > 84 ? `${text.slice(0, 82)}...` : text;
}

function getLibraryStoryDescription(post: MockPost): string {
  const text = post.content.trim();
  if (!text) return 'No summary available.';
  return text.length > 170 ? `${text.slice(0, 167)}...` : text;
}

function WePresentStoryCard({ post, index, onOpenStory }: { post: MockPost; index: number; onOpenStory: (e: StoryEntry) => void }) {
  const thumbUrl = post.media?.[0]?.url ?? (post.embed?.type === 'external' ? (post.embed as { thumb?: string }).thumb : null);
  const byline = post.author.displayName || post.author.handle;

  return (
    <motion.button
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      onClick={() => onOpenStory({ type: 'post', id: post.id, title: post.author.displayName })}
      className="wepresent-card"
      style={{
        width: '100%',
        textAlign: 'left',
        borderRadius: 14,
        border: '1px solid var(--sep)',
        cursor: 'pointer',
        overflow: 'hidden',
        padding: '12px 14px 12px 12px',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'stretch',
        gap: 14,
        background: 'var(--surface)',
        color: 'var(--label-1)',
      }}
    >
      {/* Thumbnail */}
      <div className="wepresent-card-media" style={{ flexShrink: 0, borderRadius: 8, overflow: 'hidden', background: 'var(--fill-1)' }}>
        {thumbUrl ? (
          <img src={thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', background: 'var(--fill-1)' }} />
        )}
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4 }}>
        <p className="wepresent-card-title" style={{ margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {getLibraryStoryTitle(post)}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--label-2)' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>{byline}</span>
          <span style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: 'currentColor', opacity: 0.45, flexShrink: 0 }} />
          <span style={{ flexShrink: 0 }}>{formatTime(post.createdAt)}</span>
          <span style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: 'currentColor', opacity: 0.45, flexShrink: 0 }} />
          <span style={{ flexShrink: 0 }}>{formatCount(post.likeCount)} likes</span>
        </div>
      </div>
    </motion.button>
  );
}

function WePresentWarningCard({
  post,
  reasons,
  onReveal,
}: {
  post: MockPost;
  reasons: Array<{ phrase: string; reason: 'exact' | 'semantic' | 'exact+semantic' }>;
  onReveal: () => void;
}) {
  return (
    <div
      style={{
        borderRadius: 16,
        border: '1px solid color-mix(in srgb, var(--orange) 38%, #FFFFFF 62%)',
        background: '#FFF4E9',
        color: '#3A2A1B',
        padding: '18px 18px 20px',
        boxShadow: '0 10px 19px rgba(0,0,0,0.04)',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 10 }}>
        Filtered Story
      </div>
      <p style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600 }}>{getLibraryStoryTitle(post)}</p>
      <p style={{ margin: '0 0 10px', fontSize: 12, color: 'rgba(58,42,27,0.82)', fontWeight: 600 }}>
        This story may include words or topics you asked to warn about.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {reasons.map((entry) => (
          <span key={`${entry.phrase}:${entry.reason}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999, border: '1px solid rgba(58,42,27,0.2)', padding: '3px 8px', background: 'rgba(255,255,255,0.75)' }}>
            <span style={{ fontSize: 11, fontWeight: 700 }}>{entry.phrase}</span>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', opacity: 0.72 }}>
              {entry.reason === 'exact+semantic' ? 'exact + semantic' : entry.reason}
            </span>
          </span>
        ))}
      </div>
      <button onClick={onReveal} style={{ border: 'none', background: 'transparent', color: '#7A4200', fontSize: 12, fontWeight: 800, letterSpacing: '0.02em', padding: 0, cursor: 'pointer' }}>
        Show story
      </button>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export default function ProfileTab({ onOpenStory, actorDid }: Props) {
  const { agent, session, profile: sessionProfile } = useSessionStore();
  const { openExploreSearch, openComposeReply, setTab: setAppTab } = useUiStore();
  const translationPolicy = useTranslationStore((state) => state.policy);
  const { showFeaturedHashtags, useMlFeaturedHashtagRanking } = useAppearanceStore();
  const platform = usePlatform();
  const btnTokens = getButtonTokens(platform);
  const touchLike = platform.isMobile || platform.prefersCoarsePointer || platform.hasAnyCoarsePointer;
  const did = actorDid ?? session?.did ?? '';
  const isOwnProfile = !actorDid || actorDid === session?.did;

  const [tab, setTab] = useState<ProfileTab>('Posts');
  const [librarySort, setLibrarySort] = useState<LibrarySort>('Newest');
  const [profile, setProfile] = useState<AppBskyActorDefs.ProfileViewDetailed | null>(
    isOwnProfile ? sessionProfile : null
  );

  // Tab data
  const [posts, setPosts]       = useState<MockPost[]>([]);
  const [likedPosts, setLiked]  = useState<MockPost[]>([]);
  const [pinnedPost, setPinnedPost] = useState<MockPost | null>(null);
  const [pinnedPostLoading, setPinnedPostLoading] = useState(false);
  const [pinnedPostUnavailable, setPinnedPostUnavailable] = useState(false);
  const [feeds, setFeeds]       = useState<AppBskyFeedDefs.GeneratorView[]>([]);
  const [lists, setLists]       = useState<AppBskyGraphDefs.ListView[]>([]);
  const [starterPacks, setStarterPacks] = useState<any[]>([]);
  const [starterPackFollowStateByUri, setStarterPackFollowStateByUri] = useState<Record<string, StarterPackFollowState>>({});
  const [loading, setLoading]   = useState(false);
  const [profileLoading, setProfileLoading] = useState(!isOwnProfile || !sessionProfile);
  const [showTranslationSettings, setShowTranslationSettings] = useState(false);
  const [revealedFilteredPosts, setRevealedFilteredPosts] = useState<Record<string, boolean>>({});
  const [viewerMutedOverride, setViewerMutedOverride] = useState<boolean | null>(null);
  const [viewerBlockedOverride, setViewerBlockedOverride] = useState<boolean | null>(null);
  const [mlFeaturedHashtags, setMlFeaturedHashtags] = useState<FeaturedHashtag[] | null>(null);

  // Derive profile fields early so they are safe to use in memo/effect hooks below.
  const displayName = profile?.displayName ?? profile?.handle ?? session?.handle ?? '';
  const handle = profile?.handle ?? session?.handle ?? '';
  const bio = profile?.description ?? '';
  const followersCount = profile?.followersCount ?? 0;
  const followsCount = profile?.followsCount ?? 0;
  const postsCount = profile?.postsCount ?? 0;
  const isMuted = viewerMutedOverride ?? !!profile?.viewer?.muted;
  const isBlocked = viewerBlockedOverride ?? !!profile?.viewer?.blocking;
  const isLabelerProfile = Boolean((profile as any)?.associated?.labeler);

  const { data: preferencesData } = usePreferences();
  const addLabelerMutation = useAddLabeler();
  const removeLabelerMutation = useRemoveLabeler();
  const isSubscribedToLabeler = useMemo(() => {
    if (!profile?.did) return false;
    const prefs = preferencesData?.moderationPrefs?.labelers ?? [];
    return prefs.some((entry) => entry.did === profile.did);
  }, [preferencesData, profile?.did]);
  const togglingLabelerSubscription = addLabelerMutation.isPending || removeLabelerMutation.isPending;

  const muteActor = useMuteActor();
  const unmuteActor = useUnmuteActor();
  const blockActor = useBlockActor();
  const unblockActor = useUnblockActor();

  const tabBarRef = useRef<HTMLDivElement>(null);

  // Reset content when switching to a different user
  useEffect(() => {
    setPosts([]);
    setLiked([]);
    setPinnedPost(null);
    setPinnedPostLoading(false);
    setPinnedPostUnavailable(false);
    setFeeds([]);
    setLists([]);
    setStarterPacks([]);
    setStarterPackFollowStateByUri({});
    setProfile(isOwnProfile ? sessionProfile : null);
    setTab('Posts');
    setViewerMutedOverride(null);
    setViewerBlockedOverride(null);
  }, [did]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load profile ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!did) return;
    if (isOwnProfile && sessionProfile) { setProfile(sessionProfile); return; }
    setProfileLoading(true);
    atpCall(s => agent.getProfile({ actor: did }))
      .then(res => setProfile(res.data))
      .catch(() => {})
      .finally(() => setProfileLoading(false));
  }, [did, isOwnProfile, sessionProfile, agent]);

  // ── Load pinned post from profile strongRef ─────────────────────────────
  useEffect(() => {
    const pinnedUri = profile?.pinnedPost?.uri;
    if (!did || !pinnedUri) {
      setPinnedPost(null);
      setPinnedPostLoading(false);
      setPinnedPostUnavailable(false);
      return;
    }

    let cancelled = false;
    setPinnedPostLoading(true);
    setPinnedPostUnavailable(false);

    atpCall((s) => agent.getPosts({ uris: [pinnedUri] }))
      .then((res) => {
        if (cancelled) return;
        const post = res.data.posts?.[0];
        if (!post || !hasDisplayableRecordContent((post as any).record)) {
          setPinnedPost(null);
          setPinnedPostUnavailable(true);
          return;
        }
        const mapped = mapFeedViewPost({ post } as AppBskyFeedDefs.FeedViewPost);
        setPinnedPost(mapped);
      })
      .catch(() => {
        if (cancelled) return;
        setPinnedPost(null);
        setPinnedPostUnavailable(true);
      })
      .finally(() => {
        if (cancelled) return;
        setPinnedPostLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [agent, did, profile?.pinnedPost?.uri]);

  // ── Load posts ─────────────────────────────────────────────────────────────
  const loadPosts = useCallback(async () => {
    if (!did) return;
    setLoading(true);
    try {
      const res = await atpCall(s => agent.getAuthorFeed({ actor: did, limit: 30 }));
      setPosts(res.data.feed.filter(i => (i.post.record as any)?.text).map(mapFeedViewPost));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [agent, did]);

  // ── Load liked posts (Library) ─────────────────────────────────────────────
  const loadLiked = useCallback(async () => {
    if (!did) return;
    setLoading(true);
    try {
      const res = await atpCall(s => agent.getActorLikes({ actor: did, limit: 40 }));
      setLiked(res.data.feed.filter(i => (i.post.record as any)?.text).map(mapFeedViewPost));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [agent, did]);

  // ── Load feeds ────────────────────────────────────────────────────────────
  const loadFeeds = useCallback(async () => {
    if (!did) return;
    setLoading(true);
    try {
      const res = await atpCall(s => agent.app.bsky.feed.getActorFeeds({ actor: did, limit: 50 }));
      setFeeds(res.data.feeds);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [agent, did]);

  // ── Load lists ────────────────────────────────────────────────────────────
  const loadLists = useCallback(async () => {
    if (!did) return;
    setLoading(true);
    try {
      const res = await atpCall(s => agent.app.bsky.graph.getLists({ actor: did, limit: 50 }));
      setLists(res.data.lists);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [agent, did]);

  const loadStarterPacks = useCallback(async () => {
    if (!did) return;
    setLoading(true);
    try {
      const res = await atpCall(
        () => (agent.app.bsky.graph as any).getActorStarterPacks({ actor: did, limit: 50 }),
        {
          maxAttempts: 4,
          baseDelayMs: 250,
          capDelayMs: 4_000,
        },
      );
      const rows = Array.isArray(res?.data?.starterPacks) ? res.data.starterPacks : [];
      const enrichedRows = await Promise.all(rows.map(async (pack: any) => {
        const uri = String(pack?.uri ?? '').trim();
        if (!uri) return pack;
        try {
          const detailRes = await atpCall(
            () => (agent.app.bsky.graph as any).getStarterPack({ starterPack: uri }),
            {
              maxAttempts: 3,
              baseDelayMs: 220,
              capDelayMs: 3_500,
            },
          );
          const detailPack = detailRes?.data?.starterPack ?? detailRes?.data ?? null;
          if (!detailPack) return pack;
          return {
            ...pack,
            details: detailPack,
            listItemsSample: Array.isArray(detailPack?.listItemsSample)
              ? detailPack.listItemsSample
              : pack.listItemsSample,
            list: detailPack?.list ?? pack.list,
            record: detailPack?.record ?? pack.record,
          };
        } catch {
          return pack;
        }
      }));
      setStarterPacks(enrichedRows);
    } catch {
      setStarterPacks([]);
    } finally {
      setLoading(false);
    }
  }, [agent, did]);

  const followAllStarterPack = useCallback(async (pack: any) => {
    const packUri = String(pack?.uri ?? '').trim();
    if (!packUri) return;

    setStarterPackFollowStateByUri((previous) => {
      const current = previous[packUri];
      if (current?.inFlight) return previous;
      return previous;
    });

    const members = extractStarterPackMembers(pack);
    const eligible = members.filter((member) => !member.following && !member.blocked);
    if (eligible.length === 0) {
      setStarterPackFollowStateByUri((previous) => ({
        ...previous,
        [packUri]: {
          inFlight: false,
          attempted: 0,
          succeeded: 0,
          failed: 0,
          lastError: null,
          optimisticFollowedDids: previous[packUri]?.optimisticFollowedDids ?? [],
        },
      }));
      return;
    }

    const optimisticFollowedDids = eligible.map((member) => member.did);
    setStarterPackFollowStateByUri((previous) => ({
      ...previous,
      [packUri]: {
        inFlight: true,
        attempted: 0,
        succeeded: 0,
        failed: 0,
        lastError: null,
        optimisticFollowedDids,
      },
    }));

    let attempted = 0;
    let succeeded = 0;
    let failed = 0;

    for (const member of eligible) {
      attempted += 1;
      setStarterPackFollowStateByUri((previous) => {
        const current = previous[packUri];
        if (!current) return previous;
        return {
          ...previous,
          [packUri]: {
            ...current,
            attempted,
          },
        };
      });

      try {
        await atpCall(
          () => agent.follow(member.did),
          {
            maxAttempts: 3,
            baseDelayMs: 250,
            capDelayMs: 4_000,
          },
        );
        succeeded += 1;
      } catch {
        failed += 1;
        setStarterPackFollowStateByUri((previous) => {
          const current = previous[packUri];
          if (!current) return previous;
          return {
            ...previous,
            [packUri]: {
              ...current,
              optimisticFollowedDids: current.optimisticFollowedDids.filter((did) => did !== member.did),
            },
          };
        });
      }

      await sleep(260);
    }

    setStarterPackFollowStateByUri((previous) => {
      const current = previous[packUri];
      if (!current) return previous;
      return {
        ...previous,
        [packUri]: {
          ...current,
          inFlight: false,
          attempted,
          succeeded,
          failed,
          lastError: failed > 0 ? `${failed} follow${failed === 1 ? '' : 's'} failed and were rolled back.` : null,
        },
      };
    });
  }, [agent]);

  useEffect(() => {
    if (tab === 'Posts' || tab === 'Media') loadPosts();
    else if (tab === 'Library') loadLiked();
    else if (tab === 'Feeds') loadFeeds();
    else if (tab === 'Starter Packs') loadStarterPacks();
    else if (tab === 'Lists') loadLists();
  }, [tab, loadPosts, loadLiked, loadFeeds, loadStarterPacks, loadLists]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleToggleRepost = useCallback(async (p: MockPost) => {
    // Similar to HomeTab
  }, [agent, session]);

  const handleToggleLike = useCallback(async (p: MockPost) => {
    // Similar to HomeTab
  }, [agent, session]);

  const handleBookmark = useCallback(async (p: MockPost) => {
    // Placeholder
  }, []);

  const handleMore = useCallback((p: MockPost) => {
    // Placeholder
  }, []);

  // Scroll active sub-tab into view
  const scrollTabIntoView = (idx: number) => {
    const bar = tabBarRef.current;
    if (!bar) return;
    const btn = bar.children[idx] as HTMLElement | undefined;
    btn?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  };

  // ── Render sub-tab content ─────────────────────────────────────────────────
  const profileVisiblePool = useMemo(() => {
    const merged = [...posts, ...likedPosts];
    const byId = new Map<string, MockPost>();
    for (const p of merged) byId.set(p.id, p);
    return [...byId.values()];
  }, [posts, likedPosts]);
  const filterResults = usePostFilterResults(profileVisiblePool, 'profile');
  const featuredHashtags = useMemo<FeaturedHashtagCandidate[]>(() => {
    const byTag = new Map<string, { score: number; statusesCount: number; lastStatusAt: number; signals: Set<FeaturedTagSignal> }>();

    const addSignal = (tag: string, signal: FeaturedTagSignal, timestamp: number, scoreDelta: number, countDelta: number) => {
      const normalized = normalizeTag(tag);
      if (!normalized) return;
      const prev = byTag.get(normalized);
      if (!prev) {
        byTag.set(normalized, {
          score: scoreDelta,
          statusesCount: Math.max(0, countDelta),
          lastStatusAt: timestamp,
          signals: new Set<FeaturedTagSignal>([signal]),
        });
        return;
      }
      prev.score += scoreDelta;
      prev.statusesCount += Math.max(0, countDelta);
      prev.lastStatusAt = Math.max(prev.lastStatusAt, timestamp);
      prev.signals.add(signal);
    };

    for (const post of posts) {
      if (post.author.did !== did) continue;
      const postTags = new Set<string>();

      for (const facet of post.facets ?? []) {
        if (facet.kind !== 'hashtag') continue;
        const rawTag = (facet.tag ?? '').trim().toLowerCase();
        if (!rawTag) continue;
        postTags.add(rawTag);
      }

      for (const rawTag of extractHashtagsFromText(post.content)) {
        postTags.add(rawTag);
      }

      if (postTags.size === 0) continue;
      const ts = Date.parse(post.createdAt);
      const postTime = Number.isFinite(ts) ? ts : 0;

      for (const tag of postTags) {
        const hasFacet = (post.facets ?? []).some((facet) => facet.kind === 'hashtag' && normalizeTag(facet.tag ?? '') === tag);
        addSignal(tag, hasFacet ? 'post-facet' : 'post-text', postTime, hasFacet ? 3.5 : 2.0, 1);
      }
    }

    // Pull explicit and implied tags from bio text so new accounts can still curate profile identity tags.
    const bioText = bio ?? '';
    const bioTags = extractHashtagsFromText(bioText);
    for (const tag of bioTags) {
      addSignal(tag, 'bio', Date.now(), 2.25, 0);
    }

    // Include pinned post signals with a higher boost because they are intentional profile-level content.
    if (pinnedPost) {
      const pinTsParsed = Date.parse(pinnedPost.createdAt);
      const pinTime = Number.isFinite(pinTsParsed) ? pinTsParsed : Date.now();

      for (const facet of pinnedPost.facets ?? []) {
        if (facet.kind !== 'hashtag') continue;
        const tag = normalizeTag(facet.tag ?? '');
        if (!tag) continue;
        addSignal(tag, 'pinned', pinTime, 4.0, 1);
      }

      for (const tag of extractHashtagsFromText(pinnedPost.content)) {
        addSignal(tag, 'pinned', pinTime, 3.0, 1);
      }
    }

    // Plain-text counterpart matching: if words in bio/pinned match known tags, promote them lightly.
    const knownTags = new Set<string>([...byTag.keys()]);
    for (const t of POPULAR_TAG_FALLBACK) knownTags.add(t);

    const counterpartWordSets = [extractWordsFromText(bioText)];
    if (pinnedPost?.content) counterpartWordSets.push(extractWordsFromText(pinnedPost.content));

    for (const words of counterpartWordSets) {
      for (const tag of knownTags) {
        if (!words.has(tag)) continue;
        addSignal(tag, 'counterpart', Date.now(), 1.1, 0);
      }
    }

    // Lightweight popular fallback when account history is sparse.
    if (byTag.size < 3) {
      for (const tag of POPULAR_TAG_FALLBACK) {
        const alreadyStrong = (byTag.get(tag)?.score ?? 0) >= 2;
        if (alreadyStrong) continue;
        addSignal(tag, 'popular', Date.now(), 0.35, 0);
      }
    }

    return [...byTag.entries()]
      .filter(([, data]) => data.score >= 1.5)
      .map(([name, data]) => ({
        name,
        statusesCount: Math.max(1, data.statusesCount),
        lastStatusAt: data.lastStatusAt > 0 ? new Date(data.lastStatusAt).toISOString() : null,
        rankingScore: data.score,
      }))
      .sort((a, b) => {
        if (b.rankingScore !== a.rankingScore) return b.rankingScore - a.rankingScore;
        if (b.statusesCount !== a.statusesCount) return b.statusesCount - a.statusesCount;
        const aTime = a.lastStatusAt ? Date.parse(a.lastStatusAt) : 0;
        const bTime = b.lastStatusAt ? Date.parse(b.lastStatusAt) : 0;
        if (bTime !== aTime) return bTime - aTime;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 12);
  }, [bio, did, pinnedPost, posts]);

  useEffect(() => {
    if (!showFeaturedHashtags || !useMlFeaturedHashtagRanking) {
      setMlFeaturedHashtags(null);
      return;
    }
    if (featuredHashtags.length === 0) {
      setMlFeaturedHashtags([]);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const contextParts = [
          bio ?? '',
          pinnedPost?.content ?? '',
          ...posts.slice(0, 12).map((p) => p.content),
        ].map((s) => s.trim()).filter(Boolean);
        const contextText = contextParts.join('\n').slice(0, 6000);

        if (!contextText) {
          if (!cancelled) {
            setMlFeaturedHashtags(featuredHashtags.slice(0, 10).map(({ name, statusesCount, lastStatusAt }) => ({ name, statusesCount, lastStatusAt })));
          }
          return;
        }

        const [contextEmbedding, tagEmbeddings] = await Promise.all([
          embeddingPipeline.embed(contextText, { mode: 'query' }),
          embeddingPipeline.embedBatch(
            featuredHashtags.map((tag) => `#${tag.name} hashtag topic`),
            { mode: 'query' },
          ),
        ]);

        if (cancelled) return;

        const reranked = featuredHashtags
          .map((tag, idx) => {
            const tagEmbedding = tagEmbeddings[idx] ?? [];
            const similarity = cosineSimilarity(contextEmbedding, tagEmbedding);
            const relevanceScore = ((similarity + 1) / 2) * 100;
            const blended = tag.rankingScore * 0.7 + relevanceScore * 0.3;
            return {
              name: tag.name,
              statusesCount: tag.statusesCount,
              lastStatusAt: tag.lastStatusAt,
              score: blended,
            };
          })
          .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (b.statusesCount !== a.statusesCount) return b.statusesCount - a.statusesCount;
            return a.name.localeCompare(b.name);
          })
          .slice(0, 10)
          .map(({ name, statusesCount, lastStatusAt }) => ({ name, statusesCount, lastStatusAt }));

        setMlFeaturedHashtags(reranked);
      } catch {
        if (!cancelled) {
          // Keep deterministic ranking as fallback when model inference fails.
          setMlFeaturedHashtags(featuredHashtags.slice(0, 10).map(({ name, statusesCount, lastStatusAt }) => ({ name, statusesCount, lastStatusAt })));
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [bio, featuredHashtags, pinnedPost?.content, posts, showFeaturedHashtags, useMlFeaturedHashtagRanking]);

  const featuredHashtagsToRender = useMemo<FeaturedHashtag[]>(() => {
    if (!showFeaturedHashtags) return [];
    if (useMlFeaturedHashtagRanking) {
      if (mlFeaturedHashtags) return mlFeaturedHashtags;
      return featuredHashtags.slice(0, 10).map(({ name, statusesCount, lastStatusAt }) => ({ name, statusesCount, lastStatusAt }));
    }
    return featuredHashtags.slice(0, 10).map(({ name, statusesCount, lastStatusAt }) => ({ name, statusesCount, lastStatusAt }));
  }, [featuredHashtags, mlFeaturedHashtags, showFeaturedHashtags, useMlFeaturedHashtagRanking]);

  const profileSlicePosts = useMemo(() => {
    const candidates = [pinnedPost, ...posts]
      .filter((post): post is MockPost => post != null);
    const seen = new Set<string>();
    return candidates.filter((post) => {
      if (!post.id || seen.has(post.id)) return false;
      seen.add(post.id);
      return true;
    });
  }, [pinnedPost, posts]);

  const profileSliceRootUris = useMemo(
    () => profileSlicePosts.map((post) => post.threadRoot?.id ?? post.id),
    [profileSlicePosts],
  );

  useConversationBatchHydration({
    enabled: Boolean(agent && did && profileSlicePosts.length > 0 && (tab === 'Posts' || tab === 'Media')),
    rootUris: profileSliceRootUris,
    mode: 'profile_slice',
    agent,
    translationPolicy,
    maxTargets: 8,
  });

  const profileTimelineHints = useTimelineConversationHintsProjection(profileSlicePosts);

  function renderContent() {
    if (loading) return <Spinner />;

    switch (tab) {
      case 'Posts':
        {
          const pinnedMatches = pinnedPost ? (filterResults[pinnedPost.id] ?? []) : [];
          const pinnedHidden = pinnedMatches.some((m) => m.action === 'hide');
          const pinnedWarned = pinnedMatches.some((m) => m.action === 'warn');
          const pinnedRevealed = pinnedPost ? !!revealedFilteredPosts[pinnedPost.id] : false;
          const showPinned = !!pinnedPost && !pinnedHidden;

          const timelinePosts = posts.filter((p) => p.id !== pinnedPost?.id);
          const visibleTimelineCount = timelinePosts.filter((p) => !((filterResults[p.id] ?? []).some((m) => m.action === 'hide'))).length;

          if (!showPinned && !pinnedPostUnavailable && !pinnedPostLoading && visibleTimelineCount === 0) {
            return <EmptyState message="No posts yet." />;
          }

          return (
            <>
              {pinnedPostLoading && (
                <div style={{ marginBottom: 10, padding: '10px 12px', borderRadius: 12, background: 'var(--fill-1)', color: 'var(--label-3)', fontSize: 12, fontWeight: 600 }}>
                  Loading pinned post...
                </div>
              )}

              {pinnedPostUnavailable && (
                <div style={{ marginBottom: 10, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--sep)', background: 'var(--surface)' }}>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--label-3)', marginBottom: 6 }}>
                    Pinned Post
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--label-2)', lineHeight: 1.4 }}>
                    This profile has a pinned post, but it is currently unavailable.
                  </div>
                </div>
              )}

              {showPinned && pinnedPost && (
                <div style={{ marginBottom: 10, borderRadius: 12, border: '1px solid color-mix(in srgb, var(--blue) 22%, var(--sep) 78%)', background: 'color-mix(in srgb, var(--surface) 92%, var(--blue) 8%)', overflow: 'hidden' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: '10px 12px 4px', padding: '4px 9px', borderRadius: 999, background: 'color-mix(in srgb, var(--blue) 18%, var(--surface) 82%)', color: 'var(--blue)', fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    <span style={{ fontSize: 10 }}>▲</span>
                    Pinned
                  </div>
                  {pinnedWarned && !pinnedRevealed ? (
                    <div style={{ border: '1px solid var(--sep)', borderRadius: 12, padding: '10px 12px', margin: '0 8px 8px', background: 'color-mix(in srgb, var(--surface) 90%, var(--orange) 10%)' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--label-1)', marginBottom: 4 }}>Content warning</div>
                      <div style={{ fontSize: 11, color: 'var(--label-3)', marginBottom: 8 }}>This pinned post may include words or topics you asked to warn about.</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-2)', marginBottom: 6 }}>Matches filter:</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                        {warnMatchReasons(pinnedMatches).map((entry) => (
                          <span key={`${entry.phrase}:${entry.reason}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999, border: '1px solid var(--sep)', padding: '3px 8px', background: 'var(--fill-1)' }}>
                            <span style={{ fontSize: 11, color: 'var(--label-1)', fontWeight: 700 }}>{entry.phrase}</span>
                            <span style={{ fontSize: 10, color: 'var(--label-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                              {entry.reason === 'exact+semantic' ? 'exact + semantic' : entry.reason}
                            </span>
                          </span>
                        ))}
                      </div>
                      <button onClick={() => setRevealedFilteredPosts((prev) => ({ ...prev, [pinnedPost.id]: true }))} style={{ border: 'none', background: 'transparent', color: 'var(--blue)', fontSize: 12, fontWeight: 700, padding: 0, cursor: 'pointer' }}>
                        Show pinned post
                      </button>
                    </div>
                  ) : (
                    <PostCard
                      key={pinnedPost.id}
                      post={pinnedPost}
                      onOpenStory={onOpenStory}
                      onToggleRepost={handleToggleRepost}
                      onToggleLike={handleToggleLike}
                      onBookmark={handleBookmark}
                      onMore={handleMore}
                      onReply={openComposeReply}
                      index={0}
                      {...(profileTimelineHints[pinnedPost.id] ? { timelineHint: profileTimelineHints[pinnedPost.id] } : {})}
                    />
                  )}
                </div>
              )}

              {timelinePosts.map((p, i) => {
              const matches = filterResults[p.id] ?? [];
              const isHidden = matches.some((m) => m.action === 'hide');
              const isWarned = matches.some((m) => m.action === 'warn');
              const isRevealed = !!revealedFilteredPosts[p.id];
              if (isHidden) return null;
              if (isWarned && !isRevealed) {
                const reasons = warnMatchReasons(matches);
                return (
                  <div key={p.id} style={{ border: '1px solid var(--sep)', borderRadius: 12, padding: '10px 12px', marginBottom: 8, background: 'color-mix(in srgb, var(--surface) 90%, var(--orange) 10%)' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--label-1)', marginBottom: 4 }}>Content warning</div>
                    <div style={{ fontSize: 11, color: 'var(--label-3)', marginBottom: 8 }}>This post may include words or topics you asked to warn about.</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-2)', marginBottom: 6 }}>Matches filter:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                      {reasons.map((entry) => (
                        <span key={`${entry.phrase}:${entry.reason}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999, border: '1px solid var(--sep)', padding: '3px 8px', background: 'var(--fill-1)' }}>
                          <span style={{ fontSize: 11, color: 'var(--label-1)', fontWeight: 700 }}>{entry.phrase}</span>
                          <span style={{ fontSize: 10, color: 'var(--label-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                            {entry.reason === 'exact+semantic' ? 'exact + semantic' : entry.reason}
                          </span>
                        </span>
                      ))}
                    </div>
                    <button onClick={() => setRevealedFilteredPosts((prev) => ({ ...prev, [p.id]: true }))} style={{ border: 'none', background: 'transparent', color: 'var(--blue)', fontSize: 12, fontWeight: 700, padding: 0, cursor: 'pointer' }}>
                      Show post
                    </button>
                  </div>
                );
              }
              return (
                <PostCard
                  key={p.id}
                  post={p}
                  onOpenStory={onOpenStory}
                  onToggleRepost={handleToggleRepost}
                  onToggleLike={handleToggleLike}
                  onBookmark={handleBookmark}
                  onMore={handleMore}
                  onReply={openComposeReply}
                  index={i + (showPinned ? 1 : 0)}
                  {...(profileTimelineHints[p.id] ? { timelineHint: profileTimelineHints[p.id] } : {})}
                />
              );
            })}
            </>
          );
        }

      case 'Library':
        {
          const sorted = [...likedPosts].sort((a, b) => {
            if (librarySort === 'Newest') return Date.parse(b.createdAt) - Date.parse(a.createdAt);
            if (librarySort === 'Oldest') return Date.parse(a.createdAt) - Date.parse(b.createdAt);
            const aTitle = getLibraryStoryTitle(a).toLocaleLowerCase();
            const bTitle = getLibraryStoryTitle(b).toLocaleLowerCase();
            return librarySort === 'A-Z' ? aTitle.localeCompare(bTitle) : bTitle.localeCompare(aTitle);
          });

          const cards: LibraryCardEntry[] = sorted.flatMap((p): LibraryCardEntry[] => {
            const matches = filterResults[p.id] ?? [];
            const isHidden = matches.some((m) => m.action === 'hide');
            const isWarned = matches.some((m) => m.action === 'warn');
            const isRevealed = !!revealedFilteredPosts[p.id];
            if (isHidden) return [];
            if (isWarned && !isRevealed) {
              return [{ kind: 'warn' as const, post: p, reasons: warnMatchReasons(matches) }];
            }
            return [{ kind: 'post' as const, post: p }];
          });

          if (cards.length === 0) return <EmptyState message="Liked posts will appear here." />;

          return (
            <div style={{ maxWidth: 1120, margin: '0 auto', padding: '10px 0 14px' }}>
              <style>{`
                .wepresent-shell {
                  --grid-gap: 8px;
                }
                .wepresent-grid {
                  display: grid;
                  grid-template-columns: 1fr;
                  gap: var(--grid-gap);
                }
                .wepresent-card {
                  filter: drop-shadow(0 2px 6px rgb(0 0 0 / 5%));
                  transition: filter 0.2s ease, transform 0.2s ease;
                }
                .wepresent-card-media {
                  width: 80px;
                  height: 80px;
                }
                .wepresent-card-media img {
                  transition: transform 0.4s ease;
                }
                .wepresent-list-title {
                  font-family: Iowan Old Style, Georgia, Times New Roman, serif;
                  font-size: 26px;
                  line-height: 1.08;
                  letter-spacing: -0.5px;
                }
                .wepresent-card-title {
                  font-family: Iowan Old Style, Georgia, Times New Roman, serif;
                  font-size: 15px;
                  line-height: 1.28;
                  letter-spacing: -0.1px;
                }
                .wepresent-sort {
                  width: 100%;
                  min-height: 44px;
                  border-radius: 12px;
                  border: 1px solid var(--sep);
                  background: var(--surface);
                  color: var(--label-1);
                  padding: 0 12px;
                  font-size: 14px;
                  font-weight: 600;
                }
                .wepresent-card:hover {
                  filter: drop-shadow(0 8px 16px rgb(0 0 0 / 10%));
                  transform: translateY(-1px);
                }
                .wepresent-card:hover .wepresent-card-media img {
                  transform: scale(1.08);
                }
                @media (min-width: 640px) {
                  .wepresent-card-media { width: 88px; height: 88px; }
                  .wepresent-list-title { font-size: 28px; }
                  .wepresent-card-title { font-size: 15px; }
                }
                @media (min-width: 1024px) {
                  .wepresent-shell { --grid-gap: 10px; }
                  .wepresent-card-media { width: 96px; height: 96px; }
                  .wepresent-list-title { font-size: 30px; }
                }
              `}</style>

              <div className="wepresent-shell">
              <div style={{ display: 'flex', flexDirection: platform.isMobile ? 'column' : 'row', alignItems: platform.isMobile ? 'stretch' : 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
                <h2 className="wepresent-list-title" style={{ margin: 0, color: 'var(--label-1)' }}>
                  Story Library
                </h2>
                <div style={{ width: platform.isMobile ? '100%' : 260 }}>
                  <label htmlFor="profile-library-sort" style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--label-3)', marginBottom: 6 }}>
                    Sort
                  </label>
                  <select
                    id="profile-library-sort"
                    value={librarySort}
                    onChange={(e) => setLibrarySort(e.target.value as LibrarySort)}
                    className="wepresent-sort"
                  >
                    <option value="Newest">Newest</option>
                    <option value="Oldest">Oldest</option>
                    <option value="A-Z">A-Z</option>
                    <option value="Z-A">Z-A</option>
                  </select>
                </div>
              </div>

              <div className="wepresent-grid">
                {cards.map((entry, i) => (
                  entry.kind === 'warn'
                    ? (
                      <WePresentWarningCard
                        key={entry.post.id}
                        post={entry.post}
                        reasons={entry.reasons}
                        onReveal={() => setRevealedFilteredPosts((prev) => ({ ...prev, [entry.post.id]: true }))}
                      />
                    )
                    : <WePresentStoryCard key={entry.post.id} post={entry.post} index={i} onOpenStory={onOpenStory} />
                ))}
              </div>
              </div>
            </div>
          );
        }

      case 'Media':
        return <MediaGrid posts={posts.filter((p) => !((filterResults[p.id] ?? []).some((m) => m.action === 'hide')))} onOpenStory={onOpenStory} />;

      case 'Feeds':
        return feeds.length === 0
          ? <EmptyState message="No feeds created yet." />
          : feeds.map((f, i) => <FeedRow key={f.uri} feed={f} index={i} />);

      case 'Starter Packs':
        return starterPacks.length === 0
          ? <EmptyState message="No starter packs yet." />
          : starterPacks.map((pack, index) => (
              <StarterPackRow
                key={String(pack?.uri ?? `starter-pack-${index}`)}
                pack={pack}
                index={index}
                members={extractStarterPackMembers(pack)}
                followState={starterPackFollowStateByUri[String(pack?.uri ?? '')]}
                onFollowAll={followAllStarterPack}
              />
            ));

      case 'Lists':
        return lists.length === 0
          ? <EmptyState message="No lists yet." />
          : lists.map((l, i) => <ListRow key={l.uri} list={l} index={i} />);

      default:
        return null;
    }
  }

  function handleToggleMute() {
    if (!did || isOwnProfile) return;
    if (isMuted) {
      unmuteActor.mutate(
        { did },
        {
          onSuccess: () => setViewerMutedOverride(false),
        },
      );
      return;
    }
    muteActor.mutate(
      { did, durationMs: null },
      {
        onSuccess: () => setViewerMutedOverride(true),
      },
    );
  }

  function handleToggleBlock() {
    if (!did || isOwnProfile) return;
    if (isBlocked) {
      unblockActor.mutate(
        { did },
        {
          onSuccess: () => setViewerBlockedOverride(false),
        },
      );
      return;
    }
    blockActor.mutate(
      { did },
      {
        onSuccess: () => setViewerBlockedOverride(true),
      },
    );
  }

  function handleToggleLabelerSubscription() {
    if (!profile?.did || !isLabelerProfile) return;
    if (isSubscribedToLabeler) {
      removeLabelerMutation.mutate({ did: profile.did });
      return;
    }
    addLabelerMutation.mutate({ did: profile.did });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>

      {/* ── Nav bar ───────────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        paddingTop: 'var(--safe-top)',
        background: 'transparent',
        zIndex: 10,
      }}>
        <div style={{
          display: 'flex', flexDirection: 'row', alignItems: 'center',
          padding: '12px 16px 10px', minHeight: 44,
        }}>
          {/* Left — empty or back button */}
          <div style={{ width: 36, flexShrink: 0 }}>
            {!isOwnProfile && (
              <button onClick={() => setAppTab('home')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--blue)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
              </button>
            )}
          </div>

          {/* Center — handle */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--label-1)', letterSpacing: -0.3 }}>
              {handle ? `@${handle.replace('.bsky.social', '')}` : 'Profile'}
            </span>
          </div>

          {/* Right — settings */}
          <div style={{ width: 36, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              aria-label="Settings"
              onClick={() => setShowTranslationSettings(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--label-2)' }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── Scrollable body ───────────────────────────────────────────────── */}
      <div className="scroll-y" style={{ flex: 1 }}>

        {/* ── Profile header ──────────────────────────────────────────────── */}
        {profileLoading ? (
          <Spinner />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
            style={{ background: 'var(--surface)', paddingBottom: 0 }}
          >
            {/* ── Banner ── */}
            <div style={{ position: 'relative', width: '100%', height: 130, background: 'var(--fill-3)', overflow: 'hidden' }}>
              {profile?.banner
                ? <img src={profile.banner} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                : <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, var(--blue) 0%, var(--indigo) 60%, rgba(90,200,250,0.6) 100%)' }} />
              }
            </div>

            {/* Banner / avatar area */}
            <div style={{ position: 'relative', paddingTop: 0, paddingBottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

              {/* Avatar — overlaps banner */}
              <div style={{
                width: 80, height: 80, borderRadius: '50%',
                overflow: 'hidden', background: 'var(--fill-2)',
                border: '3.5px solid var(--surface)',
                boxShadow: '0 4px 18px rgba(0,0,0,0.18)',
                flexShrink: 0,
                marginTop: -40, marginBottom: 10,
                position: 'relative', zIndex: 2,
              }}>
                {profile?.avatar
                  ? <img src={profile.avatar} alt={displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : (
                    <div style={{
                      width: '100%', height: '100%', display: 'flex', alignItems: 'center',
                      justifyContent: 'center',
                      background: 'linear-gradient(135deg, var(--blue) 0%, var(--indigo) 100%)',
                      color: '#fff', fontSize: 30, fontWeight: 700,
                    }}>
                      {displayName[0]?.toUpperCase() ?? '?'}
                    </div>
                  )
                }
                
                {/* Live badge */}
                {(profile as any)?.status?.["com.atproto.server#userStatus"]?.status === 'LIVE' && (
                  <div style={{
                    position: 'absolute', bottom: 0, right: 0,
                    width: 28, height: 28,
                    background: '#FF0000', borderRadius: '50%',
                    border: '2.5px solid white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, color: 'white',
                  }}>
                    ●
                  </div>
                )}
              </div>

              {/* Name */}
              <h1 style={{
                fontSize: 22, fontWeight: 800, color: 'var(--label-1)',
                letterSpacing: -0.6, margin: 0, lineHeight: 1.15,
              }}>
                {displayName}
              </h1>

              {/* Handle */}
              <p style={{ fontSize: 14, color: 'var(--label-3)', marginTop: 3, fontWeight: 500 }}>
                @{handle.replace('.bsky.social', '')}
              </p>
              {isLabelerProfile && (
                <div style={{ marginTop: 6 }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    borderRadius: 999,
                    padding: '4px 10px',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.03em',
                    textTransform: 'uppercase',
                    color: 'var(--blue)',
                    background: 'color-mix(in srgb, var(--blue) 14%, var(--fill-2))',
                  }}>
                    Labeler
                  </span>
                </div>
              )}

              {/* Bio — linkified */}
              {bio && <BioText text={bio} onHashtagClick={tag => openExploreSearch(tag)} />}

              {showFeaturedHashtags && (
                <FeaturedHashtagsCard tags={featuredHashtagsToRender} onTagClick={(tag) => openExploreSearch(tag)} />
              )}

              {/* Stats row */}
              <div style={{
                display: 'flex', flexDirection: 'row', alignItems: 'center',
                gap: 0, marginTop: 18, width: '100%',
                borderTop: '0.5px solid var(--sep)', borderBottom: '0.5px solid var(--sep)',
              }}>
                {[
                  { count: postsCount, label: 'Posts' },
                  { count: followsCount, label: 'Following' },
                  { count: followersCount, label: 'Followers' },
                ].map((stat, i, arr) => (
                  <React.Fragment key={stat.label}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '14px 0' }}>
                      <StatItem count={stat.count} label={stat.label} />
                    </div>
                    {i < arr.length - 1 && (
                      <div style={{ width: 0.5, height: 32, background: 'var(--sep)' }} />
                    )}
                  </React.Fragment>
                ))}
              </div>

              {/* Action buttons */}
              <div style={{
                display: 'flex', flexDirection: 'row', gap: 10,
                flexWrap: !isOwnProfile && touchLike ? 'wrap' : 'nowrap',
                padding: `${platform.isMobile ? 16 : 14}px 16px`,
                width: '100%', boxSizing: 'border-box',
              }}>
                {isOwnProfile ? (
                  <>
                    <button style={{
                      flex: 1,
                      height: btnTokens.height,
                      borderRadius: btnTokens.borderRadius,
                      background: 'var(--fill-2)',
                      border: 'none', cursor: 'pointer',
                      fontSize: btnTokens.fontSize,
                      fontWeight: btnTokens.fontWeight,
                      color: 'var(--label-1)',
                      letterSpacing: -0.2,
                      WebkitTapHighlightColor: 'transparent',
                      transition: 'opacity 0.12s',
                    }}>
                      Edit Profile
                    </button>
                    <button style={{
                      flex: 1,
                      height: btnTokens.height,
                      borderRadius: btnTokens.borderRadius,
                      background: 'var(--fill-2)',
                      border: 'none', cursor: 'pointer',
                      fontSize: btnTokens.fontSize,
                      fontWeight: btnTokens.fontWeight,
                      color: 'var(--label-1)',
                      letterSpacing: -0.2,
                      WebkitTapHighlightColor: 'transparent',
                      transition: 'opacity 0.12s',
                    }}>
                      Share Profile
                    </button>
                  </>
                ) : (
                  <>
                    <button style={{
                      flex: 1,
                      minWidth: !isOwnProfile && touchLike ? 'calc(50% - 5px)' : undefined,
                      height: btnTokens.height,
                      borderRadius: btnTokens.borderRadius,
                      background: 'var(--blue)',
                      border: 'none', cursor: 'pointer',
                      fontSize: btnTokens.fontSize,
                      fontWeight: btnTokens.fontWeight,
                      color: '#fff',
                      letterSpacing: -0.2,
                      WebkitTapHighlightColor: 'transparent',
                      transition: 'opacity 0.12s',
                    }}>
                      Follow
                    </button>
                    {isLabelerProfile && (
                      <button
                        onClick={handleToggleLabelerSubscription}
                        disabled={togglingLabelerSubscription}
                        style={{
                          flex: 1,
                          minWidth: !isOwnProfile && touchLike ? 'calc(50% - 5px)' : undefined,
                          height: btnTokens.height,
                          borderRadius: btnTokens.borderRadius,
                          background: isSubscribedToLabeler ? 'color-mix(in srgb, var(--blue) 14%, var(--fill-2))' : 'var(--blue)',
                          border: 'none', cursor: 'pointer',
                          fontSize: btnTokens.fontSize,
                          fontWeight: btnTokens.fontWeight,
                          color: isSubscribedToLabeler ? 'var(--blue)' : '#fff',
                          letterSpacing: -0.2,
                          WebkitTapHighlightColor: 'transparent',
                          transition: 'opacity 0.12s',
                          opacity: togglingLabelerSubscription ? 0.65 : 1,
                        }}
                      >
                        {isSubscribedToLabeler ? 'Unsubscribe Labeler' : 'Subscribe Labeler'}
                      </button>
                    )}
                    <button style={{
                      flex: 1,
                      minWidth: !isOwnProfile && touchLike ? 'calc(50% - 5px)' : undefined,
                      height: btnTokens.height,
                      borderRadius: btnTokens.borderRadius,
                      background: 'var(--fill-2)',
                      border: 'none', cursor: 'pointer',
                      fontSize: btnTokens.fontSize,
                      fontWeight: btnTokens.fontWeight,
                      color: 'var(--label-1)',
                      letterSpacing: -0.2,
                      WebkitTapHighlightColor: 'transparent',
                      transition: 'opacity 0.12s',
                      opacity: muteActor.isPending || unmuteActor.isPending ? 0.65 : 1,
                    }}>
                      Message
                    </button>
                    <button
                      onClick={handleToggleMute}
                      disabled={muteActor.isPending || unmuteActor.isPending}
                      style={{
                        flex: 1,
                        minWidth: !isOwnProfile && touchLike ? 'calc(50% - 5px)' : undefined,
                        height: btnTokens.height,
                        borderRadius: btnTokens.borderRadius,
                        background: isMuted ? 'color-mix(in srgb, var(--orange) 18%, var(--fill-2))' : 'var(--fill-2)',
                        border: 'none', cursor: 'pointer',
                        fontSize: btnTokens.fontSize,
                        fontWeight: btnTokens.fontWeight,
                        color: isMuted ? 'var(--orange)' : 'var(--label-1)',
                        letterSpacing: -0.2,
                        WebkitTapHighlightColor: 'transparent',
                        transition: 'opacity 0.12s',
                        opacity: muteActor.isPending || unmuteActor.isPending ? 0.65 : 1,
                      }}
                    >
                      {isMuted ? 'Unmute' : 'Mute'}
                    </button>
                    <button
                      onClick={handleToggleBlock}
                      disabled={blockActor.isPending || unblockActor.isPending}
                      style={{
                        flex: 1,
                        minWidth: !isOwnProfile && touchLike ? 'calc(50% - 5px)' : undefined,
                        height: btnTokens.height,
                        borderRadius: btnTokens.borderRadius,
                        background: isBlocked ? 'color-mix(in srgb, var(--red) 18%, var(--fill-2))' : 'var(--fill-2)',
                        border: 'none', cursor: 'pointer',
                        fontSize: btnTokens.fontSize,
                        fontWeight: btnTokens.fontWeight,
                        color: isBlocked ? 'var(--red)' : 'var(--label-1)',
                        letterSpacing: -0.2,
                        WebkitTapHighlightColor: 'transparent',
                        transition: 'opacity 0.12s',
                        opacity: blockActor.isPending || unblockActor.isPending ? 0.65 : 1,
                      }}
                    >
                      {isBlocked ? 'Unblock' : 'Block'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Sub-tab bar ─────────────────────────────────────────────────── */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 8,
          background: 'var(--chrome-bg)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          borderBottom: '0.5px solid var(--sep)',
        }}>
          <div
            ref={tabBarRef}
            style={{
              display: 'flex', flexDirection: 'row',
              overflowX: 'auto', scrollbarWidth: 'none',
              padding: '0 4px',
              WebkitOverflowScrolling: 'touch' as any,
            }}
          >
            {PROFILE_TABS.map((t, i) => {
              const active = tab === t;
              return (
                <button
                  key={t}
                  onClick={() => { setTab(t); scrollTabIntoView(i); }}
                  style={{
                    flexShrink: 0,
                    minHeight: touchLike ? 44 : 40,
                    padding: touchLike ? '14px 16px 12px' : '13px 14px 11px',
                    border: 'none', background: 'none', cursor: 'pointer',
                    fontSize: touchLike ? 15 : 14,
                    fontWeight: active ? 700 : 500,
                    color: active ? 'var(--blue)' : 'var(--label-3)',
                    letterSpacing: -0.2,
                    position: 'relative',
                    transition: 'color 0.15s',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  {t}
                  {active && (
                    <motion.div
                      layoutId="profile-tab-indicator"
                      style={{
                        position: 'absolute', bottom: 0, left: 10, right: 10,
                        height: 2, borderRadius: 2, background: 'var(--blue)',
                      }}
                      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Tab content ─────────────────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
            style={{
              padding: tab === 'Media' ? '2px 12px 0' : '12px 12px 0',
            }}
          >
            {renderContent()}
          </motion.div>
        </AnimatePresence>

        {/* Safe area bottom padding */}
        <div style={{ height: 32 }} />
      </div>

      <TranslationSettingsSheet open={showTranslationSettings} onClose={() => setShowTranslationSettings(false)} />
    </div>
  );
}
