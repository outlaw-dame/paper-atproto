import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSessionStore } from '../store/sessionStore';
import { useUiStore } from '../store/uiStore';
import { useActivityStore } from '../store/activityStore';
import { atpCall } from '../lib/atproto/client';
import { mapNotification } from '../atproto/mappers';
import { formatTime } from '../data/mockData';

const NOTIF_CONFIG: Record<string, { symbol: string; color: string; bg: string }> = {
  like: { symbol: '♥', color: 'var(--red)', bg: 'rgba(255,69,58,0.12)' },
  repost: { symbol: '↺', color: 'var(--green)', bg: 'rgba(48,209,88,0.12)' },
  reply: { symbol: '↩', color: 'var(--blue)', bg: 'rgba(10,132,255,0.12)' },
  follow: { symbol: '+', color: 'var(--purple)', bg: 'rgba(191,90,242,0.12)' },
  mention: { symbol: '@', color: 'var(--orange)', bg: 'rgba(255,159,10,0.12)' },
  quote: { symbol: '"', color: 'var(--teal)', bg: 'rgba(90,200,250,0.12)' },
  app: { symbol: '•', color: 'var(--indigo)', bg: 'rgba(88,86,214,0.12)' },
};

const DEFAULT_NOTIF_CONFIG = { symbol: '•', color: 'var(--indigo)', bg: 'rgba(88,86,214,0.12)' };

const FILTERS = ['All', 'Mentions', 'Likes', 'Follows', 'App'] as const;
type Filter = typeof FILTERS[number];

type ActivityType = 'like' | 'repost' | 'reply' | 'follow' | 'mention' | 'quote' | 'app';

type ActivityNotification = {
  id: string;
  type: ActivityType;
  displayName: string;
  avatar?: string;
  content: string;
  time: string;
  read: boolean;
  subjectUri?: string;
  subjectSnippet?: string;
};

function normalizeReason(rawReason: string): ActivityType {
  const value = rawReason.toLowerCase();
  if (value.startsWith('like')) return 'like';
  if (value.startsWith('repost')) return 'repost';
  if (value.startsWith('reply')) return 'reply';
  if (value.startsWith('follow')) return 'follow';
  if (value.startsWith('mention')) return 'mention';
  if (value.startsWith('quote')) return 'quote';
  return 'app';
}

function inferTargetNoun(reason: string, subjectUri?: string): 'post' | 'repost' {
  const lower = reason.toLowerCase();
  if (lower.includes('repost')) return 'repost';
  if ((subjectUri || '').includes('/app.bsky.feed.repost/')) return 'repost';
  return 'post';
}

function toReasonText(reason: string, subjectUri?: string): string {
  const normalized = normalizeReason(reason);
  const target = inferTargetNoun(reason, subjectUri);

  switch (normalized) {
    case 'follow':
      return 'followed you';
    case 'like':
      return `liked your ${target}`;
    case 'repost':
      return `reposted your ${target}`;
    case 'reply':
      return `replied to your ${target}`;
    case 'mention':
      return 'mentioned you';
    case 'quote':
      return `quoted your ${target}`;
    default:
      return `sent ${reason} activity`;
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function extractSubjectText(record: any): string {
  const fromSimple = record?.text || record?.body || record?.content || record?.description;
  if (typeof fromSimple === 'string' && fromSimple.trim()) return fromSimple.trim();

  if (Array.isArray(record?.facets) && typeof record?.text === 'string') {
    return record.text.trim();
  }

  return '';
}

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth={2.5} strokeLinecap="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
        </path>
      </svg>
    </div>
  );
}

