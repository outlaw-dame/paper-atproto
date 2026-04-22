import React, { useState, useCallback } from 'react';
import type { ProfileCardData, CompactPostPreview, StarterPackRef } from '../types/profileCard';

// ─── Inject keyframes once ────────────────────────────────────────────────────
let keyframesInjected = false;
function ensureKeyframes() {
  if (keyframesInjected) return;
  keyframesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes profileCardIn {
      from { opacity: 0; transform: translateY(6px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes profileCardFlipFront {
      from { transform: perspective(900px) rotateY(-90deg); opacity: 0; }
      to   { transform: perspective(900px) rotateY(0deg);  opacity: 1; }
    }
    @keyframes profileCardFlipBack {
      from { transform: perspective(900px) rotateY(90deg); opacity: 0; }
      to   { transform: perspective(900px) rotateY(0deg);  opacity: 1; }
    }
    .profile-card-face {
      animation-duration: 0.22s;
      animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
      animation-fill-mode: both;
    }
    .profile-card-face--front { animation-name: profileCardFlipFront; }
    .profile-card-face--back  { animation-name: profileCardFlipBack;  }
  `;
  document.head.appendChild(style);
}

// ─── Constants ────────────────────────────────────────────────────────────────
const CARD_WIDTH = 308;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Avatar({ src, handle, size = 64 }: { src?: string | undefined; handle: string; size?: number | undefined }) {
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: '50%',
      overflow: 'hidden',
      flexShrink: 0,
      background: 'var(--fill-2)',
      border: '2px solid rgba(255,255,255,0.10)',
      boxShadow: '0 0 0 1px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.18)',
    }}>
      {src ? (
        <img
          src={src}
          alt={handle}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          referrerPolicy="no-referrer"
          decoding="async"
        />
      ) : (
        <div style={{
          width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: size * 0.38, fontWeight: 700, color: 'var(--label-2)',
          userSelect: 'none',
        }}>
          {handle[0]?.toUpperCase() ?? '?'}
        </div>
      )}
    </div>
  );
}

function Banner({ src, height = 64 }: { src?: string | undefined; height?: number | undefined }) {
  if (!src) return null;
  return (
    <div style={{
      width: '100%', height, overflow: 'hidden',
      borderRadius: '16px 16px 0 0',
      position: 'relative',
    }}>
      <img
        src={src}
        alt=""
        style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top', display: 'block' }}
        referrerPolicy="no-referrer"
        decoding="async"
      />
      {/* gradient scrim so content below reads cleanly */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.45))',
        pointerEvents: 'none',
      }} />
    </div>
  );
}

function FollowButton({ isFollowing, canFollow, onFollow }: {
  isFollowing: boolean;
  canFollow: boolean;
  onFollow?: (() => void) | undefined;
}) {
  if (!canFollow && !isFollowing) return null;

  if (isFollowing) {
    return (
      <button
        onClick={onFollow}
        style={{
          height: 28, padding: '0 12px',
          borderRadius: 999, border: '1px solid var(--sep-opaque)',
          background: 'transparent', color: 'var(--label-2)',
          fontSize: 12, fontWeight: 600, cursor: 'pointer',
          whiteSpace: 'nowrap', flexShrink: 0,
          transition: 'opacity 0.14s ease',
        }}
      >
        Following
      </button>
    );
  }

  return (
    <button
      onClick={onFollow}
      style={{
        height: 28, padding: '0 14px',
        borderRadius: 999, border: 'none',
        background: 'var(--blue)', color: '#fff',
        fontSize: 12, fontWeight: 700, cursor: 'pointer',
        whiteSpace: 'nowrap', flexShrink: 0,
        boxShadow: '0 1px 4px rgba(10,132,255,0.35)',
        transition: 'opacity 0.14s ease',
      }}
    >
      Follow
    </button>
  );
}

function BlockButton({ onBlock }: { onBlock?: (() => void) | undefined }) {
  return (
    <button
      onClick={onBlock}
      title="Block"
      style={{
        width: 28, height: 28, borderRadius: 999,
        border: '1px solid rgba(255,59,48,0.35)',
        background: 'rgba(255,59,48,0.08)',
        color: 'var(--red)', cursor: 'pointer', display: 'flex',
        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        transition: 'opacity 0.14s ease',
      }}
    >
      {/* block icon */}
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
        <line x1="3.05" y1="12.95" x2="12.95" y2="3.05" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    </button>
  );
}

function InfoFlipButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="More info"
      style={{
        width: 24, height: 24, borderRadius: 999,
        border: '1px solid var(--sep)',
        background: 'var(--fill-1)',
        color: 'var(--label-3)', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, transition: 'opacity 0.14s ease',
      }}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm0 2.25a.875.875 0 1 0 0 1.75.875.875 0 0 0 0-1.75Zm-.75 3h1.5v4.5h-1.5v-4.5Z"/>
      </svg>
    </button>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        background: 'none', border: 'none', padding: '0',
        color: 'var(--label-3)', cursor: 'pointer', fontSize: 12,
        fontWeight: 600, transition: 'opacity 0.14s ease',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13L5 8l5-5"/>
      </svg>
      Back
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: 'var(--label-3)',
      marginBottom: 6,
    }}>
      {children}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--sep)', margin: '10px 0' }} />;
}

function MediaChip({ type }: { type: 'image' | 'video' | 'external' }) {
  const icons: Record<string, string> = {
    image: '🖼',
    video: '▶',
    external: '🔗',
  };
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, color: 'var(--label-3)',
      background: 'var(--fill-1)', borderRadius: 4,
      padding: '1px 5px', marginLeft: 4,
    }}>
      {icons[type]}
    </span>
  );
}

function CompactPost({ post }: { post: CompactPostPreview }) {
  return (
    <div style={{
      padding: '7px 0',
      borderBottom: '0.5px solid var(--sep)',
    }}>
      {post.roleBadge && (
        <span style={{
          display: 'inline-block', marginBottom: 3,
          fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
          color: 'var(--blue)',
          background: 'rgba(10,132,255,0.12)',
          borderRadius: 4, padding: '1px 6px',
        }}>
          {post.roleBadge}
        </span>
      )}
      <div style={{
        fontSize: 13, color: 'var(--label-1)', lineHeight: 1.4,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {post.text}
        {post.hasMedia && post.mediaType && <MediaChip type={post.mediaType} />}
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        marginTop: 4,
      }}>
        <span style={{ fontSize: 11, color: 'var(--label-3)' }}>{timeAgo(post.createdAt)}</span>
        {post.likeCount !== undefined && post.likeCount > 0 && (
          <span style={{ fontSize: 11, color: 'var(--label-3)', display: 'flex', alignItems: 'center', gap: 3 }}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 13.5S1.5 9.3 1.5 5.5A3 3 0 0 1 7 3.87a3 3 0 0 1 1 0A3 3 0 0 1 14.5 5.5C14.5 9.3 8 13.5 8 13.5Z"/>
            </svg>
            {formatCount(post.likeCount)}
          </span>
        )}
        {post.replyCount !== undefined && post.replyCount > 0 && (
          <span style={{ fontSize: 11, color: 'var(--label-3)', display: 'flex', alignItems: 'center', gap: 3 }}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M13.5 8.5c0 2.5-2.46 4.5-5.5 4.5-1.02 0-1.97-.24-2.78-.65L2.5 13.5l.85-2.43A4.23 4.23 0 0 1 2.5 8.5C2.5 6 4.96 4 8 4s5.5 2 5.5 4.5Z"/>
            </svg>
            {formatCount(post.replyCount)}
          </span>
        )}
      </div>
    </div>
  );
}

function StarterPackList({ packs }: { packs: StarterPackRef[] }) {
  const visible = packs.slice(0, 3);
  const overflow = packs.length - 3;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {visible.map((p) => (
        <div
          key={p.uri}
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '5px 8px', borderRadius: 8,
            background: 'var(--fill-1)',
            border: '0.5px solid var(--sep)',
          }}
        >
          {/* pack icon */}
          <div style={{
            width: 22, height: 22, borderRadius: 5, flexShrink: 0,
            background: 'linear-gradient(135deg, var(--green), var(--teal, #32ADE6))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="white">
              <path d="M3 4h10v8H3zM6 4V2h4v2"/>
            </svg>
          </div>
          <span style={{
            fontSize: 12, fontWeight: 500, color: 'var(--label-1)',
            overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
          }}>
            {p.title}
          </span>
        </div>
      ))}
      {overflow > 0 && (
        <div style={{ fontSize: 11, color: 'var(--label-3)', paddingLeft: 4 }}>
          +{overflow} more
        </div>
      )}
    </div>
  );
}

function SocialRow({
  followersCount, mutualsCount, followingCount,
}: {
  followersCount: number;
  mutualsCount: number;
  followingCount: number;
}) {
  const showMutuals = mutualsCount > 0;
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: 3, alignItems: 'baseline' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--label-1)' }}>
          {formatCount(followersCount)}
        </span>
        <span style={{ fontSize: 12, color: 'var(--label-3)' }}>Followers</span>
      </div>
      <div style={{ display: 'flex', gap: 3, alignItems: 'baseline' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--label-1)' }}>
          {formatCount(showMutuals ? mutualsCount : followingCount)}
        </span>
        <span style={{ fontSize: 12, color: 'var(--label-3)' }}>
          {showMutuals ? 'Mutuals' : 'Following'}
        </span>
      </div>
    </div>
  );
}

function PostMix({ recent, popular, max = 3 }: {
  recent: CompactPostPreview[];
  popular: CompactPostPreview[];
  max?: number;
}) {
  // Interleave: 1 popular, rest recent
  const seen = new Set<string>();
  const mixed: CompactPostPreview[] = [];
  if (popular[0] && !seen.has(popular[0].uri)) {
    seen.add(popular[0].uri);
    mixed.push(popular[0]);
  }
  for (const p of recent) {
    if (mixed.length >= max) break;
    if (!seen.has(p.uri)) {
      seen.add(p.uri);
      mixed.push(p);
    }
  }
  if (mixed.length === 0) return null;
  return (
    <div>
      {mixed.map((p) => <CompactPost key={p.uri} post={p} />)}
    </div>
  );
}

// ─── Standard Card Front ──────────────────────────────────────────────────────
function StandardFront({
  data, onFlip, onFollow, flipKey,
}: {
  data: ProfileCardData;
  onFlip: () => void;
  onFollow?: (() => void) | undefined;
  flipKey: number;
}) {
  const { identity, social, activity } = data;
  const showRelationshipUi = !social.isPartial;
  return (
    <div key={flipKey} className="profile-card-face profile-card-face--front">
      <Banner src={identity.banner} />

      {/* Identity row */}
      <div style={{
        padding: identity.banner ? '0 14px 0' : '14px 14px 0',
        marginTop: identity.banner ? -28 : 0,
        display: 'flex', alignItems: 'flex-end', gap: 10,
        justifyContent: 'space-between',
      }}>
        <Avatar src={identity.avatar} handle={identity.handle} size={60} />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingBottom: 2 }}>
          {showRelationshipUi ? (
            <FollowButton
              isFollowing={social.isFollowing}
              canFollow={social.canFollow}
              onFollow={onFollow}
            />
          ) : null}
          <InfoFlipButton onClick={onFlip} />
        </div>
      </div>

      {/* Name + handle */}
      <div style={{ padding: '8px 14px 0' }}>
        {identity.displayName && (
          <div style={{
            fontSize: 15, fontWeight: 700, color: 'var(--label-1)',
            lineHeight: 1.2, marginBottom: 1,
            overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
          }}>
            {identity.displayName}
          </div>
        )}
        <div style={{
          fontSize: 13, fontWeight: 500, color: 'var(--blue)',
          overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
        }}>
          @{identity.handle}
        </div>
      </div>

      {/* Bio */}
      {identity.bio && (
        <div style={{
          padding: '6px 14px 0',
          fontSize: 13, color: 'var(--label-2)', lineHeight: 1.45,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {identity.bio}
        </div>
      )}

      {/* Social row */}
      {showRelationshipUi ? (
        <div style={{ padding: '8px 14px 0' }}>
          <SocialRow
            followersCount={social.followersCount}
            mutualsCount={social.mutualsCount}
            followingCount={social.followingCount}
          />
        </div>
      ) : null}

      {/* Activity preview */}
      {(activity.recentPosts.length > 0 || activity.popularPosts.length > 0) && (
        <div style={{ padding: '10px 14px 0' }}>
          <Divider />
          <SectionLabel>Recent Activity</SectionLabel>
          <PostMix
            recent={activity.recentPosts}
            popular={activity.popularPosts}
            max={3}
          />
        </div>
      )}

      <div style={{ height: 12 }} />
    </div>
  );
}

// ─── Standard Card Back ───────────────────────────────────────────────────────
function StandardBack({
  data, onFlip, flipKey,
}: {
  data: ProfileCardData;
  onFlip: () => void;
  flipKey: number;
}) {
  const { starterPacks, activity } = data;
  return (
    <div key={flipKey} className="profile-card-face profile-card-face--back">
      {/* Back header */}
      <div style={{
        padding: '12px 14px 0',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <BackButton onClick={onFlip} />
      </div>

      {/* Starter Packs */}
      {starterPacks.length > 0 && (
        <div style={{ padding: '10px 14px 0' }}>
          <SectionLabel>Starter Packs</SectionLabel>
          <StarterPackList packs={starterPacks} />
        </div>
      )}

      {/* Activity mix */}
      {(activity.recentPosts.length > 0 || activity.popularPosts.length > 0) && (
        <div style={{ padding: '10px 14px 0' }}>
          {starterPacks.length > 0 && <Divider />}
          <SectionLabel>Posts</SectionLabel>
          <PostMix
            recent={activity.recentPosts}
            popular={activity.popularPosts}
            max={4}
          />
        </div>
      )}

      <div style={{ height: 12 }} />
    </div>
  );
}

// ─── Thread-Scoped Card Front ─────────────────────────────────────────────────
function ThreadFront({
  data, onFlip, onFollow, onBlock, flipKey,
}: {
  data: ProfileCardData;
  onFlip: () => void;
  onFollow?: (() => void) | undefined;
  onBlock?: (() => void) | undefined;
  flipKey: number;
}) {
  const { identity, social, threadContext } = data;
  const showRelationshipUi = !social.isPartial;
  return (
    <div key={flipKey} className="profile-card-face profile-card-face--front">
      <Banner src={identity.banner} />

      {/* Identity row */}
      <div style={{
        padding: identity.banner ? '0 14px 0' : '14px 14px 0',
        marginTop: identity.banner ? -28 : 0,
        display: 'flex', alignItems: 'flex-end', gap: 10,
        justifyContent: 'space-between',
      }}>
        <Avatar src={identity.avatar} handle={identity.handle} size={60} />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingBottom: 2 }}>
          {showRelationshipUi ? (
            <FollowButton
              isFollowing={social.isFollowing}
              canFollow={social.canFollow}
              onFollow={onFollow}
            />
          ) : null}
          {showRelationshipUi && social.canBlock ? <BlockButton onBlock={onBlock} /> : null}
          <InfoFlipButton onClick={onFlip} />
        </div>
      </div>

      {/* Name + handle */}
      <div style={{ padding: '8px 14px 0' }}>
        {identity.displayName && (
          <div style={{
            fontSize: 15, fontWeight: 700, color: 'var(--label-1)',
            lineHeight: 1.2, marginBottom: 1,
            overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
          }}>
            {identity.displayName}
          </div>
        )}
        <div style={{
          fontSize: 13, fontWeight: 500, color: 'var(--blue)',
          overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
        }}>
          @{identity.handle}
        </div>
      </div>

      {/* Thread context */}
      {threadContext && (
        <div style={{ padding: '10px 14px 0' }}>
          <Divider />

          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 8,
          }}>
            <SectionLabel>In this thread</SectionLabel>
            {threadContext.compactPosts.length > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, color: 'var(--label-3)',
                background: 'var(--fill-1)', borderRadius: 4, padding: '1px 6px',
              }}>
                {threadContext.compactPosts.length} post{threadContext.compactPosts.length > 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Role summary + notable action */}
          {(threadContext.roleSummary || threadContext.notableAction) && (
            <div style={{
              padding: '6px 10px', borderRadius: 8,
              background: 'rgba(10,132,255,0.07)',
              border: '0.5px solid rgba(10,132,255,0.18)',
              marginBottom: 8,
            }}>
              {threadContext.roleSummary && (
                <div style={{
                  fontSize: 12, fontWeight: 600, color: 'var(--label-1)',
                  lineHeight: 1.35, overflow: 'hidden',
                  whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                }}>
                  {threadContext.roleSummary}
                </div>
              )}
              {threadContext.notableAction && (
                <div style={{
                  fontSize: 11, color: 'var(--label-2)', marginTop: threadContext.roleSummary ? 2 : 0,
                  lineHeight: 1.35, overflow: 'hidden',
                  whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                }}>
                  {threadContext.notableAction}
                </div>
              )}
            </div>
          )}

          {/* Thread posts (max 2) */}
          {threadContext.compactPosts.slice(0, 2).map((p) => (
            <CompactPost key={p.uri} post={p} />
          ))}

          {/* Most-labelled reply */}
          {threadContext.mostLabelledReply && (
            <div style={{
              marginTop: 8, padding: '7px 10px',
              borderRadius: 8,
              background: 'var(--fill-1)',
              border: '0.5px solid var(--sep)',
            }}>
              <div style={{
                display: 'flex', gap: 5, marginBottom: 4, flexWrap: 'wrap',
              }}>
                {threadContext.mostLabelledReply.labels.slice(0, 3).map((l) => (
                  <span
                    key={l.label}
                    style={{
                      fontSize: 10, fontWeight: 700,
                      color: 'var(--purple, #BF5AF2)',
                      background: 'rgba(191,90,242,0.1)',
                      borderRadius: 4, padding: '1px 6px',
                    }}
                  >
                    {l.label} {l.count > 1 ? `×${l.count}` : ''}
                  </span>
                ))}
              </div>
              <div style={{
                fontSize: 12, color: 'var(--label-1)', lineHeight: 1.4,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}>
                {threadContext.mostLabelledReply.text}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ height: 12 }} />
    </div>
  );
}

// ─── Thread-Scoped Card Back ──────────────────────────────────────────────────
function ThreadBack({
  data, onFlip, flipKey,
}: {
  data: ProfileCardData;
  onFlip: () => void;
  flipKey: number;
}) {
  const { identity, social, starterPacks, activity } = data;
  const showRelationshipUi = !social.isPartial;
  return (
    <div key={flipKey} className="profile-card-face profile-card-face--back">
      {/* Back header */}
      <div style={{
        padding: '12px 14px 0',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <BackButton onClick={onFlip} />
        <span style={{ fontSize: 12, color: 'var(--label-3)', fontWeight: 500 }}>
          @{identity.handle}
        </span>
      </div>

      {/* Bio */}
      {identity.bio && (
        <div style={{ padding: '10px 14px 0' }}>
          <div style={{
            fontSize: 13, color: 'var(--label-2)', lineHeight: 1.45,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {identity.bio}
          </div>
        </div>
      )}

      {/* Social row */}
      {showRelationshipUi ? (
        <div style={{ padding: '8px 14px 0' }}>
          <SocialRow
            followersCount={social.followersCount}
            mutualsCount={social.mutualsCount}
            followingCount={social.followingCount}
          />
        </div>
      ) : null}

      {/* Starter Packs */}
      {starterPacks.length > 0 && (
        <div style={{ padding: '10px 14px 0' }}>
          <Divider />
          <SectionLabel>Starter Packs</SectionLabel>
          <StarterPackList packs={starterPacks} />
        </div>
      )}

      {/* Activity mix */}
      {(activity.recentPosts.length > 0 || activity.popularPosts.length > 0) && (
        <div style={{ padding: '10px 14px 0' }}>
          <Divider />
          <SectionLabel>Posts</SectionLabel>
          <PostMix
            recent={activity.recentPosts}
            popular={activity.popularPosts}
            max={3}
          />
        </div>
      )}

      <div style={{ height: 12 }} />
    </div>
  );
}

// ─── ProfileCard ──────────────────────────────────────────────────────────────
export interface ProfileCardProps {
  data: ProfileCardData;
  onFollow?: (() => void) | undefined;
  onBlock?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
}

export default function ProfileCard({ data, onFollow, onBlock }: ProfileCardProps) {
  ensureKeyframes();
  const [isFlipped, setIsFlipped] = useState(false);
  const [flipKey, setFlipKey] = useState(0);

  const handleFlip = useCallback(() => {
    setIsFlipped((f) => !f);
    setFlipKey((k) => k + 1);
  }, []);

  const cardStyle: React.CSSProperties = {
    width: CARD_WIDTH,
    borderRadius: 18,
    background: 'var(--surface)',
    border: '0.5px solid var(--sep)',
    boxShadow: '0 12px 40px rgba(0,0,0,0.22), 0 4px 12px rgba(0,0,0,0.12)',
    overflow: 'hidden',
    animation: 'profileCardIn 0.22s cubic-bezier(0.22,1,0.36,1) both',
    maxHeight: 520,
    overflowY: 'auto',
    // hide scrollbar visually
    scrollbarWidth: 'none',
  };

  if (data.variant === 'standard') {
    return (
      <div style={cardStyle}>
        {isFlipped ? (
          <StandardBack data={data} onFlip={handleFlip} flipKey={flipKey} />
        ) : (
          <StandardFront data={data} onFlip={handleFlip} onFollow={onFollow} flipKey={flipKey} />
        )}
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      {isFlipped ? (
        <ThreadBack data={data} onFlip={handleFlip} flipKey={flipKey} />
      ) : (
        <ThreadFront data={data} onFlip={handleFlip} onFollow={onFollow} onBlock={onBlock} flipKey={flipKey} />
      )}
    </div>
  );
}
