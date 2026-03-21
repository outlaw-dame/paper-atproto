import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Heart, MessageCircle, Repeat2, Share, BookmarkPlus, MessageSquareText, Layers, Rss, Package, Sparkles } from 'lucide-react';
import type { MockPost, ChipType } from '../data/mockData';
import { formatCount, formatTime } from '../data/mockData';
import type { StoryEntry, EntityEntry } from '../App';

interface PostCardProps {
  post: MockPost;
  onOpenStory: (entry: StoryEntry) => void;
  onOpenEntity: (entry: EntityEntry) => void;
  style?: React.CSSProperties;
}

const CHIP_CONFIG: Record<ChipType, { label: string; color: string; Icon: React.FC<{ size?: number }> }> = {
  thread:  { label: 'Thread',       color: 'blue',   Icon: ({ size }) => <MessageSquareText size={size} /> },
  topic:   { label: 'Topic',        color: 'purple', Icon: ({ size }) => <Sparkles size={size} /> },
  feed:    { label: 'Feed',         color: 'teal',   Icon: ({ size }) => <Rss size={size} /> },
  pack:    { label: 'Starter Pack', color: 'orange', Icon: ({ size }) => <Package size={size} /> },
  related: { label: 'Related',      color: 'green',  Icon: ({ size }) => <Layers size={size} /> },
  story:   { label: 'Open Story',   color: 'blue',   Icon: ({ size }) => <Sparkles size={size} /> },
};