export default function ActivityTab() {
  const { agent, session } = useSessionStore();
  const setUnreadCount = useUiStore((state) => state.setUnreadCount);
  const appNotifications = useActivityStore((state) => state.appNotifications);
  const markAllAppRead = useActivityStore((state) => state.markAllAppRead);

  const [filter, setFilter] = useState<Filter>('All');
  const [notifications, setNotifications] = useState<ActivityNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);

    try {
      const res = await atpCall((s) => agent.listNotifications({ limit: 50 }));
      const mapped = res.data.notifications.map(mapNotification);

      const postSubjectUris = Array.from(
        new Set(
          mapped
            .map((n) => n.subjectUri)
            .filter((uri): uri is string => Boolean(uri && uri.includes('/app.bsky.feed.post/'))),
        ),
      );

      const subjectTextByUri = new Map<string, string>();
      const chunks = chunkArray(postSubjectUris, 25);
      for (const uris of chunks) {
        try {
          const postsRes = await atpCall((s) => agent.getPosts({ uris }));
          for (const post of postsRes.data.posts) {
            const text = extractSubjectText(post.record);
            if (text) subjectTextByUri.set(post.uri, text);
          }
        } catch {
          // Ignore per-chunk subject lookup failures.
        }
      }

      const atpNotifications: ActivityNotification[] = mapped.map((n) => {
        const type = normalizeReason(n.reason);
        const subjectSnippet = n.subjectUri ? subjectTextByUri.get(n.subjectUri) : undefined;
        return {
          id: n.uri,
          type,
          displayName: n.author.displayName,
          ...(n.author.avatar ? { avatar: n.author.avatar } : {}),
          content: toReasonText(n.reason, n.subjectUri),
          time: n.indexedAt,
          read: n.isRead,
          ...(n.subjectUri ? { subjectUri: n.subjectUri } : {}),
          ...(subjectSnippet ? { subjectSnippet } : {}),
        };
      });

      const appItems: ActivityNotification[] = appNotifications.map((n) => ({
        id: n.id,
        type: 'app',
        displayName: n.title,
        content: n.message,
        time: n.createdAt,
        read: n.read,
      }));

      const merged = [...atpNotifications, ...appItems].sort(
        (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime(),
      );

      setNotifications(merged);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [agent, appNotifications, session]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    setUnreadCount(notifications.filter((item) => !item.read).length);
  }, [notifications, setUnreadCount]);

  const markAllRead = useCallback(async () => {
    if (!session) return;
    try {
      await atpCall((s) => agent.updateSeenNotifications());
      markAllAppRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      // Ignore mark-read failure and keep the current state.
    }
  }, [agent, markAllAppRead, session]);

  const filtered = notifications.filter((n) => {
    if (filter === 'All') return true;
    if (filter === 'Mentions') return n.type === 'mention' || n.type === 'reply';
    if (filter === 'Likes') return n.type === 'like';
    if (filter === 'Follows') return n.type === 'follow';
    if (filter === 'App') return n.type === 'app';
    return true;
  });

  const newItems = filtered.filter((n) => !n.read);
  const oldItems = filtered.filter((n) => n.read);
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      <div
        style={{
          flexShrink: 0,
          paddingTop: 'calc(var(--safe-top) + 12px)',
          background: 'transparent',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', padding: '0 16px 10px', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <span
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--type-ui-headline-md-size)',
                lineHeight: 'var(--type-ui-headline-md-line)',
                fontWeight: 'var(--type-ui-headline-md-weight)',
                letterSpacing: 'var(--type-ui-headline-md-track)',
                color: 'var(--label-1)',
              }}
            >
              Activity
            </span>
            {unreadCount > 0 && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 20,
                  height: 20,
                  padding: '0 6px',
                  borderRadius: 100,
                  background: 'var(--blue)',
                  color: '#fff',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--type-meta-sm-size)',
                  fontWeight: 700,
                  letterSpacing: 'var(--type-meta-sm-track)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {unreadCount}
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--type-label-md-size)',
                lineHeight: 'var(--type-label-md-line)',
                fontWeight: 600,
                letterSpacing: 'var(--type-label-md-track)',
                color: 'var(--blue)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Mark all read
            </button>
          )}
          <button onClick={fetchNotifications} style={{ color: 'var(--label-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'row', padding: '0 16px 12px', gap: 8 }}>
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '6px 14px',
                borderRadius: 100,
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--type-label-md-size)',
                lineHeight: 'var(--type-label-md-line)',
                fontWeight: filter === f ? 600 : 400,
                letterSpacing: 'var(--type-label-md-track)',
                color: filter === f ? '#fff' : 'var(--label-2)',
                background: filter === f ? 'var(--blue)' : 'var(--fill-2)',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="scroll-y" style={{ flex: 1 }}>
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Spinner />
            </motion.div>
          ) : error ? (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ padding: '32px 16px', textAlign: 'center' }}>
              <p
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--type-body-sm-size)',
                  lineHeight: 'var(--type-body-sm-line)',
                  fontWeight: 'var(--type-body-sm-weight)',
                  letterSpacing: 'var(--type-body-sm-track)',
                  color: 'var(--red)',
                  marginBottom: 12,
                }}
              >
                {error}
              </p>
              <button
                onClick={fetchNotifications}
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--type-label-md-size)',
                  lineHeight: 'var(--type-label-md-line)',
                  fontWeight: 600,
                  letterSpacing: 'var(--type-label-md-track)',
                  color: 'var(--blue)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Try again
              </button>
            </motion.div>
          ) : filtered.length === 0 ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 24px', gap: 12 }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--fill-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--label-3)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 01-3.46 0" />
                </svg>
              </div>
              <p
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--type-body-sm-size)',
                  lineHeight: 'var(--type-body-sm-line)',
                  fontWeight: 'var(--type-body-sm-weight)',
                  letterSpacing: 'var(--type-body-sm-track)',
                  color: 'var(--label-3)',
                }}
              >
                No notifications yet
              </p>
            </motion.div>
          ) : (
            <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {newItems.length > 0 && (
                <>
                  <p style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--label-3)', padding: '16px 16px 8px' }}>
                    New
                  </p>
                  <div style={{ background: 'var(--surface)', borderRadius: 16, margin: '0 12px 8px', overflow: 'hidden' }}>
                    {newItems.map((n, i) => (
                      <NotifRow key={n.id} n={n} index={i} last={i === newItems.length - 1} />
                    ))}
                  </div>
                </>
              )}
              {oldItems.length > 0 && (
                <>
                  <p style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--label-3)', padding: '16px 16px 8px' }}>
                    Earlier
                  </p>
                  <div style={{ background: 'var(--surface)', borderRadius: 16, margin: '0 12px 8px', overflow: 'hidden' }}>
                    {oldItems.map((n, i) => (
                      <NotifRow key={n.id} n={n} index={i} last={i === oldItems.length - 1} />
                    ))}
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

function NotifRow({ n, index, last }: { n: ActivityNotification; index: number; last: boolean }) {
  const cfg = NOTIF_CONFIG[n.type] ?? DEFAULT_NOTIF_CONFIG;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        padding: '12px 16px',
        borderBottom: last ? 'none' : '0.5px solid color-mix(in srgb, var(--sep) 35%, transparent)',
        background: n.read ? 'none' : 'rgba(0,122,255,0.04)',
      }}
    >
      <div style={{ position: 'relative' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', background: 'var(--fill-2)' }}>
          {n.avatar ? (
            <img src={n.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: cfg.bg,
                color: cfg.color,
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--type-label-lg-size)',
                fontWeight: 700,
              }}
            >
              {n.displayName[0]}
            </div>
          )}
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: -2,
            right: -2,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: cfg.bg,
            color: cfg.color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--type-meta-sm-size)',
            fontWeight: 700,
            border: '1.5px solid var(--surface)',
          }}
        >
          {cfg.symbol}
        </div>
      </div>

      <div style={{ marginTop: 8, width: '100%' }}>
        <p
          style={{
            margin: 0,
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--type-body-sm-size)',
            lineHeight: 'var(--type-body-sm-line)',
            fontWeight: 'var(--type-body-sm-weight)',
            letterSpacing: 'var(--type-body-sm-track)',
            color: 'var(--label-1)',
          }}
        >
          <strong>{n.displayName}</strong> {n.content}.{' '}
          <span style={{ color: 'var(--label-3)', fontVariantNumeric: 'tabular-nums' }}>{formatTime(n.time)}</span>
        </p>

        {n.subjectSnippet && (
          <div
            style={{
              marginTop: 8,
              borderRadius: 12,
              border: '0.5px solid color-mix(in srgb, var(--sep) 45%, transparent)',
              background: 'var(--fill-1)',
              padding: '8px 10px',
            }}
          >
            <p
              style={{
                margin: 0,
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--type-meta-sm-size)',
                lineHeight: 'var(--type-body-sm-line)',
                fontWeight: 500,
                letterSpacing: 'var(--type-meta-sm-track)',
                color: 'var(--label-2)',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {n.subjectSnippet}
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