export default function PostCard({ post, onOpenStory, onOpenEntity, style }: PostCardProps) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post.likeCount);

  const handleLike = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setLiked(prev => !prev);
    setLikeCount(prev => prev + (liked ? -1 : 1));
  }, [liked]);

  const handleCardTap = useCallback(() => {
    onOpenStory({ type: 'post', id: post.id, title: post.author.displayName, data: post as unknown as Record<string, unknown> });
  }, [post, onOpenStory]);

  const handleChipTap = useCallback((chip: ChipType, e: React.MouseEvent) => {
    e.stopPropagation();
    if (chip === 'story') {
      onOpenStory({ type: 'post', id: post.id, title: post.author.displayName });
    } else if (chip === 'topic') {
      onOpenEntity({ type: 'topic', id: `topic-${post.id}`, name: 'ATProto', reason: 'Frequently mentioned in this post' });
    } else if (chip === 'feed') {
      onOpenEntity({ type: 'feed', id: `feed-${post.id}`, name: 'Tech & Open Web', reason: 'This post appears in this feed' });
    } else if (chip === 'pack') {
      onOpenEntity({ type: 'pack', id: `pack-${post.id}`, name: 'ATProto Builders', reason: 'Author is in this starter pack' });
    }
  }, [post, onOpenStory, onOpenEntity]);

  const handleAuthorTap = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenEntity({ type: 'person', id: post.author.did, name: post.author.displayName, reason: 'Post author' });
  }, [post, onOpenEntity]);

  return (
    <motion.article
      className="glimpse-card mx-4 mb-3 cursor-pointer"
      style={style}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
      whileTap={{ scale: 0.98 }}
      onClick={handleCardTap}
      role="article"
      aria-label={`Post by ${post.author.displayName}`}
    >
      {/* Media (if any) — shown above content for media-first layout */}
      {post.media && post.media.length > 0 && (
        <MediaBlock media={post.media} />
      )}

      <div className="p-4">
        {/* Author row */}
        <button
          className="flex items-center gap-3 mb-3 w-full text-left"
          onClick={handleAuthorTap}
          aria-label={`View ${post.author.displayName}'s profile`}
        >
          <Avatar
            src={post.author.avatar}
            name={post.author.displayName}
            size={36}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="font-semibold text-sm truncate" style={{ color: 'var(--label-primary)', letterSpacing: '-0.2px' }}>
                {post.author.displayName}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs truncate" style={{ color: 'var(--label-secondary)' }}>
                @{post.author.handle}
              </span>
              <span style={{ color: 'var(--label-quaternary)', fontSize: '10px' }}>·</span>
              <span className="text-xs" style={{ color: 'var(--label-secondary)' }}>
                {formatTime(post.createdAt)}
              </span>
            </div>
          </div>
        </button>

        {/* Post content */}
        <p
          className="mb-3 leading-relaxed"
          style={{
            color: 'var(--label-primary)',
            fontSize: '15px',
            letterSpacing: '-0.2px',
            lineHeight: '1.45',
          }}
        >
          {post.content}
        </p>

        {/* External embed */}
        {post.embed?.type === 'external' && (
          <ExternalEmbed embed={post.embed} />
        )}

        {/* Quote post */}
        {post.embed?.type === 'quote' && (
          <QuotePost post={post.embed.post} />
        )}

        {/* Action row */}
        <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--separator)' }}>
          <ActionButton
            icon={<MessageCircle size={18} strokeWidth={1.75} />}
            count={post.replyCount}
            label="Reply"
            onClick={(e) => e.stopPropagation()}
          />
          <ActionButton
            icon={<Repeat2 size={18} strokeWidth={1.75} />}
            count={post.repostCount}
            label="Repost"
            onClick={(e) => e.stopPropagation()}
          />
          <ActionButton
            icon={
              <Heart
                size={18}
                strokeWidth={1.75}
                fill={liked ? 'var(--glimpse-red)' : 'none'}
                style={{ color: liked ? 'var(--glimpse-red)' : undefined }}
              />
            }
            count={likeCount}
            label="Like"
            onClick={handleLike}
            active={liked}
            activeColor="var(--glimpse-red)"
          />
          <ActionButton
            icon={<BookmarkPlus size={18} strokeWidth={1.75} />}
            label="Save"
            onClick={(e) => e.stopPropagation()}
          />
          <ActionButton
            icon={<Share size={18} strokeWidth={1.75} />}
            label="Share"
            onClick={(e) => e.stopPropagation()}
          />
        </div>

        {/* Context chips */}
        {post.chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {post.chips.map(chip => {
              const cfg = CHIP_CONFIG[chip];
              return (
                <button
                  key={chip}
                  className={`glimpse-chip ${cfg.color}`}
                  onClick={(e) => handleChipTap(chip, e)}
                  aria-label={cfg.label}
                >
                  <cfg.Icon size={10} />
                  {cfg.label}
                  {chip === 'thread' && post.threadCount && ` · ${post.threadCount}`}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </motion.article>
  );
}

// ── Sub-components ──

function Avatar({ src, name, size }: { src?: string; name: string; size: number }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const colors = ['#0A84FF', '#5E5CE6', '#32ADE6', '#30D158', '#FF9F0A', '#BF5AF2'];
  const color = colors[name.charCodeAt(0) % colors.length];

  return (
    <div
      className="rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center"
      style={{ width: size, height: size, background: src ? 'transparent' : color }}
    >
      {src
        ? <img src={src} alt={name} className="w-full h-full object-cover" loading="lazy" />
        : <span className="text-white font-semibold" style={{ fontSize: size * 0.38 }}>{initials}</span>
      }
    </div>
  );
}

function MediaBlock({ media }: { media: NonNullable<MockPost['media']> }) {
  if (media.length === 1) {
    const m = media[0];
    return (
      <div className="w-full overflow-hidden" style={{ maxHeight: 320, background: 'var(--surface-tertiary)' }}>
        <img
          src={m.url}
          alt={m.alt || ''}
          className="w-full object-cover"
          style={{ maxHeight: 320 }}
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-0.5" style={{ maxHeight: 280 }}>
      {media.slice(0, 4).map((m, i) => (
        <div key={i} className="overflow-hidden" style={{ background: 'var(--surface-tertiary)', height: 138 }}>
          <img src={m.url} alt={m.alt || ''} className="w-full h-full object-cover" loading="lazy" />
        </div>
      ))}
    </div>
  );
}

function ExternalEmbed({ embed }: { embed: Extract<MockPost['embed'], { type: 'external' }> }) {
  return (
    <div
      className="rounded-xl overflow-hidden border mt-1"
      style={{ borderColor: 'var(--separator)' }}
    >
      {embed.thumb && (
        <img src={embed.thumb} alt="" className="w-full object-cover" style={{ maxHeight: 160 }} loading="lazy" />
      )}
      <div className="p-3" style={{ background: 'var(--surface-secondary)' }}>
        <p className="text-xs mb-0.5" style={{ color: 'var(--label-secondary)' }}>{embed.domain}</p>
        <p className="font-semibold text-sm leading-snug" style={{ color: 'var(--label-primary)', letterSpacing: '-0.2px' }}>
          {embed.title}
        </p>
        <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--label-secondary)' }}>
          {embed.description}
        </p>
      </div>
    </div>
  );
}

function QuotePost({ post }: { post: Omit<MockPost, 'embed'> }) {
  return (
    <div
      className="rounded-xl p-3 mt-1 border"
      style={{ borderColor: 'var(--separator)', background: 'var(--surface-secondary)' }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Avatar src={post.author.avatar} name={post.author.displayName} size={20} />
        <span className="font-semibold text-xs" style={{ color: 'var(--label-primary)' }}>{post.author.displayName}</span>
        <span className="text-xs" style={{ color: 'var(--label-secondary)' }}>@{post.author.handle}</span>
      </div>
      <p className="text-sm leading-relaxed" style={{ color: 'var(--label-primary)', letterSpacing: '-0.1px' }}>
        {post.content}
      </p>
    </div>
  );
}

function ActionButton({
  icon, count, label, onClick, active, activeColor
}: {
  icon: React.ReactNode;
  count?: number;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  active?: boolean;
  activeColor?: string;
}) {
  return (
    <button
      className="flex items-center gap-1 touch-target"
      aria-label={label}
      onClick={onClick}
      style={{ color: active ? activeColor : 'var(--label-secondary)', minHeight: 32, minWidth: 32 }}
    >
      {icon}
      {count !== undefined && (
        <span style={{ fontSize: '13px', fontWeight: 400 }}>{formatCount(count)}</span>
      )}
    </button>
  );
}
